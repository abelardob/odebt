// src/worker.js
// This is the backend logic for your application. It's a Cloudflare Worker
// that handles API requests from the frontend to interact with the D1 database.
// This version includes CORS headers to allow cross-origin requests.

// Define CORS headers that will be added to every response.
const corsHeaders = {
  'Access-Control-Allow-Headers': '*', // Allow all headers
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', // Allow all methods
  'Access-Control-Allow-Origin': '*' // Allow requests from any origin
};

/**
 * Handles CORS preflight requests (OPTIONS method).
 * The browser sends this automatically before making a "complex" request (like POST/PUT).
 * @param {Request} request The incoming request
 * @returns {Response} A response with the appropriate CORS headers.
 */
function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Handle CORS preflight requests.
    return new Response(null, {
      headers: corsHeaders
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, PUT, DELETE, OPTIONS',
      },
    });
  }
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight requests first.
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }
    
    const url = new URL(request.url);
    let response;

    // Basic routing based on the URL path and HTTP method
    if (url.pathname === '/api/invoices') {
      switch (request.method) {
        case 'GET':
          response = await getInvoices(env);
          break;
        case 'POST':
          response = await addInvoice(request, env);
          break;
        default:
          response = new Response('Method Not Allowed', { status: 405 });
          break;
      }
    } else if (url.pathname.startsWith('/api/invoices/')) {
       const id = url.pathname.split('/')[3];
       switch (request.method) {
        case 'PUT':
            response = await updateInvoice(request, env, id);
            break;
        case 'DELETE':
            response = await deleteInvoice(env, id);
            break;
        default:
          response = new Response('Method Not Allowed', { status: 405 });
          break;
       }
    } else {
        response = new Response('Not Found', { status: 404 });
    }

    // Clone the response so we can add the CORS headers to it.
    response = new Response(response.body, response);
    Object.keys(corsHeaders).forEach(header => {
        response.headers.set(header, corsHeaders[header]);
    });

    return response;
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
