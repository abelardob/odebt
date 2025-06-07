// functions/api/[[path]].js
// This backend code now includes logic to interact with the GitHub API for file storage.

// --- GITHUB API HELPERS ---
const GITHUB_REPO = 'abelardob/odebt'; // Your GitHub username and repository
const UPLOADS_PATH = 'uploads'; // The folder in your repo to store files

// Function to call the GitHub API
async function githubApi(token, endpoint, method = 'GET', body = null) {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${endpoint}`, {
        method: method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Cloudflare-Worker'
        },
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
    return null;
}

// --- MAIN FETCH HANDLER ---
export async function onRequest(context) {
    const { request, env } = context;
    if (!env.GITHUB_TOKEN) {
        return new Response(JSON.stringify({ error: "GITHUB_TOKEN secret not configured."}), { status: 500 });
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


// --- DATABASE & GITHUB FUNCTIONS ---
async function getInvoices(env) {
    const { results } = await env.DB.prepare('SELECT * FROM invoices').all();
    return Response.json(results);
}

async function addInvoice(request, env) {
    const invoice = await request.json();
    const { results } = await env.DB.prepare(
      'INSERT INTO invoices (provider, service, amount, status, date) VALUES (?, ?, ?, ?, ?) RETURNING *'
    ).bind(invoice.provider, invoice.service, invoice.amount, invoice.status, invoice.date).all();
    return Response.json(results[0], { status: 201 });
}

async function updateInvoice(request, env, id) {
    const updates = await request.json();

    // If an attachment is being added/updated
    if (updates.attachment && updates.attachment.content) {
        const { content, name } = updates.attachment;
        const filePath = `${UPLOADS_PATH}/${Date.now()}-${name}`;
        
        // Upload file to GitHub
        await githubApi(env.GITHUB_TOKEN, filePath, 'PUT', {
            message: `Upload attachment for invoice ${id}`,
            content: content // The base64 content
        });
        
        // The attachment URL to save in the DB
        updates.attachmentUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${filePath}`;
    }

    // Update D1 database
    const { results } = await env.DB.prepare(
        'UPDATE invoices SET status = ?, attachment = ? WHERE id = ? RETURNING *'
    ).bind(updates.status, updates.attachmentUrl || updates.attachment, id).all();
    
    return Response.json(results[0]);
}

async function deleteInvoice(request, env, id) {
    // Before deleting the DB record, delete the file from GitHub
    const invoice = await env.DB.prepare('SELECT attachment FROM invoices WHERE id = ?').bind(id).first();
    if (invoice && invoice.attachment) {
        try {
            const fileUrl = new URL(invoice.attachment);
            const filePath = fileUrl.pathname.split('/').slice(4).join('/'); // Extracts path after /main/
            const fileData = await githubApi(env.GITHUB_TOKEN, filePath, 'GET');
            await githubApi(env.GITHUB_TOKEN, filePath, 'DELETE', {
                message: `Delete attachment for invoice ${id}`,
                sha: fileData.sha
            });
        } catch (e) {
            console.error(`Could not delete file from GitHub: ${e.message}`);
            // Don't block invoice deletion if file deletion fails
        }
    }
    
    // Delete the record from D1
    await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
}