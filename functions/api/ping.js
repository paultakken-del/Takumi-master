/** GET /api/ping - minimale bereikbaarheidstest: geen KV, geen logica. */
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'cache-control': 'no-store',
};
export async function onRequestOptions() {
  return new Response(null, { headers: HEADERS });
}
export async function onRequestGet({ env }) {
  const k = env.RADAR_KEY || '';
  return new Response(JSON.stringify({
    ok: true, versie: '1.1', tijd: new Date().toISOString(),
    radarSleutel: { aanwezig: !!k, lengte: k.length, begin: k.slice(0, 3), eind: k.slice(-3) },
  }), { headers: HEADERS });
}

// deploy-marker 1609

// deploy-marker 161605
