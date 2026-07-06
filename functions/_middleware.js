/**
 * Cloudflare Pages Middleware
 * www.takumi-master.com  → landing.html
 * app.takumi-master.com  → index.html (default, pass through)
 * + telt pageviews en werkboek-downloads (zie functions/_lib/stats.js)
 */
import { bump, requestEvent, BOT_RE } from './_lib/stats.js';

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const host = url.hostname;

  // Statistiek: alleen echte GET's van niet-bots, fire-and-forget
  if (request.method === 'GET' && !BOT_RE.test(request.headers.get('User-Agent') || '')) {
    const ev = requestEvent(url, host);
    if (ev) context.waitUntil(bump(env, ev).catch(() => {}));
  }

  // www subdomain root → serve landing.html via ASSETS binding
  if (
    (host === 'www.takumi-master.com' || host === 'takumi-master.com') &&
    (url.pathname === '/' || url.pathname === '')
  ) {
    const assetUrl = new URL('/landing.html', url.origin);
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  }

  // Everything else → normal Pages routing
  return next();
}
