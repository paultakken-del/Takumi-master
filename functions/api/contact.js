/**
 * POST /api/contact — contactformulier landing.html
 * GET  /api/contact — geeft de Turnstile sitekey terug (publiek)
 *
 * Beveiliging (gelaagd):
 *  1. Cloudflare Turnstile (captcha)  — env TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY
 *  2. Honeypot-veld ("website")       — bots vullen het in, mensen zien het niet
 *  3. Rate limit per IP via KV        — max 5 berichten per uur (TAKUMI_USERS)
 *  4. Server-side validatie           — lengtes + e-mailformaat
 *
 * Verzending via Resend (env RESEND_API_KEY) naar env CONTACT_TO (Gmail).
 * Optioneel: env CONTACT_FROM (default: onboarding@resend.dev, werkt zonder domeinverificatie).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

// Turnstile sitekey is publiek (staat toch in elke pagebron); secret NOOIT hier.
const TURNSTILE_SITE_KEY = '0x4AAAAAADwFjg1LPXR0xbd7';

export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({ sitekey: context.env.TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY }),
    { headers: JSON_HEADERS }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return reply(400, { ok: false, error: 'invalid_json' });
  }

  const name = str(data.name, 100);
  const email = str(data.email, 200);
  const message = str(data.message, 4000);
  const honeypot = str(data.website, 200);
  const token = str(data.token, 4000);

  // 1. Honeypot: doe alsof het gelukt is, maar verstuur niets
  if (honeypot) return reply(200, { ok: true });

  // 2. Validatie
  if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return reply(400, { ok: false, error: 'invalid_fields' });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 3. Rate limit: max 5 per uur per IP
  if (env.TAKUMI_USERS) {
    const rlKey = `contact:rl:${ip}`;
    const count = parseInt((await env.TAKUMI_USERS.get(rlKey)) || '0', 10);
    if (count >= 5) return reply(429, { ok: false, error: 'rate_limited' });
    await env.TAKUMI_USERS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
  }

  // 4. Turnstile-verificatie (alleen als geconfigureerd)
  if (env.TURNSTILE_SECRET_KEY) {
    if (!token) return reply(400, { ok: false, error: 'captcha_missing' });
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const outcome = await verify.json();
    if (!outcome.success) return reply(403, { ok: false, error: 'captcha_failed' });
  }

  // 5. Mail versturen via Resend
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) {
    return reply(503, { ok: false, error: 'not_configured' });
  }

  const from = env.CONTACT_FROM || 'Takumi Contact <onboarding@resend.dev>';
  const body = [
    `Naam:   ${name}`,
    `E-mail: ${email}`,
    `Taal:   ${str(data.lang, 5) || 'nl'}`,
    `IP:     ${ip}`,
    '',
    message,
  ].join('\n');

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [env.CONTACT_TO],
      reply_to: email,
      subject: `[takumi-master.com] Contact van ${name}`,
      text: body,
    }),
  });

  if (!send.ok) {
    console.error('Resend error', send.status, await send.text());
    return reply(502, { ok: false, error: 'send_failed' });
  }

  return reply(200, { ok: true });
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function reply(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
