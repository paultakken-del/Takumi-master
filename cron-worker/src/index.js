/**
 * Takumi cron-Worker: het uurwerk van het platform.
 * Roept de bestaande endpoints aan op vaste tijden; bevat zelf geen logica.
 * Handmatig: POST / met x-radar-key en {"taak":"meting|weging|dagwacht|weekronde"}.
 */
const BASIS = 'https://takumi-master.com/api/';
const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(env, pad, body, label) {
  try {
    const r = await fetch(BASIS + pad, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-radar-key': env.RADAR_KEY },
      body: JSON.stringify(body),
    });
    const tekst = (await r.text()).slice(0, 300);
    console.log(`${label}: HTTP ${r.status} ${tekst}`);
    return { label, status: r.status, body: tekst };
  } catch (e) {
    console.log(`${label}: FOUT ${String(e.message || e)}`);
    return { label, fout: String(e.message || e) };
  }
}

const TAKEN = {
  meting: async (env) => [
    await post(env, 'radar', { stap: 'meting' }, 'meting'),
    await post(env, 'radar', { stap: 'klimaat' }, 'klimaat'),
    await post(env, 'wachter', { puls: true }, 'dagpuls'),
  ],
  weging: async (env) => [
    await post(env, 'radar', { stap: 'signaal', soort: 'macro' }, 'signaal macro'),
    await post(env, 'radar', { stap: 'signaal', soort: 'crypto' }, 'signaal crypto'),
    await post(env, 'wachter', {}, 'wachter'),
  ],
  dagwacht: async (env) => [
    await post(env, 'engine', { stap: 'dagwacht' }, 'dagwacht'),
    await post(env, 'wachter', {}, 'wachter'),
  ],
  weekronde: async (env) => {
    const uit = [];
    for (const fase of ['trend', 'herwaardeer']) {
      uit.push(await post(env, 'engine', { stap: 'etf-diagnose', fase }, 'voorverwarm ' + fase));
      await pauze(5000);
    }
    uit.push(await post(env, 'engine', { stap: 'weekronde' }, 'weekronde BTC'));
    uit.push(await post(env, 'engine', { stap: 'weekronde-etf' }, 'weekronde ETF'));
    uit.push(await post(env, 'engine', { stap: 'koopladder' }, 'sluis'));
    uit.push(await post(env, 'wachter', {}, 'wachter'));
    return uit;
  },
};

const CRON_NAAR_TAAK = {
  '23 3 * * *': 'meting',
  '37 18 * * 0': 'weging',
  '23 1,5,9,13,17,21 * * *': 'dagwacht',
  '53 5 * * 1': 'weekronde',
};

export default {
  async scheduled(event, env, ctx) {
    const taak = CRON_NAAR_TAAK[event.cron];
    if (!taak) { console.log('onbekende cron', event.cron); return; }
    console.log('start', taak, new Date().toISOString());
    ctx.waitUntil(TAKEN[taak](env));
  },
  async fetch(request, env) {
    const kop = { 'content-type': 'application/json; charset=utf-8' };
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: true, rol: 'Takumi cron-Worker', taken: Object.keys(TAKEN), crons: CRON_NAAR_TAAK }), { headers: kop });
    }
    if (!env.RADAR_KEY || request.headers.get('x-radar-key') !== env.RADAR_KEY) {
      return new Response(JSON.stringify({ fout: 'x-radar-key ontbreekt of is ongeldig.' }), { status: 401, headers: kop });
    }
    let body = {};
    try { body = await request.json(); } catch { /* leeg */ }
    if (!TAKEN[body.taak]) return new Response(JSON.stringify({ fout: 'onbekende taak', taken: Object.keys(TAKEN) }), { status: 400, headers: kop });
    const uit = await TAKEN[body.taak](env);
    return new Response(JSON.stringify({ taak: body.taak, tijd: new Date().toISOString(), uit }), { headers: kop });
  },
};
