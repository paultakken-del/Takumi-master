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
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, versie: '1.1', tijd: new Date().toISOString() }), { headers: HEADERS });
}
