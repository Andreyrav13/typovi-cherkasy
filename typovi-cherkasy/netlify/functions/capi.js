// ================================================================
// netlify/functions/capi.js
// Meta Conversions API — серверний endpoint
//
// ЗАМІНІТЬ (через змінні середовища в Netlify UI):
//   META_PIXEL_ID      → ваш Pixel ID  (напр. 1234567890)
//   META_ACCESS_TOKEN  → System User Access Token з Meta Business Manager
//
// Netlify: Site settings → Environment variables → Add variable
// ================================================================

const crypto = require('crypto');

// ── SHA-256 хешування (за правилами Meta: lowercase + trim) ──
function sha256(value) {
  if (!value) return null;
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

// ── Нормалізація телефону за правилами Meta ──
// Видалити всі символи крім цифр, додати код країни якщо відсутній
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  // Якщо починається з 0 — це UA номер, замінюємо на 380
  if (digits.startsWith('0') && digits.length === 10) {
    digits = '38' + digits;
  }
  // Якщо 10 цифр без 0 попереду — додаємо 380
  if (digits.length === 10) {
    digits = '380' + digits.slice(1);
  }
  return digits;
}

// ── Розбір імені на first/last за правилами Meta ──
function parseName(fullName) {
  if (!fullName) return { fn: null, ln: null };
  const parts = fullName.trim().split(/\s+/);
  return {
    fn: parts[0]  ? sha256(parts[0])  : null,
    ln: parts[1]  ? sha256(parts[1])  : null,
  };
}

exports.handler = async function (event) {
  // Дозволяємо лише POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Зчитуємо ENV-змінні (не хардкодимо токен у коді!)
  const PIXEL_ID     = process.env.META_PIXEL_ID     || '1249109846797475';
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAASvEAIfEZCsBRHmGvUZCT0VcFaYNLjWIuMa5qNz3kHsGhoivEstuSF24zkz9UzP3ZCclRM3b52AGZCM2HtQuzv7op9hP3SWZCMrnRUhJaQZCL8TzFX0US4QudUahZAmZAwCZBjGlWsIfwbEswHFqiK6sIlVq3RRVVbk2ZBgL2X4YUam2bx7ejMwTP2CZBrZCgpVJwZDZD';

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('[CAPI] Missing META_PIXEL_ID or META_ACCESS_TOKEN');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server misconfiguration' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    event_name,
    event_id,
    event_time,
    event_source_url,
    action_source,
    client_user_agent,
    fbp,
    fbc,
    user_data = {},
    custom_data = {},
  } = body;

  // ── Збираємо user_data з хешуванням ──
  const { fn, ln } = parseName(user_data.name);
  const ph = sha256(normalizePhone(user_data.phone));

  const metaUserData = {
    ...(ph  && { ph }),
    ...(fn  && { fn }),
    ...(ln  && { ln }),
    ...(fbp && { fbp }),
    ...(fbc && { fbc }),
    client_user_agent: client_user_agent || '',
  };

  // ── Формуємо payload для Meta CAPI ──
  const payload = {
    data: [
      {
        event_name:       event_name,
        event_id:         event_id,          // для deduplication з Pixel
        event_time:       event_time || Math.floor(Date.now() / 1000),
        event_source_url: event_source_url,
        action_source:    action_source || 'website',
        user_data:        metaUserData,
        ...(Object.keys(custom_data).length && { custom_data }),
      },
    ],
    // Для тестування розкоментуйте і вставте ваш Test Event Code:
    // test_event_code: 'TEST12345',
  };

  console.log('[CAPI] Sending event:', event_name, event_id);

  // ── Відправляємо в Meta ──
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }
    );

    const metaData = await metaRes.json();

    if (!metaRes.ok) {
      console.error('[CAPI] Meta error:', JSON.stringify(metaData));
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Meta API error', details: metaData }),
      };
    }

    console.log('[CAPI] Meta response:', JSON.stringify(metaData));
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, meta: metaData }),
    };
  } catch (err) {
    console.error('[CAPI] Fetch error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error', message: err.message }),
    };
  }
};
