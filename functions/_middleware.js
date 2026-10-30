/**
 * Cloudflare Pages Middleware
 * www.takumi-master.com  → landing.html, server-side gevuld met het kompas van vandaag
 * app.takumi-master.com  → index.html (default, pass through)
 * + telt pageviews en werkboek-downloads (zie functions/_lib/stats.js)
 */
import { bump, requestEvent, BOT_RE } from './_lib/stats.js';
import { kompasVandaag } from './_lib/pulse.js';

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
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    return vulKompas(res);
  }

  // /landing of /landing.html direct opgevraagd (preview, tests): ook vullen
  if (url.pathname === '/landing.html' || url.pathname === '/landing' || url.pathname === '/landing/') {
    return vulKompas(await next());
  }

  // Everything else → normal Pages routing
  return next();
}

/**
 * Vult de [data-kompas] placeholders in landing.html met de puls van vandaag.
 * Dezelfde rotatie als lees_kompas (MCP) en /api/pulse, dus wat de bezoeker ziet
 * is letterlijk wat de agents vanochtend kregen. Faalt stil: zonder middleware
 * blijft de statische inhoud van landing.html staan.
 */
function vulKompas(res) {
  let k;
  try { k = kompasVandaag(); } catch { return res; }
  const isOchtend = k.dagdeel === 'morning';
  const velden = {
    kanji:   k.leader.kanji,
    naam:    k.leader.name,
    element: k.leader.element,
    meester: k.leader.master,
    vraag:   k.question,
    datum:   k.datum_nl,
    puls:    isOchtend ? 'ochtendpuls' : 'avondpuls',
    tijd:    isOchtend ? '06:45' : '21:15',
  };
  class Vul {
    constructor(tekst) { this.tekst = tekst; }
    element(el) { el.setInnerContent(this.tekst); }
  }
  let rw = new HTMLRewriter()
    .on('html', { element(el) {
      el.setAttribute('data-kompas-eid', k.leader.eid);
      el.setAttribute('data-kompas-dag', k.iso);
    } })
    .on('[data-kompas-datum]', { element(el) {
      el.setAttribute('data-nl', k.datum_nl);
      el.setAttribute('data-en', k.datum_en);
      el.setInnerContent(k.datum_nl);
    } });
  for (const [veld, tekst] of Object.entries(velden)) {
    rw = rw.on(`[data-kompas="${veld}"]`, new Vul(tekst));
  }
  const out = rw.transform(res);
  // Per dag anders, dus hooguit een uur cachen aan de rand; browser altijd vers
  const h = new Headers(out.headers);
  h.set('Cache-Control', 'public, max-age=0, s-maxage=3600');
  return new Response(out.body, { status: out.status, headers: h });
}
