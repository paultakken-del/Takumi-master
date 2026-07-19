/**
 * GET /api/rapport            -> volledig radarrapport als JSON
 * GET /api/rapport?vorm=tekst -> platte tekst (text/plain)
 * GET /api/rapport?vorm=md    -> markdown
 *
 * Alleen-lezen: leest de door de radar opgeslagen signalen uit KV en rekent
 * de trackrecord-score uit. Geen AI-aanroepen, dus vrij aan te roepen.
 * CORS staat open voor gebruik door externe tools.
 */

const NEUTRAAL = 5;
const VENSTER = 28 * 24 * 3600 * 1000;

function scoreCrypto(log) {
  const rijen = [];
  const cl = (log || []).filter((e) => e.soort === 'crypto');
  for (const e of cl) {
    if (!e.ref || !e.calls) continue;
    const later = cl.find((f) => f.t - e.t >= VENSTER && f.ref);
    if (!later) continue;
    for (const c of e.calls) {
      const veld = c.n === 'Bitcoin' ? 'btc' : c.n === 'Ethereum' ? 'eth' : null;
      if (!veld || !e.ref[veld] || !later.ref[veld]) continue;
      const delta = ((later.ref[veld] - e.ref[veld]) / e.ref[veld]) * 100;
      const uit = Math.abs(delta) < NEUTRAAL ? 'neutraal' : delta > 0 ? 'up' : 'down';
      const hit = uit === c.r;
      const p = (c.kMin + c.kMax) / 200;
      rijen.push({ t: e.t, asset: c.n, call: c.r, kMin: c.kMin, kMax: c.kMax, delta: Math.round(delta * 10) / 10, hit, brier: Math.round(Math.pow(p - (hit ? 1 : 0), 2) * 1000) / 1000 });
    }
  }
  const n = rijen.length;
  return {
    n,
    raak: rijen.filter((r) => r.hit).length,
    brier: n ? Math.round((rijen.reduce((a, r) => a + r.brier, 0) / n) * 1000) / 1000 : null,
    metingen: rijen,
  };
}

function signaalBlok(x) {
  if (!x) return null;
  const s = x.sig;
  return {
    gegenereerd: new Date(x.t).toISOString(),
    stand: s.fase || s.regime,
    verdeling: s.faseVerdeling || s.regimeVerdeling || {},
    samenvatting: s.samenvatting || '',
    synthese: s.synthese || '',
    indicatoren: s.indicatoren || [],
    calls: (s.sectoren || s.assets || []).map((c) => ({ naam: c.n, richting: c.r, kMin: c.kMin, kMax: c.kMax, reden: c.reden || '' })),
    analogieen: s.analogieen || [],
    referentie: s.ref || null,
  };
}

function alsTekst(rapport, md) {
  const K = md ? '**' : '';
  const r = [];
  r.push(`${md ? '# ' : ''}CYCLUSRADAR ${new Date(rapport.gegenereerd).toLocaleDateString('nl-NL')}`);
  for (const [naam, blok] of [['MAANDSIGNAAL MACRO', rapport.macro], ['WEEKSIGNAAL CRYPTO', rapport.crypto]]) {
    if (!blok) continue;
    r.push('');
    r.push(`${md ? '## ' : ''}${naam}: ${K}${blok.stand}${K}`);
    r.push('Verdeling: ' + Object.entries(blok.verdeling).map(([k, v]) => `${k} ${v}%`).join(', '));
    if (blok.synthese) r.push(blok.synthese);
    for (const c of blok.calls) r.push(`- ${c.naam}: ${c.richting} ${c.kMin}\u2013${c.kMax}%${c.reden ? ' (' + c.reden + ')' : ''}`);
  }
  if (rapport.trackrecord && rapport.trackrecord.n) {
    r.push('');
    r.push(`${md ? '## ' : ''}TRACKRECORD: n=${rapport.trackrecord.n}, raak ${rapport.trackrecord.raak}/${rapport.trackrecord.n}, Brier ${rapport.trackrecord.brier}`);
  }
  r.push('');
  r.push('Kansverdelingen, geen voorspellingen; educatief, geen beleggingsadvies. Bron: takumi-master.com/radar');
  return r.join('\n');
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'cache-control': 'public, max-age=300',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet({ request, env }) {
  try {
    const [macro, crypto, log] = await Promise.all([
      env.TAKUMI_USERS.get('radar:latest:macro', 'json'),
      env.TAKUMI_USERS.get('radar:latest:crypto', 'json'),
      env.TAKUMI_USERS.get('radar:log', 'json'),
    ]);
    const rapport = {
      bron: 'takumi-master.com/radar',
      gegenereerd: new Date().toISOString(),
      disclaimer: 'Kansverdelingen, geen voorspellingen; educatief, geen beleggingsadvies.',
      macro: signaalBlok(macro),
      crypto: signaalBlok(crypto),
      trackrecord: scoreCrypto(log),
    };
    const vorm = new URL(request.url).searchParams.get('vorm');
    if (vorm === 'tekst' || vorm === 'md') {
      return new Response(alsTekst(rapport, vorm === 'md'), {
        headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(JSON.stringify(rapport, null, 2), {
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ fout: e.message || 'rapport mislukt' }), {
      status: 500,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
