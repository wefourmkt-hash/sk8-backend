const SHOPIFY_STORE  = process.env.SHOPIFY_STORE;   // traction-9612.myshopify.com
const CLIENT_ID      = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET  = process.env.SHOPIFY_CLIENT_SECRET;

// Gera um novo access token a cada chamada
async function getAccessToken() {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  });
  const data = await res.json();
  return data.access_token;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { customer_email, discount_value } = body;
  if (!customer_email || !discount_value) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
  }

  try {
    // 1. Gera token fresco
    const token = await getAccessToken();
    const API = `https://${SHOPIFY_STORE}/admin/api/2024-01`;

    // 2. Busca cliente pelo email
    const custRes = await fetch(
      `${API}/customers/search.json?query=email:${encodeURIComponent(customer_email)}&limit=1`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const custData = await custRes.json();
    const customer = custData.customers?.[0];

    if (!customer) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cliente nao encontrado' }) };
    }

    // 3. Verifica se ja usou cupom via metafield
    const metaRes = await fetch(
      `${API}/customers/${customer.id}/metafields.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const metaData = await metaRes.json();
    const alreadyUsed = metaData.metafields?.some(
      m => m.namespace === 'sk8game' && m.key === 'coupon_used' && m.value === 'true'
    );

    if (alreadyUsed) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, already_used: true })
      };
    }

    // 4. Gera codigo unico
    const code = 'SK8-' + customer.id.toString().slice(-6) +
                 '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

    // 5. Cria price rule
    const ruleRes = await fetch(`${API}/price_rules.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_rule: {
          title: `SK8 Game - ${customer_email}`,
          target_type: 'line_item',
          target_selection: 'all',
          allocation_method: 'across',
          value_type: 'fixed_amount',
          value: `-${parseFloat(discount_value).toFixed(2)}`,
          customer_selection: 'all',
          starts_at: new Date().toISOString(),
          usage_limit: 1,
          once_per_customer: true
        }
      })
    });
    const ruleData = await ruleRes.json();
    const priceRuleId = ruleData.price_rule?.id;
    if (!priceRuleId) throw new Error('Falha ao criar price rule: ' + JSON.stringify(ruleData));

    // 6. Cria o codigo de desconto
    const couponRes = await fetch(`${API}/price_rules/${priceRuleId}/discount_codes.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount_code: { code } })
    });
    const couponData = await couponRes.json();
    if (!couponData.discount_code) throw new Error('Falha ao criar cupom');

    // 7. Marca cliente como tendo usado (metafield)
    await fetch(`${API}/customers/${customer.id}/metafields.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metafield: {
          namespace: 'sk8game',
          key: 'coupon_used',
          value: 'true',
          type: 'single_line_text_field'
        }
      })
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, code: couponData.discount_code.code })
    };

  } catch(err) {
    console.error('Erro:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro no servidor', message: err.message })
    };
  }
};
