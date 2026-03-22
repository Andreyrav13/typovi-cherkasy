// ================================================================
// api/capi.js
// Meta Conversions API — Vercel Serverless Function
//
// ЗАМІНІТЬ (через змінні середовища в Vercel Dashboard):
//   META_PIXEL_ID      → ваш Pixel ID
//   META_ACCESS_TOKEN  → System User Access Token
//
// Vercel: Project → Settings → Environment Variables → Add
// ================================================================

const crypto = require('crypto');

// ── SHA-256 хешування (lowercase + trim, як вимагає Meta) ──
function sha256(value) {
  if (!value) return null;
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

// ── Нормалізація телефону ──
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) digits = '38' + digits;
  if (digits.length === 10) digits = '380' + digits.slice(1);
  return digits;
}

// ── Розбір імені ──
function parseName(fullName) {
  if (!fullName) return { fn: null, ln: null };
  const parts = fullName.trim().split(/\s+/);
  return {
    fn: parts[0] ? sha256(parts[0]) : null,
    ln: parts[1] ? sha256(parts[1]) : null,
  };
}

module.exports = async function handler(req, res) {
  // CORS для локальної розробки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const PIXEL_ID     = process.env.META_PIXEL_ID     || '1249109846797475';
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAASvEAIfEZCsBRHmGvUZCT0VcFaYNLjWIuMa5qNz3kHsGhoivEstuSF24zkz9UzP3ZCclRM3b52AGZCM2HtQuzv7op9hP3SWZCMrnRUhJaQZCL8TzFX0US4QudUahZAmZAwCZBjGlWsIfwbEswHFqiK6sIlVq3RRVVbk2ZBgL2X4YUam2bx7ejMwTP2CZBrZCgpVJwZDZD';

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('[CAPI] Missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
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
  } = req.body;

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

  const payload = {
    data: [
      {
        event_name:       event_name,
        event_id:         event_id,
        event_time:       event_time || Math.floor(Date.now() / 1000),
        event_source_url: event_source_url,
        action_source:    action_source || 'website',
        user_data:        metaUserData,
        ...(Object.keys(custom_data).length && { custom_data }),
      },
    ],
    // Для тестування розкоментуйте:
    // test_event_code: 'TEST12345',
  };

  console.log('[CAPI] Sending:', event_name, event_id);

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
      return res.status(502).json({ error: 'Meta API error', details: metaData });
    }

    console.log('[CAPI] OK:', JSON.stringify(metaData));
    return res.status(200).json({ ok: true, meta: metaData });
  } catch (err) {
    console.error('[CAPI] Error:', err.message);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
};
