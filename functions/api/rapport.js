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
const VENSTER_MACRO = 182 * 24 * 3600 * 1000;

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
      const grens = veld === 'btc' ? [5000, 500000] : [100, 50000];
      if (e.ref[veld] < grens[0] || e.ref[veld] > grens[1] || later.ref[veld] < grens[0] || later.ref[veld] > grens[1]) continue;
      if (!(c.kMin >= 1 && c.kMax <= 99 && c.kMin <= c.kMax)) continue;
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

function scoreMacro(log) {
  const rijen = [];
  const ml = (log || []).filter((e) => e.soort === 'macro' && e.ref && e.ref.etf && e.calls);
  for (const e of ml) {
    const later = ml.find((f) => f.t - e.t >= VENSTER_MACRO && f.ref && f.ref.etf);
    if (!later) continue;
    for (const c of e.calls) {
      const a = e.ref.etf[c.n], b = later.ref.etf[c.n];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (!(c.kMin >= 1 && c.kMax <= 99 && c.kMin <= c.kMax)) continue;
      const delta = ((b - a) / a) * 100;
      const uit = Math.abs(delta) < NEUTRAAL ? 'neutraal' : delta > 0 ? 'up' : 'down';
      const hit = uit === c.r;
      const p = (c.kMin + c.kMax) / 200;
      rijen.push({ t: e.t, sector: c.n, call: c.r, kMin: c.kMin, kMax: c.kMax, delta: Math.round(delta * 10) / 10, hit, brier: Math.round(Math.pow(p - (hit ? 1 : 0), 2) * 1000) / 1000 });
    }
  }
  const n = rijen.length;
  return { n, raak: rijen.filter((r) => r.hit).length, brier: n ? Math.round((rijen.reduce((a, r) => a + r.brier, 0) / n) * 1000) / 1000 : null, metingen: rijen.slice(-40) };
}

function liquiditeitBlok(reeks) {
  if (!reeks || !reeks.length) return null;
  const nu = reeks[reeks.length - 1];
  const doel = Date.now() - 30 * 24 * 3600 * 1000;
  let oud = null;
  for (const m of reeks) if (!oud || Math.abs(m.t - doel) < Math.abs(oud.t - doel)) oud = m;
  const bruikbaar = reeks.length > 3;
  const veld = (groep, naam) => {
    const w = (nu[groep] || {})[naam];
    if (!Number.isFinite(w)) return null;
    const v = bruikbaar ? (oud[groep] || {})[naam] : null;
    return { waarde: w, delta30d: Number.isFinite(v) ? Math.round((w - v) * 100) / 100 : null };
  };
  return {
    gemetenOp: new Date(nu.t).toISOString(),
    nettoLiquiditeitMrdUSD: veld('macro', 'netliq'),
    financieleCondities: veld('macro', 'nfci'),
    dollarindex: veld('macro', 'dxy'),
    stablecoinAanbodMrdUSD: veld('crypto', 'stables'),
    toelichting: 'Gemeten kapitaalstroom-indicatoren. Bewust NIET verwerkt in de kansverdelingen hierboven; die weging wordt herzien bij de kwartaalreview van oktober 2026. NFCI: negatief = ruime condities.',
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
    dominantie: dominantie(s.faseVerdeling || s.regimeVerdeling),
    stabiliteit: s.stabiliteit || null,
  };
}

function dominantie(verdeling) {
  const w = Object.values(verdeling || {});
  return w.length ? Math.round(Math.max(...w)) / 100 : null;
}

