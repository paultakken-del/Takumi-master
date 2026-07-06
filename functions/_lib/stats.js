/**
 * Gedeelde statistiek-helper — telt events per dag in KV (TAKUMI_USERS).
 * Key-formaat: stat:{event}:{YYYY-MM-DD}  (Europe/Amsterdam), TTL ±13 maanden.
 *
 * Let op: KV-increment is read-modify-write, niet atomair. Bij dit verkeers-
 * volume prima; tellingen zijn indicatief, geen boekhouding.
 */

export const CLICK_EVENTS = ['click_webinar', 'click_app', 'click_boek', 'click_spiegel'];

export const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime/i;

export function todayNL() {
  // sv-SE geeft YYYY-MM-DD
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

export async function bump(env, event) {
  if (!env.TAKUMI_USERS) return;
  const key = `stat:${event}:${todayNL()}`;
  const cur = parseInt((await env.TAKUMI_USERS.get(key)) || '0', 10);
  await env.TAKUMI_USERS.put(key, String(cur + 1), { expirationTtl: 60 * 60 * 24 * 400 });
}

/** Bepaal welk pageview/download-event bij dit request hoort (of null). */
export function requestEvent(url, host) {
  const p = url.pathname.replace(/\/$/, '') || '/';
  if (p === '/uit-de-grijze-zone.pdf') return 'pdf';
  const isWww = host === 'www.takumi-master.com' || host === 'takumi-master.com';
  if (isWww && p === '/') return 'view_landing';
  if (p === '/spiegel' || p === '/spiegel.html') return 'view_spiegel';
  if (p === '/agents' || p === '/agents.html') return 'view_agents';
  if (p === '/weegschaal' || p === '/weegschaal.html') return 'view_weegschaal';
  return null;
}
