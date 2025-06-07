// functions/api/[[path]].js
// This backend code now handles a separate 'attachments' table and categorized uploads.

// --- GITHUB API HELPERS ---
const GITHUB_REPO = 'abelardob/odebt'; // Your GitHub username and repository
const UPLOADS_PATH = 'uploads'; // The folder in your repo to store files

async function githubApi(token, endpoint, method = 'GET', body = null) {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${endpoint}`, {
        method: method,
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Cloudflare-Worker' },
        body: body ? JSON.stringify(body) : null
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API Error (${response.status}): ${errorText}`);
    }
    return response.status === 204 ? {} : await response.json();
}

// --- ROUTING ---
function route(url) {
    const path = url.pathname;
    if (path === '/api/invoices') return { handler: handleInvoices };
    const invoiceMatch = path.match(/^\/api\/invoices\/(\d+)$/);
    if (invoiceMatch) return { handler: handleSingleInvoice, id: invoiceMatch[1] };
    const attachmentMatch = path.match(/^\/api\/attachments\/(\d+)$/);
    if (attachmentMatch) return { handler: handleDeleteAttachment, id: attachmentMatch[1] };
    return null;
}

// --- MAIN FETCH HANDLER ---
export async function onRequest(context) {
    const { request, env } = context;
    if (!env.GITHUB_TOKEN || !env.DB) {
        return new Response(JSON.stringify({ error: "Server not configured correctly. Missing GITHUB_TOKEN or DB binding."}), { status: 500 });
    }
    const routeResult = route(new URL(request.url));
    if (!routeResult) return new Response('Not Found', { status: 404 });
    try {
        return await routeResult.handler(request, env, routeResult.id);
    } catch(e) {
        console.error("Request Error:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

// --- ROUTE HANDLERS ---
async function handleInvoices(request, env) {
    if (request.method === 'GET') return await getInvoices(env);
    if (request.method === 'POST') return await addInvoice(request, env);
    return new Response('Method Not Allowed', { status: 405 });
}

async function handleSingleInvoice(request, env, id) {
    if (request.method === 'PUT') return await updateInvoice(request, env, id);
    if (request.method === 'DELETE') return await deleteInvoice(request, env, id);
    return new Response('Method Not Allowed', { status: 405 });
}

async function handleDeleteAttachment(request, env, attachmentId) {
    if (request.method !== 'DELETE') return new Response('Method Not Allowed', { status: 405 });
    
    // Get the attachment details from D1 to find the file path in GitHub
    const attachment = await env.DB.prepare('SELECT file_url FROM attachments WHERE id = ?').bind(attachmentId).first();
    if (attachment && attachment.file_url) {
        try {
            const fileUrl = new URL(attachment.file_url);
            const filePath = fileUrl.pathname.split('/').slice(4).join('/'); // Extracts path after /main/
            const fileData = await githubApi(env.GITHUB_TOKEN, filePath, 'GET');
            await githubApi(env.GITHUB_TOKEN, filePath, 'DELETE', {
                message: `Delete attachment ID ${attachmentId}`,
                sha: fileData.sha
            });
        } catch (e) {
            console.error(`Could not delete file from GitHub for attachment ${attachmentId}: ${e.message}`);
        }
    }
    
    // Delete the record from D1
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attachmentId).run();
    return new Response(null, { status: 204 });
}


// --- DATABASE & GITHUB FUNCTIONS ---
async function getInvoices(env) {
    const { results: invoices } = await env.DB.prepare('SELECT * FROM invoices ORDER BY date DESC').all();
    const { results: attachments } = await env.DB.prepare('SELECT * FROM attachments').all();
    
    // Map attachments to their respective invoices
    const attachmentMap = new Map();
    for (const attachment of attachments) {
        if (!attachmentMap.has(attachment.invoice_id)) {
            attachmentMap.set(attachment.invoice_id, []);
        }
        attachmentMap.get(attachment.invoice_id).push(attachment);
    }
    
    for (const invoice of invoices) {
        invoice.attachments = attachmentMap.get(invoice.id) || [];
    }
    
    return Response.json(invoices);
}

async function addInvoice(request, env) {
    const invoice = await request.json();
    const { results } = await env.DB.prepare(
      'INSERT INTO invoices (provider, service, amount, status, date) VALUES (?, ?, ?, ?, ?) RETURNING *'
    ).bind(invoice.provider, invoice.service, invoice.amount, invoice.status, invoice.date).all();
    const newInvoice = results[0];
    newInvoice.attachments = []; // Start with an empty attachments array
    return Response.json(newInvoice, { status: 201 });
}

async function updateInvoice(request, env, id) {
    const updates = await request.json();

    // If a new attachment is being added
    if (updates.newAttachment) {
        const { content, name, category } = updates.newAttachment;
        const filePath = `${UPLOADS_PATH}/${Date.now()}-${name}`;
        
        await githubApi(env.GITHUB_TOKEN, filePath, 'PUT', {
            message: `Upload ${category} for invoice ${id}`,
            content: content
        });
        
        const attachmentUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${filePath}`;
        
        // Insert a new record into the attachments table
        await env.DB.prepare(
            'INSERT INTO attachments (invoice_id, category, file_name, file_url) VALUES (?, ?, ?, ?)'
        ).bind(id, category, name, attachmentUrl).run();
    }

    // Update the invoice status in the D1 database
    await env.DB.prepare('UPDATE invoices SET status = ? WHERE id = ?').bind(updates.status, id).run();
    
    // Fetch and return the fully updated invoice with all attachments
    const { results: invoices } = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).all();
    const { results: attachments } = await env.DB.prepare('SELECT * FROM attachments WHERE invoice_id = ?').bind(id).all();
    const updatedInvoice = invoices[0];
    updatedInvoice.attachments = attachments || [];

    return Response.json(updatedInvoice);
}

async function deleteInvoice(request, env, id) {
    // Get all attachments for this invoice
    const { results: attachments } = await env.DB.prepare('SELECT file_url FROM attachments WHERE invoice_id = ?').bind(id).all();

    // Delete all associated files from GitHub
    for (const attachment of attachments) {
        if (attachment.file_url) {
            try {
                const fileUrl = new URL(attachment.file_url);
                const filePath = fileUrl.pathname.split('/').slice(4).join('/');
                const fileData = await githubApi(env.GITHUB_TOKEN, filePath, 'GET');
                await githubApi(env.GITHUB_TOKEN, filePath, 'DELETE', {
                    message: `Delete attachment for invoice ${id}`,
                    sha: fileData.sha
                });
            } catch (e) {
                console.error(`Could not delete file from GitHub: ${e.message}`);
            }
        }
    }
    
    // Delete the invoice from D1 (attachments will be cascade deleted)
    await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
}

