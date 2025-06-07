// functions/api/[[path]].js
// This backend code now includes a '/api/reseed' endpoint to reset the database.

// --- GITHUB API HELPERS ---
const GITHUB_REPO = 'abelardob/odebt';
const UPLOADS_PATH = 'uploads';

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
    if (path === '/api/reseed') return { handler: handleReseed }; // New route
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
        return new Response(JSON.stringify({ error: "Server not configured correctly."}), { status: 500 });
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
    // ... (logic remains the same)
    const attachment = await env.DB.prepare('SELECT file_url FROM attachments WHERE id = ?').bind(attachmentId).first();
    if (attachment && attachment.file_url) {
        try {
            const fileUrl = new URL(attachment.file_url);
            const filePath = fileUrl.pathname.split('/').slice(4).join('/');
            const fileData = await githubApi(env.GITHUB_TOKEN, filePath, 'GET');
            await githubApi(env.GITHUB_TOKEN, filePath, 'DELETE', { message: `Delete attachment ID ${attachmentId}`, sha: fileData.sha });
        } catch (e) { console.error(`Could not delete file from GitHub: ${e.message}`); }
    }
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attachmentId).run();
    return new Response(null, { status: 204 });
}

// New handler to reseed the database
async function handleReseed(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    const reseedScript = `
        DROP TABLE IF EXISTS attachments;
        DROP TABLE IF EXISTS invoices;

        CREATE TABLE invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            service TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL,
            date TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_url TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        );
        
        INSERT INTO invoices (provider, service, amount, status, date) VALUES
        ('Hector Soberano', 'Polygonal plan', 8816.00, 'Outstanding', '2022-12-05'),
        ('Ken Sheffler', 'VISIT Ken y Larry', 83520.58, 'Outstanding', '2022-12-05'),
        ('MPL', 'Weather station', 114673.66, 'Outstanding', '2023-03-06'),
        ('Hector Soberano', 'ZOFEMAT investigation', 200506.00, 'Outstanding', '2023-03-03'),
        ('Hector Soberano', 'Surplus area research', 63701.79, 'Outstanding', '2023-02-20'),
        ('Javier Rodriguez', 'Reconstruction of polygons', 64032.00, 'Outstanding', '2023-05-16'),
        ('Hector Soberano', 'Marina donation', 18560.00, 'Outstanding', '2023-05-16'),
        ('Hector Soberano', 'Video, RTK survey', 53940.00, 'Outstanding', '2023-06-06'),
        ('Ken Sheffler', 'HD video, updated plans', 372761.36, 'Outstanding', '2023-06-07'),
        ('Ken Sheffler', 'Assembly of mobile office', 568501.62, 'Outstanding', '2023-07-07'),
        ('Javier Rodriguez', 'Elaboration of plans for 10 plots', 29000.00, 'Outstanding', '2023-07-07'),
        ('MPL', 'Surveillance Oct 2022', 131189.04, 'Outstanding', '2022-10-31'),
        ('MPL', 'Surveillance Nov 2022', 131189.04, 'Outstanding', '2022-11-30'),
        ('MPL', 'Surveillance Dec 2022', 131189.04, 'Outstanding', '2022-12-31'),
        ('MPL', 'Surveillance Feb 2023', 131189.04, 'Outstanding', '2023-02-28'),
        ('MPL', 'Surveillance Mar 2023', 131189.04, 'Outstanding', '2023-03-31'),
        ('MPL', 'Surveillance Apr 2023', 131189.04, 'Outstanding', '2023-04-30'),
        ('MPL', 'Surveillance May 2023', 131189.04, 'Outstanding', '2023-05-31'),
        ('MPL', 'Surveillance Jun 2023', 131189.04, 'Outstanding', '2023-06-30'),
    `;
    
    await env.DB.batch(reseedScript.split(';').filter(q => q.trim()).map(q => env.DB.prepare(q)));

    return new Response(JSON.stringify({ success: true, message: "Database reseeded successfully." }), { status: 200 });
}


// --- DATABASE & GITHUB FUNCTIONS ---
async function getInvoices(env) {
    const { results: invoices } = await env.DB.prepare('SELECT * FROM invoices ORDER BY date DESC').all();
    const { results: attachments } = await env.DB.prepare('SELECT * FROM attachments').all();
    const attachmentMap = new Map();
    attachments.forEach(att => {
        if (!attachmentMap.has(att.invoice_id)) attachmentMap.set(att.invoice_id, []);
        attachmentMap.get(att.invoice_id).push(att);
    });
    invoices.forEach(inv => { inv.attachments = attachmentMap.get(inv.id) || []; });
    return Response.json(invoices);
}

async function addInvoice(request, env) {
    const invoice = await request.json();
    const { results } = await env.DB.prepare('INSERT INTO invoices (provider, service, amount, status, date) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(invoice.provider, invoice.service, invoice.amount, invoice.status, invoice.date).all();
    const newInvoice = results[0];
    newInvoice.attachments = [];
    return Response.json(newInvoice, { status: 201 });
}

async function updateInvoice(request, env, id) {
    const updates = await request.json();
    if (updates.newAttachment) {
        const { content, name, category } = updates.newAttachment;
        const filePath = `${UPLOADS_PATH}/${Date.now()}-${name}`;
        await githubApi(env.GITHUB_TOKEN, filePath, 'PUT', { message: `Upload ${category} for invoice ${id}`, content: content });
        const attachmentUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${filePath}`;
        await env.DB.prepare('INSERT INTO attachments (invoice_id, category, file_name, file_url) VALUES (?, ?, ?, ?)').bind(id, category, name, attachmentUrl).run();
    }
    await env.DB.prepare('UPDATE invoices SET status = ? WHERE id = ?').bind(updates.status, id).run();
    const { results: invoices } = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).all();
    const { results: attachments } = await env.DB.prepare('SELECT * FROM attachments WHERE invoice_id = ?').bind(id).all();
    const updatedInvoice = invoices[0];
    updatedInvoice.attachments = attachments || [];
    return Response.json(updatedInvoice);
}

async function deleteInvoice(request, env, id) {
    const { results: attachments } = await env.DB.prepare('SELECT file_url FROM attachments WHERE invoice_id = ?').bind(id).all();
    for (const attachment of attachments) {
        if (attachment.file_url) {
            try {
                const fileUrl = new URL(attachment.file_url);
                const filePath = fileUrl.pathname.split('/').slice(4).join('/');
                const fileData = await githubApi(env.GITHUB_TOKEN, filePath, 'GET');
                await githubApi(env.GITHUB_TOKEN, filePath, 'DELETE', { message: `Delete attachment for invoice ${id}`, sha: fileData.sha });
            } catch (e) { console.error(`Could not delete file from GitHub: ${e.message}`); }
        }
    }
    await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
}
