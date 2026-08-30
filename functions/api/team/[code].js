// /api/team/[code] — gedeelde opslag voor de Wisselcoach-app (wisselcoach.html)
// KV: TAKUMI_USERS, sleutels geprefixt met "wisselcoach:" zodat ze
// gescheiden blijven van gebruikers- en statistiekdata.
//
//   GET /api/team/{code}?pin=xxxx → { state, updated } | 404 | 403
//   PUT /api/team/{code}          → body { pin, state }; eerste PUT claimt de
//                                   teamcode en legt de pincode (als hash) vast.

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const normCode = (c) => (c || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);

export async function onRequestGet({ request, env, params }){
  const code = normCode(params.code);
  if (code.length < 2) return json({ error: 'ongeldige teamcode' }, 400);
  if (!env.TAKUMI_USERS) return json({ error: 'KV niet geconfigureerd' }, 500);
  const pin = new URL(request.url).searchParams.get('pin') || '';
  const raw = await env.TAKUMI_USERS.get(`wisselcoach:team:${code}`);
  if (!raw) return json({ error: 'onbekende teamcode' }, 404);
  const rec = JSON.parse(raw);
  if (rec.pinHash !== await sha256(pin)) return json({ error: 'pincode onjuist' }, 403);
  return json({ state: rec.state, updated: rec.updated });
}

export async function onRequestPut({ request, env, params }){
  const code = normCode(params.code);
  if (code.length < 2) return json({ error: 'ongeldige teamcode' }, 400);
  if (!env.TAKUMI_USERS) return json({ error: 'KV niet geconfigureerd' }, 500);
  const body = await request.json().catch(() => null);
  if (!body?.pin || typeof body.state !== 'string') return json({ error: 'ongeldige aanvraag' }, 400);
  if (body.state.length > 200000) return json({ error: 'te groot' }, 413);
  const key = `wisselcoach:team:${code}`;
  const pinHash = await sha256(String(body.pin));
  const raw = await env.TAKUMI_USERS.get(key);
  if (raw && JSON.parse(raw).pinHash !== pinHash) return json({ error: 'pincode onjuist' }, 403);
  await env.TAKUMI_USERS.put(key, JSON.stringify({ pinHash, state: body.state, updated: Date.now() }));
  return json({ ok: true });
}
