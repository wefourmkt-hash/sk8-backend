const SHOPIFY_STORE  = process.env.SHOPIFY_STORE;
const CLIENT_ID      = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET  = process.env.SHOPIFY_CLIENT_SECRET;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://tractiongallery.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

async function getAccessToken() {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token failed: ' + JSON.stringify(data));
  return data.access_token;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { customer_email } = body;
  if (!customer_email) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing email' }) };
  }

  try {
    const token = await getAccessToken();
    const API = `https://${SHOPIFY_STORE}/admin/api/2024-01`;

    // Busca cliente
    const custRes = await fetch(
      `${API}/customers/search.json?query=email:${encodeURIComponent(customer_email)}&limit=1`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const custData = await custRes.json();
    const customer = custData.customers?.[0];
    if (!customer) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cliente nao encontrado' }) };

    // Busca price rules com titulo SK8 Game
    const rulesRes = await fetch(
      `${API}/price_rules.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const rulesData = await rulesRes.json();
    const customerRule = rulesData.price_rules?.find(r => r.title.includes(customer_email));

    if (!customerRule) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ found: false }) };
    }

    // Busca o codigo do desconto
    const codeRes = await fetch(
      `${API}/price_rules/${customerRule.id}/discount_codes.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const codeData = await codeRes.json();
    const discountCode = codeData.discount_codes?.[0];

    if (!discountCode) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ found: false }) };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        found: true,
        code: discountCode.code,
        value: Math.abs(parseFloat(customerRule.value)).toFixed(2)
      })
    };

  } catch(err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
