// /api/voorkeur/[code] — voorkeursposities uitvragen via de veldkaart.
//   GET  ?                      → { spelers, posities }  (publiek: alleen voornamen + positielijst)
//   GET  ?pin=x&inzendingen=1   → { inzendingen }        (alleen met juiste pincode)
//   POST { speler, posities }   → inzending opslaan      (publiek, streng gevalideerd)

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const POSITIES = [
  { code: 'LM', naam: 'Laatste man', x: 50, y: 88 },
  { code: 'VM', naam: 'Voorlaatste man', x: 50, y: 74 },
  { code: 'LA', naam: 'Linksachter', x: 18, y: 80 },
  { code: 'RA', naam: 'Rechtsachter', x: 82, y: 80 },
  { code: 'LH', naam: 'Linkshalf', x: 22, y: 52 },
  { code: 'MM', naam: 'Middenmid', x: 50, y: 55 },
  { code: 'RH', naam: 'Rechtshalf', x: 78, y: 52 },
  { code: 'LB', naam: 'Linksbuiten', x: 18, y: 24 },
  { code: 'SP', naam: 'Spits', x: 50, y: 18 },
  { code: 'RB', naam: 'Rechtsbuiten', x: 82, y: 24 },
];

const rosterUit = (raw) => {
  try {
    const s = JSON.parse(JSON.parse(raw).state);
    return (s.players || []).filter(p => !p.keeper).map(p => String(p.name)).slice(0, 25);
  } catch { return []; }
};

export async function onRequestGet({ request, env, params }){
  const code = String(params.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const raw = code ? await env.TAKUMI_USERS.get(`wisselcoach:team:${code}`) : null;
  if (!raw) return json({ error: 'onbekende teamcode' }, 404);
  const url = new URL(request.url);
  if (url.searchParams.get('inzendingen')) {
    const pin = url.searchParams.get('pin') || '';
    if (JSON.parse(raw).pinHash !== (await sha256(pin))) return json({ error: 'pincode onjuist' }, 403);
    const inz = await env.TAKUMI_USERS.get(`wisselcoach:inzend:${code}`);
    return json({ inzendingen: inz ? JSON.parse(inz) : {} });
  }
  return json({ spelers: rosterUit(raw), posities: POSITIES });
}

export async function onRequestPost({ request, env, params }){
  const code = String(params.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const raw = code ? await env.TAKUMI_USERS.get(`wisselcoach:team:${code}`) : null;
  if (!raw) return json({ error: 'onbekende teamcode' }, 404);
  const body = await request.json().catch(() => null);
  const roster = rosterUit(raw);
  const geldig = new Set(POSITIES.map(p => p.code));
  const speler = String(body?.speler || '');
  const posities = Array.isArray(body?.posities) ? [...new Set(body.posities.map(String))].filter(c => geldig.has(c)).slice(0, 3) : [];
  if (!roster.includes(speler) || posities.length === 0) return json({ error: 'ongeldige inzending' }, 400);
  const sleutel = `wisselcoach:inzend:${code}`;
  const inz = JSON.parse((await env.TAKUMI_USERS.get(sleutel)) || '{}');
  inz[speler] = { posities, tijd: Date.now() };
  if (Object.keys(inz).length > 40) return json({ error: 'te veel inzendingen' }, 429);
  await env.TAKUMI_USERS.put(sleutel, JSON.stringify(inz));
  return json({ ok: true });
}
