// functions/api/[[path]].js
// This is the new backend logic for your Cloudflare Pages application.
// It automatically handles requests to any /api/* route.

/**
 * A simple router to handle different API endpoints.
 * @param {URL} url - The request URL.
 * @returns {object|null} An object with the handler function and any parameters.
 */
function route(url) {
    const path = url.pathname;
    if (path === '/api/invoices') {
        return { handler: handleInvoices };
    }
    const match = path.match(/^\/api\/invoices\/(\d+)$/);
    if (match) {
        return { handler: handleSingleInvoice, id: match[1] };
    }
    return null;
}

/**
 * The main fetch handler for all incoming requests.
 */
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    const routeResult = route(url);

    if (!routeResult) {
        return new Response('Not Found', { status: 404 });
    }
    
    try {
        return await routeResult.handler(request, env, routeResult.id);
    } catch(e) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' }
        });
    }
}


/**
 * Handles requests to /api/invoices (GET all, POST new).
 */
async function handleInvoices(request, env) {
    switch (request.method) {
        case 'GET':
            return await getInvoices(env);
        case 'POST':
            return await addInvoice(request, env);
        default:
            return new Response('Method Not Allowed', { status: 405 });
    }
}

/**
 * Handles requests to /api/invoices/:id (PUT update, DELETE).
 */
async function handleSingleInvoice(request, env, id) {
     switch (request.method) {
        case 'PUT':
            return await updateInvoice(request, env, id);
        case 'DELETE':
            return await deleteInvoice(env, id);
        default:
            return new Response('Method Not Allowed', { status: 405 });
       }
}


// --- Database Functions ---

async function getInvoices(env) {
    const { results } = await env.DB.prepare('SELECT * FROM invoices').all();
    return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' },
    });
}

async function addInvoice(request, env) {
    const invoice = await request.json();
    if (!invoice.provider || !invoice.service || !invoice.amount || !invoice.date || !invoice.status) {
        return new Response(JSON.stringify({ error: "Missing required fields"}), { status: 400, headers: { 'Content-Type': 'application/json' }});
    }

    const { results } = await env.DB.prepare(
      'INSERT INTO invoices (provider, service, amount, status, date, attachment) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
    ).bind(
        invoice.provider, invoice.service, invoice.amount,
        invoice.status, invoice.date, invoice.attachment || null
    ).all();
    
    return new Response(JSON.stringify(results[0]), { 
        status: 201, 
        headers: { 'Content-Type': 'application/json' }
    });
}

async function updateInvoice(request, env, id) {
    const invoiceUpdates = await request.json();
    const { results } = await env.DB.prepare(
        'UPDATE invoices SET status = ?, attachment = ? WHERE id = ? RETURNING *'
    ).bind(invoiceUpdates.status, invoiceUpdates.attachment, id).all();

    if (results.length > 0) {
        return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' }});
    } else {
         return new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404 });
    }
}

async function deleteInvoice(env, id) {
    const { success } = await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run();
    if (success) {
        return new Response(null, { status: 204 });
    } else {
        return new Response(JSON.stringify({ error: 'Failed to delete invoice' }), { status: 500 });
    }
}