function wijzigingen(log) {
  const leesbaar = [];
  const detail = [];
  for (const soort of ['macro', 'crypto']) {
    const reeks = (log || []).filter((e) => e.soort === soort);
    if (reeks.length < 2) continue;
    const [vorig, nu] = reeks.slice(-2);
    const label = soort === 'macro' ? 'Macro' : 'Crypto';
    const standV = vorig.fase || vorig.regime, standN = nu.fase || nu.regime;
    if (standV !== standN) {
      leesbaar.push(label + ': stand ' + standV + ' \u2192 ' + standN);
      detail.push({ soort, type: 'stand', van: standV, naar: standN });
    }
    for (const k of new Set([...Object.keys(vorig.verdeling || {}), ...Object.keys(nu.verdeling || {})])) {
      const a = (vorig.verdeling || {})[k] || 0, b = (nu.verdeling || {})[k] || 0;
      if (Math.abs(b - a) >= 3) {
        leesbaar.push(label + ': kans op ' + k + ' ' + a + '% \u2192 ' + b + '%');
        detail.push({ soort, type: 'verdeling', onderdeel: k, van: a, naar: b });
      }
    }
    const oude = Object.fromEntries((vorig.calls || []).map((c) => [c.n, c]));
    for (const c of nu.calls || []) {
      const o = oude[c.n];
      if (!o) {
        leesbaar.push(label + ': nieuwe call ' + c.n + ' (' + c.r + ' ' + c.kMin + '\u2013' + c.kMax + '%)');
        detail.push({ soort, type: 'nieuwe-call', naam: c.n, richting: c.r });
      } else if (o.r !== c.r) {
        leesbaar.push(label + ': ' + c.n + ' ' + o.r + ' \u2192 ' + c.r);
        detail.push({ soort, type: 'richting', naam: c.n, van: o.r, naar: c.r });
      }
    }
  }
  return { leesbaar, detail };
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
  const L = rapport.liquiditeit;
  if (L) {
    const lijn = (naam, x, eenheid) => {
      if (!x) return null;
      const d = x.delta30d === null ? '' : ' (' + (x.delta30d > 0 ? '+' : '') + x.delta30d + ' ov. 30d)';
      return '- ' + naam + ': ' + x.waarde + (eenheid || '') + d;
    };
    const regels = [
      lijn('Netto liquiditeit', L.nettoLiquiditeitMrdUSD, ' mrd'),
      lijn('Financiele condities (NFCI)', L.financieleCondities, ''),
      lijn('Dollarindex', L.dollarindex, ''),
      lijn('Stablecoin-aanbod', L.stablecoinAanbodMrdUSD, ' mrd'),
    ].filter(Boolean);
    if (regels.length) {
      r.push('');
      r.push((md ? '## ' : '') + 'KAPITAALSTROMEN (gemeten, nog niet gewogen)');
      r.push(...regels);
    }
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
    const [macro, crypto, log, reeks] = await Promise.all([
      env.TAKUMI_USERS.get('radar:latest:macro', 'json'),
      env.TAKUMI_USERS.get('radar:latest:crypto', 'json'),
      env.TAKUMI_USERS.get('radar:log', 'json'),
      env.TAKUMI_USERS.get('radar:reeks', 'json'),
    ]);
    const w = wijzigingen(log);
    const tijden = [macro && macro.t, crypto && crypto.t].filter(Boolean);
    const rapport = {
      versie: '1.3',
      bron: 'takumi-master.com/radar',
      gegenereerd: new Date().toISOString(),
      laatstBijgewerkt: tijden.length ? new Date(Math.max(...tijden)).toISOString() : null,
      disclaimer: 'Kansverdelingen, geen voorspellingen; educatief, geen beleggingsadvies.',
      toelichting: 'dominantie = zwaarste gewicht in de verdeling (0-1); stabiliteit = spreiding tussen ensemble-runs in punten (lager is stabieler); empirische kalibratie in trackrecord.brier (crypto, 4 weken) en trackrecordMacro.brier (sectoren via ETF-koersen, 6 maanden).',
      macro: signaalBlok(macro),
      crypto: signaalBlok(crypto),
      trackrecord: scoreCrypto(log),
      trackrecordMacro: scoreMacro(log),
      liquiditeit: liquiditeitBlok(reeks),
      meetfouten: reeks && reeks.length ? (reeks[reeks.length - 1].fouten || null) : null,
      wijzigingSindsVorigeRun: w.leesbaar,
      wijzigingenDetail: w.detail,
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
