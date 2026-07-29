// /api/weging — persistent weeggeheugen per gebruiker (KV: TAKUMI_USERS)
//
// De naald heeft een reeks nodig. localStorage is per apparaat; deze
// endpoint maakt de weeggeschiedenis apparaat-overstijgend, zodat
// terugveren over de hele reeks gelezen kan worden.
//
//   GET  /api/weging          → { history: [{ts, element, beweging, agenda}, ...] } (nieuwste eerst)
//   POST /api/weging          → body {ts, element, beweging, agenda}; voegt toe, cap 365
//
// Auth: gsession cookie (zelfde patroon als /api/claude). Zonder login 401 —
// de client valt dan stil terug op lokaal geheugen.

const MAX_ENTRIES = 365;

function parseJwtPayload(token){
  try {
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(b64));
  } catch { return null; }
}

function getUid(request){
  const header = request.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find(c => c.startsWith('gsession='));
  if(!match) return null;
  const payload = parseJwtPayload(match.slice('gsession='.length));
  return payload?.sub || null;
}

function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet(context){
  const { request, env } = context;
  const uid = getUid(request);
  if(!uid) return json({ error: 'geen sessie' }, 401);
  if(!env.TAKUMI_USERS) return json({ error: 'KV niet geconfigureerd' }, 500);
  try {
    const raw = await env.TAKUMI_USERS.get(`weging:${uid}`);
    return json({ history: raw ? JSON.parse(raw) : [] });
  } catch {
    return json({ history: [] });
  }
}

export async function onRequestPost(context){
  const { request, env } = context;
  const uid = getUid(request);
  if(!uid) return json({ error: 'geen sessie' }, 401);
  if(!env.TAKUMI_USERS) return json({ error: 'KV niet geconfigureerd' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'ongeldige body' }, 400); }

  const entry = {
    ts: typeof body.ts === 'string' ? body.ts : new Date().toISOString(),
    element: typeof body.element === 'string' ? body.element.slice(0, 12) : null,
    beweging: ['gereden','hersteld','rust'].includes(body.beweging) ? body.beweging : null,
    agenda: ['vol','ruim'].includes(body.agenda) ? body.agenda : null
  };
  if(!entry.element && !entry.beweging && !entry.agenda) return json({ error: 'lege weging' }, 400);

  const key = `weging:${uid}`;
  let history = [];
  try {
    const raw = await env.TAKUMI_USERS.get(key);
    if(raw) history = JSON.parse(raw);
    if(!Array.isArray(history)) history = [];
  } catch { history = []; }

  // Dedupe op ts; nieuwste eerst; cap.
  history = history.filter(h => h && h.ts !== entry.ts);
  history.unshift(entry);
  history.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  history = history.slice(0, MAX_ENTRIES);

  try {
    await env.TAKUMI_USERS.put(key, JSON.stringify(history));
  } catch {
    return json({ error: 'opslaan mislukt' }, 500);
  }
  return json({ ok: true, count: history.length });
}
