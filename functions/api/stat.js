/**
 * POST /api/stat  — klik-beacon vanaf de landingspagina (allowlist, geen auth)
 * GET  /api/stat  — dashboard-data, beveiligd met Bearer STATS_KEY
 */
import { bump, CLICK_EVENTS, todayNL } from '../_lib/stats.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export async function onRequestPost(context) {
  const { request, env } = context;

  // Alleen beacons vanaf de eigen site
  const origin = request.headers.get('Origin') || '';
  if (origin && !/https:\/\/(www\.)?takumi-master\.com$/.test(origin)) {
    return new Response(null, { status: 204 });
  }

  let ev = '';
  try { ev = (await request.json()).e || ''; } catch {}
  if (CLICK_EVENTS.includes(ev)) {
    context.waitUntil(bump(env, ev).catch(() => {}));
  }
  return new Response(null, { status: 204 });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = request.headers.get('Authorization') || '';
  if (!env.STATS_KEY || auth !== `Bearer ${env.STATS_KEY}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }
  if (!env.TAKUMI_USERS) {
    return new Response(JSON.stringify({ error: 'no_kv' }), { status: 503, headers: JSON_HEADERS });
  }

  // Alle stat-keys ophalen (max ~1000; ruim voldoende voor 13 mnd × handvol events)
  const keys = [];
  let cursor;
  do {
    const page = await env.TAKUMI_USERS.list({ prefix: 'stat:', cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const values = await Promise.all(keys.map((k) => env.TAKUMI_USERS.get(k)));

  // Opbouwen: events → { total, byDay: { date: n } }
  const events = {};
  keys.forEach((k, i) => {
    const m = k.match(/^stat:([a-z_]+):(\d{4}-\d{2}-\d{2})$/);
    if (!m) return;
    const [, ev, day] = m;
    const n = parseInt(values[i] || '0', 10);
    if (!events[ev]) events[ev] = { total: 0, byDay: {} };
    events[ev].total += n;
    events[ev].byDay[day] = n;
  });

  // Laatste 30 dagen als vaste as (Europe/Amsterdam)
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 864e5);
    days.push(d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }));
  }

  return new Response(JSON.stringify({ today: todayNL(), days, events }), { headers: JSON_HEADERS });
}
