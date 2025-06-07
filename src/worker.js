// src/worker.js
// This is the backend logic for your application. It's a Cloudflare Worker
// that handles API requests from the frontend to interact with the D1 database.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Basic routing based on the URL path and HTTP method
    if (url.pathname === '/api/invoices') {
      switch (request.method) {
        case 'GET':
          return await getInvoices(env);
        case 'POST':
          return await addInvoice(request, env);
        default:
          return new Response('Method Not Allowed', { status: 405 });
      }
    }

    if (url.pathname.startsWith('/api/invoices/')) {
       const id = url.pathname.split('/')[3];
       switch (request.method) {
        case 'PUT':
            return await updateInvoice(request, env, id);
        case 'DELETE':
            return await deleteInvoice(env, id);
        default:
          return new Response('Method Not Allowed', { status: 405 });
       }
    }

    // Fallback for any other request
    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Retrieves all invoices from the D1 database.
 * @param {object} env - The environment object containing the database binding.
 * @returns {Response} - A Response object with the list of invoices in JSON format.
 */
async function getInvoices(env) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM invoices').all();
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }
}

/**
 * Adds a new invoice to the D1 database.
 * @param {Request} request - The incoming request object containing the invoice data.
 * @param {object} env - The environment object containing the database binding.
 * @returns {Response} - A Response object with the newly created invoice data.
 */
async function addInvoice(request, env) {
  try {
    const invoice = await request.json();
    // Validate incoming data
    if (!invoice.provider || !invoice.service || !invoice.amount || !invoice.date || !invoice.status) {
        return new Response(JSON.stringify({ error: "Missing required fields"}), { status: 400, headers: { 'Content-Type': 'application/json' }});
    }

    const { results } = await env.DB.prepare(
      'INSERT INTO invoices (provider, service, amount, status, date, attachment) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
    ).bind(
        invoice.provider,
        invoice.service,
        invoice.amount,
        invoice.status,
        invoice.date,
        invoice.attachment || null
    ).all();
    
    return new Response(JSON.stringify(results[0]), { 
        status: 201, 
        headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }
}

/**
 * Updates an existing invoice in the D1 database.
 * @param {Request} request - The incoming request object containing the updated data.
 * @param {object} env - The environment object containing the database binding.
 * @param {string} id - The ID of the invoice to update.
 * @returns {Response} - A Response object with the updated invoice data.
 */
async function updateInvoice(request, env, id) {
    try {
        const invoiceUpdates = await request.json();
        // For now, we only support status and attachment updates.
        // A more robust implementation would handle updating any field.
        const { results } = await env.DB.prepare(
            'UPDATE invoices SET status = ?, attachment = ? WHERE id = ? RETURNING *'
        ).bind(
            invoiceUpdates.status,
            invoiceUpdates.attachment,
            id
        ).all();

        if (results.length > 0) {
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' }});
        } else {
             return new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404, headers: { 'Content-Type': 'application/json' }});
        }
    } catch(e) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}

/**
 * Deletes an invoice from the D1 database.
 * @param {object} env - The environment object containing the database binding.
 * @param {string} id - The ID of the invoice to delete.
 * @returns {Response} - A Response object indicating success or failure.
 */
async function deleteInvoice(env, id) {
    try {
        const { success } = await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run();
        if (success) {
            return new Response(null, { status: 204 }); // No Content
        } else {
            return new Response(JSON.stringify({ error: 'Failed to delete invoice' }), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
    } catch(e) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}
