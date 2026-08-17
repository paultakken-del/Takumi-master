/**
 * Cyclusradar v2 - meten en wegen gescheiden.
 *
 * GET  /api/radar                                -> { macro, crypto, log }
 * POST /api/radar {"stap":"meting"}              -> dagelijkse indicatorsnapshot (geen AI)
 * POST /api/radar {"stap":"signaal","soort":..}  -> ensemble-weging (3 runs, mediaan)
 *
 * Bronnen: FRED (fredgraph.csv), CoinGecko, Stooq, alternative.me - allemaal zonder sleutel.
 *
 * Liquiditeitsmeters (netliq, nfci, dxy, stables) worden sinds 29-7-2026 WEL gemeten
 * maar bewust NIET gewogen: de weegprompt blijft ongewijzigd tot de kwartaalreview van
 * oktober 2026, zodat de lopende forward test zuiver blijft.
 * Bescherming: meting max 1x/12u, signaal max 1x/6u per soort; env RADAR_KEY omzeilt.
 */

const MODEL = 'claude-sonnet-4-6';
const LOG_KEY = 'radar:log';
const REEKS_KEY = 'radar:reeks';
const THROTTLE_MS = 6 * 3600 * 1000;
const METING_MS = 30 * 60 * 1000;

/* ---------------- databronnen (deterministisch) ---------------- */

const UA = 'Mozilla/5.0 (X11; Linux x86_64) TakumiRadar/2.1';

async function csv(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/csv,*/*' } });
  if (!r.ok) throw new Error('status ' + r.status);
  return (await r.text()).trim().split('\n').map((l) => l.split(','));
}

async function haalJson(url, extra) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...(extra || {}) } });
  if (!r.ok) throw new Error('status ' + r.status);
  return r.json();
}

async function fred(env, serie, jarenTerug = 3) {
  const start = new Date(Date.now() - jarenTerug * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const rijen = await csv('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + serie + '&cosd=' + start);
    const data = rijen.slice(1).filter((r) => r[1] && r[1] !== '.').map((r) => ({ d: r[0], v: parseFloat(r[1]) }));
    if (!data.length) throw new Error('leeg');
    return data;
  } catch (e) {
    if (!env.FRED_KEY) throw e;
    const j = await haalJson('https://api.stlouisfed.org/fred/series/observations?series_id=' + serie +
      '&api_key=' + env.FRED_KEY + '&file_type=json&observation_start=' + start);
    const data = (j.observations || []).filter((o) => o.value !== '.').map((o) => ({ d: o.date, v: parseFloat(o.value) }));
    if (!data.length) throw new Error('leeg (api)');
    return data;
  }
}

const laatsteVan = (reeks) => reeks[reeks.length - 1];

function yoy(reeks) {
  const nu = laatsteVan(reeks);
  const doel = new Date(nu.d).getTime() - 365 * 24 * 3600 * 1000;
  const vorig = reeks.reduce((a, b) => (Math.abs(new Date(b.d).getTime() - doel) < Math.abs(new Date(a.d).getTime() - doel) ? b : a));
  return Math.round(((nu.v - vorig.v) / vorig.v) * 1000) / 10;
}

async function stooq(symbool) {
  const rijen = await csv('https://stooq.com/q/l/?s=' + symbool + '&f=sd2t2ohlcv&h&e=csv');
  const v = parseFloat(rijen[1][6]);
  if (!Number.isFinite(v)) throw new Error('stooq ' + symbool);
  return v;
}

const SECTOR_ETF = {
  'Technologie': 'xlk.us', 'Financi\u00eble waarden': 'xlf.us', 'Energie': 'xle.us',
  'Gezondheidszorg': 'xlv.us', 'Industrie': 'xli.us', 'Defensieve consument': 'xlp.us',
  'Cyclische consument': 'xly.us', 'Grondstoffen': 'xlb.us', 'Vastgoed': 'xlre.us', 'Nutsbedrijven': 'xlu.us',
};

async function veilig(fouten, naam, fn) {
  try { return await fn(); } catch (e) { fouten[naam] = String(e.message || e).slice(0, 60); return null; }
}

async function metingMacro(env, fouten) {
  const f = (naam, serie, bewerk, jr) => veilig(fouten, naam, async () => {
    const reeks = await fred(env, serie, jr || 3);
    return bewerk ? bewerk(reeks) : laatsteVan(reeks).v;
  });
  const [spread, sahm, hy, cpi, unrate, dff, wti, vix, spx, walcl, rrp, tga, nfci, dxy] = await Promise.all([
    f('spread', 'T10Y2Y', null, 1), f('sahm', 'SAHMREALTIME', null, 2), f('hy', 'BAMLH0A0HYM2', null, 1),
    f('cpi', 'CPIAUCSL', yoy), f('unrate', 'UNRATE', null, 2), f('dff', 'DFF', null, 1),
    f('wti', 'DCOILWTICO', yoy), f('vix', 'VIXCLS', null, 1), f('spx', 'SP500', null, 1),
    f('walcl', 'WALCL', null, 1), f('rrp', 'RRPONTSYD', null, 1), f('tga', 'WTREGEN', null, 1),
    f('nfci', 'NFCI', null, 1), f('dxy', 'DTWEXBGS', null, 1),
  ]);
  // netto liquiditeit in miljarden dollar: Fed-balans (mln) / 1000 - reverse repo (mrd) - schatkistrekening (mrd)
  const netliq = [walcl, rrp, tga].every((x) => Number.isFinite(x))
    ? Math.round(walcl / 1000 - rrp - tga / 1000)
    : null;
  return { spread, sahm, hy, cpi, unrate, dff, wti, vix, spx, netliq, nfci, dxy };
}

async function prijzen(fouten) {
  // keten: CoinGecko -> Coinbase -> CryptoCompare
  let btc = null, eth = null;
  const cg = await veilig(fouten, 'coingecko-prijs', () =>
    haalJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'));
  if (cg && cg.bitcoin) { btc = cg.bitcoin.usd; eth = cg.ethereum && cg.ethereum.usd; }
  if (!btc) {
    const cb = await veilig(fouten, 'coinbase', async () => ({
      b: (await haalJson('https://api.coinbase.com/v2/prices/BTC-USD/spot')).data.amount,
      e: (await haalJson('https://api.coinbase.com/v2/prices/ETH-USD/spot')).data.amount,
    }));
    if (cb) { btc = parseFloat(cb.b); eth = parseFloat(cb.e); }
  }
  if (!btc) {
    const cc = await veilig(fouten, 'cryptocompare', () =>
      haalJson('https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USD'));
    if (cc && cc.BTC) { btc = cc.BTC.USD; eth = cc.ETH && cc.ETH.USD; }
  }
  return { btc: Number.isFinite(btc) ? btc : null, eth: Number.isFinite(eth) ? eth : null };
}

async function stablecoins(fouten) {
  // aanbod USDT+USDC in miljarden: instroommeter voor crypto
  const cg = await veilig(fouten, 'stables-coingecko', async () => {
    const j = await haalJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin');
    return j.reduce((a, c) => a + (c.market_cap || 0), 0);
  });
  if (Number.isFinite(cg) && cg > 0) return Math.round(cg / 1e9);
  const cp = await veilig(fouten, 'stables-coinpaprika', async () => {
    const [t, u] = await Promise.all([
      haalJson('https://api.coinpaprika.com/v1/tickers/usdt-tether'),
      haalJson('https://api.coinpaprika.com/v1/tickers/usdc-usd-coin'),
    ]);
    return t.quotes.USD.market_cap + u.quotes.USD.market_cap;
  });
  return Number.isFinite(cp) && cp > 0 ? Math.round(cp / 1e9) : null;
}

async function metingCrypto(fouten) {
  const { btc, eth } = await prijzen(fouten);
  // dominantie: CoinGecko -> Coinpaprika
  let dominantie = await veilig(fouten, 'coingecko-globaal', async () => {
    const d = (await haalJson('https://api.coingecko.com/api/v3/global')).data;
    return Math.round(d.market_cap_percentage.btc * 10) / 10;
  });
  if (dominantie === null) {
    dominantie = await veilig(fouten, 'coinpaprika', async () => {
      const d = await haalJson('https://api.coinpaprika.com/v1/global');
      return Math.round(d.bitcoin_dominance_percentage * 10) / 10;
    });
  }
  const fng = await veilig(fouten, 'fng', async () =>
    parseInt((await haalJson('https://api.alternative.me/fng/')).data[0].value, 10));
  const stables = await stablecoins(fouten);
  return {
    btc, eth,
    ethbtc: btc && eth ? Math.round((eth / btc) * 100000) / 100000 : null,
    dominantie,
    fng: Number.isFinite(fng) ? fng : null,
    stables,
  };
}

async function metingEtf(fouten) {
  const uit = {};
  const mislukt = [];
  // Losse aanroepen: Stooq's meervoudige vorm gaf 404. Crypto meet als eerste,
  // dus er is ruimte binnen de subrequest-limiet.
  await Promise.all(Object.entries(SECTOR_ETF).map(async ([naam, sym]) => {
    let v = await veilig({}, sym, () => stooq(sym));
    if (!Number.isFinite(v)) {
      const y = sym.replace('.us', '').toUpperCase();
      v = await veilig({}, y, async () => {
        const j = await haalJson('https://query1.finance.yahoo.com/v8/finance/chart/' + y + '?range=1d&interval=1d');
        return j.chart.result[0].meta.regularMarketPrice;
      });
    }
    if (Number.isFinite(v)) uit[naam] = Math.round(v * 100) / 100;
    else mislukt.push(sym);
  }));
  if (mislukt.length) fouten.etf = 'geen koers voor: ' + mislukt.join(', ');
  return uit;
}

/* ---------------- reeks en delta's ---------------- */

const num = (x) => (Number.isFinite(x) ? x : null);

function dichtstbij(reeks, dagenTerug) {
  const doel = Date.now() - dagenTerug * 24 * 3600 * 1000;
  let beste = null;
  for (const m of reeks) if (!beste || Math.abs(m.t - doel) < Math.abs(beste.t - doel)) beste = m;
  return beste;
}

function metDelta(reeks, pad, nu) {
  const lees = (m) => (m ? pad.split('.').reduce((a, k) => (a == null ? null : a[k]), m) : null);
  const oudGenoeg = reeks.length > 3;
  const fmt = (a) => (num(a) !== null && num(nu) !== null ? Math.round((nu - a) * 100) / 100 : null);
  return {
    w: num(nu),
    d30: oudGenoeg ? fmt(lees(dichtstbij(reeks, 30))) : null,
    d90: oudGenoeg ? fmt(lees(dichtstbij(reeks, 90))) : null,
  };
}

function regel(naam, eenheid, x) {
  if (x.w === null) return naam + ': niet beschikbaar';
  const d = (v, lbl) => (v === null ? '' : ', ' + (v > 0 ? '+' : '') + v + ' ' + lbl);
  return naam + ': ' + x.w + eenheid + d(x.d30, 'ov. 30d') + d(x.d90, 'ov. 90d');
}

/* ---------------- basisrates ---------------- */

const BASIS_MACRO = 'Historische basisrates (VS, 1955-2024; blijf hier trouw aan of benoem expliciet in synthese waarom je afwijkt):\n' +
'- Een 10j-2j inversie ging vooraf aan elke Amerikaanse recessie sinds 1955, met een vals signaal (1966); de recessie begon meestal 6-24 maanden NA de inversie, vaak rond re-steepening.\n' +
'- Sahm-indicator boven 0,50 markeerde historisch vrijwel altijd een reeds begonnen recessie.\n' +
'- HY-spreads onder ~4% duiden op ruime kredietcondities (midden/laat); boven ~6% op stress.\n' +
'- Olieprijsschokken (>50% j-o-j) gingen vooraf aan meerdere recessies (1973, 1979, 1990, 2008).\n' +
'- Laat-cyclisch presteerden energie en defensieve sectoren historisch relatief sterk; vroeg-cyclisch cyclische consument en financiele waarden.\n' +
'- Rotatiepatronen zijn regelmatig, niet wetmatig: houd bandbreedtes breed.';

const BASIS_CRYPTO = 'Historische basisrates (4 cycli, zwak bewijs; richtinggevend, geen wet):\n' +
'- Cyclustoppen vielen 13-18 maanden na de halving (2013 ~13, 2017 ~17, 2021 ~18 maanden).\n' +
'- Elke top werd gevolgd door een drawdown van 77-93%.\n' +
'- Stijgende BTC-dominantie past bij risico-aversie binnen crypto; dalende bij laat-cyclische altcoin-expansie.\n' +
'- Extreme Fear & Greed (>80 of <20) viel vaker samen met lokale toppen respectievelijk bodems.\n' +
'- n=4: elke conclusie is een regime-inschatting met brede marges.';

/* ---------------- prompts ---------------- */

const MACRO_PROMPT = (blok) => 'You are a macro business-cycle analyst with deep knowledge of 1900-2026 cycle history. Weigh ONLY the indicator data below (values plus 30/90-day changes; direction and speed matter as much as level). Anchor your probabilities in the base rates; if you deviate, say why in "synthese".\n' +
'Respond ONLY minified JSON, Dutch, terse: {"datum":"YYYY-MM-DD","fase":"vroeg|midden|laat|contractie","faseVerdeling":{"vroeg":10,"midden":25,"laat":45,"contractie":20},"samenvatting":"max 18 woorden","synthese":"max 45 woorden","sectoren":[{"n":"naam","r":"up|down|neutraal","kMin":50,"kMax":70,"reden":"max 6 woorden"}],"analogieen":[{"p":"periode","o":"max 8 woorden"}]}\n' +
'faseVerdeling sums to 100. Ranges never narrower than 10 points. Sectors exactly: ' + Object.keys(SECTOR_ETF).join(', ') + '. Exactly 2 analogieen.\n\n' + blok;

const CRYPTO_PROMPT = (blok, mnd) => 'You are a crypto market-cycle analyst. Position: ' + mnd + ' months since the April 2024 halving. Weigh ONLY the indicator data below (no on-chain data available; weigh conservatively and note it). Anchor in the base rates.\n' +
'Respond ONLY minified JSON, Dutch, terse: {"datum":"YYYY-MM-DD","regime":"accumulatie|expansie|euforie|distributie|capitulatie","regimeVerdeling":{"accumulatie":10,"expansie":30,"euforie":15,"distributie":35,"capitulatie":10},"samenvatting":"max 18 woorden","synthese":"max 45 woorden","assets":[{"n":"Bitcoin","r":"up|down|neutraal","kMin":45,"kMax":70,"reden":"max 6 woorden"},{"n":"Ethereum","r":"up|down|neutraal","kMin":40,"kMax":60,"reden":"max 6 woorden"},{"n":"Altcoins breed","r":"up|down|neutraal","kMin":30,"kMax":60,"reden":"max 6 woorden"}],"analogieen":[{"p":"cyclus","o":"max 8 woorden"}]}\n' +
'regimeVerdeling sums to 100. 4-6 WEEK horizon, ranges never narrower than 15 points. Exactly 2 analogieen.\n\n' + blok;

const maandenSindsHalving = () =>
  Math.floor((Date.now() - new Date('2024-04-19').getTime()) / (30.44 * 24 * 3600 * 1000));

/* ---------------- AI + ensemble ---------------- */

async function anthropic(env, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'API-fout');
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function parseJson(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('geen JSON');
  return JSON.parse(clean.slice(a, b + 1));
}

const mediaan = (arr) => {
  const s = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

const modus = (arr) => {
  const geldige = arr.filter(Boolean);
  return geldige.sort((a, b) => geldige.filter((x) => x === a).length - geldige.filter((x) => x === b).length).pop();
};

function combineer(runs, verdelingVeld, callsVeld) {
  const geldig = runs.filter(Boolean);
  if (!geldig.length) throw new Error('alle ensemble-runs mislukt');
  const stand = modus(geldig.map((r) => r.fase || r.regime));
  const sleutels = Object.keys(geldig[0][verdelingVeld] || {});
  let verdeling = Object.fromEntries(sleutels.map((k) => [k, mediaan(geldig.map((r) => (r[verdelingVeld] || {})[k] || 0))]));
  const som = Object.values(verdeling).reduce((a, b) => a + b, 0) || 1;
  verdeling = Object.fromEntries(Object.entries(verdeling).map(([k, v]) => [k, Math.round((v / som) * 100)]));
  const spreiding = Math.max(...sleutels.map((k) => {
    const w = geldig.map((r) => (r[verdelingVeld] || {})[k] || 0);
    return Math.max(...w) - Math.min(...w);
  }));
  const namen = (geldig[0][callsVeld] || []).map((c) => c.n);
  const calls = namen.map((n) => {
    const varianten = geldig.map((r) => (r[callsVeld] || []).find((c) => c.n === n)).filter(Boolean);
    if (!varianten.length) return null;
    const r = modus(varianten.map((c) => c.r));
    const basis = varianten.find((c) => c.r === r) || varianten[0];
    return { n, r, kMin: mediaan(varianten.map((c) => c.kMin)), kMax: mediaan(varianten.map((c) => c.kMax)), reden: basis.reden || '' };
  }).filter((c) => c && Number.isFinite(c.kMin) && Number.isFinite(c.kMax) && c.kMin >= 1 && c.kMax <= 99 && c.kMin <= c.kMax);
  const basisRun = geldig.find((r) => (r.fase || r.regime) === stand) || geldig[0];
  return {
    stand, verdeling, calls, spreiding, runs: geldig.length,
    samenvatting: basisRun.samenvatting || '', synthese: basisRun.synthese || '',
    analogieen: basisRun.analogieen || [], datum: basisRun.datum,
  };
}

/* ---------------- handlers ---------------- */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestGet({ env }) {
  const [macro, crypto, log, reeks] = await Promise.all([
    env.TAKUMI_USERS.get('radar:latest:macro', 'json'),
    env.TAKUMI_USERS.get('radar:latest:crypto', 'json'),
    env.TAKUMI_USERS.get(LOG_KEY, 'json'),
    env.TAKUMI_USERS.get(REEKS_KEY, 'json'),
  ]);
  const m = (reeks || [])[reeks ? reeks.length - 1 : 0] || null;
  return json({ macro, crypto, log: log || [],
    meting: m ? { t: m.t, macro: m.macro, crypto: m.crypto, etfAantal: Object.keys(m.etf || {}).length,
      fouten: m.fouten || null, reeksLengte: (reeks || []).length,
      sleutels: { fred: !!env.FRED_KEY, radar: !!env.RADAR_KEY } } : null });
}

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try { body = await request.json(); } catch { return json({ fout: 'body ontbreekt' }, 400); }
    const { stap, soort } = body;
    const sleutelOk = env.RADAR_KEY && request.headers.get('x-radar-key') === env.RADAR_KEY;

    if (stap === 'test') {
      const fouten = {};
      const crypto = await metingCrypto(fouten);
      const [macro, etf] = await Promise.all([metingMacro(env, fouten), metingEtf(fouten)]);
      return json({ macro, crypto, etfAantal: Object.keys(etf).length, fouten });
    }

    if (stap === 'meting') {
      const reeks = (await env.TAKUMI_USERS.get(REEKS_KEY, 'json')) || [];
      const vorige = reeks[reeks.length - 1];
      if (!sleutelOk && vorige && Date.now() - vorige.t < METING_MS) {
        return json({ fout: 'meting is vers', laatste: vorige.t }, 429);
      }
      const fouten = {};
      const crypto = await metingCrypto(fouten);
      const [macro, etf] = await Promise.all([metingMacro(env, fouten), metingEtf(fouten)]);
      const m = { t: Date.now(), macro, crypto, etf };
      if (Object.keys(fouten).length) m.fouten = fouten;
      reeks.push(m);
      await env.TAKUMI_USERS.put(REEKS_KEY, JSON.stringify(reeks.slice(-400)));
      return json({ ok: true, meting: m });
    }

    if (stap === 'signaal') {
      if (soort !== 'macro' && soort !== 'crypto') return json({ fout: 'soort moet macro of crypto zijn' }, 400);
      const laatsteSig = await env.TAKUMI_USERS.get('radar:latest:' + soort, 'json');
      if (!sleutelOk && laatsteSig && Date.now() - laatsteSig.t < THROTTLE_MS) {
        const min = Math.ceil((THROTTLE_MS - (Date.now() - laatsteSig.t)) / 60000);
        return json({ fout: 'signaal is vers; nieuw genereren kan over ' + min + ' minuten' }, 429);
      }
      const reeks = (await env.TAKUMI_USERS.get(REEKS_KEY, 'json')) || [];
      if (!reeks.length) return json({ fout: 'nog geen meting; draai eerst stap meting' }, 409);
      const m = reeks[reeks.length - 1];
      const dataOud = Date.now() - m.t > 3 * 24 * 3600 * 1000;

      let prompt, indicatoren, ref;
      if (soort === 'macro') {
        const d = (pad) => metDelta(reeks, 'macro.' + pad, m.macro[pad]);
        const I = { spread: d('spread'), sahm: d('sahm'), hy: d('hy'), cpi: d('cpi'), unrate: d('unrate'), dff: d('dff'), wti: d('wti'), vix: d('vix') };
        indicatoren = [
          ['10j-2j spread', I.spread], ['Sahm-indicator', I.sahm], ['HY-spread', I.hy], ['CPI j-o-j', I.cpi],
          ['Werkloosheid', I.unrate], ['Fed funds', I.dff], ['WTI j-o-j', I.wti], ['VIX', I.vix],
        ].map(([n, x]) => ({ n, w: x.w === null ? 'n.b.' : String(x.w), s: 'geel', d: x.d30 !== null ? ((x.d30 > 0 ? '+' : '') + x.d30 + ' ov. 30d') : 'bron: FRED' }));
        const blok = 'Indicator readings (bron: FRED, ' + new Date(m.t).toISOString().slice(0, 10) + '):\n' +
          regel('10y-2y Treasury spread', 'pp', I.spread) + '\n' + regel('Sahm rule', '', I.sahm) + '\n' +
          regel('High-yield OAS', '%', I.hy) + '\n' + regel('CPI YoY', '%', I.cpi) + '\n' +
          regel('Unemployment', '%', I.unrate) + '\n' + regel('Fed funds rate', '%', I.dff) + '\n' +
          regel('WTI oil YoY', '%', I.wti) + '\n' + regel('VIX', '', I.vix) + '\n\n' + BASIS_MACRO;
        prompt = MACRO_PROMPT(blok);
        ref = { spx: num(m.macro.spx), etf: m.etf && Object.keys(m.etf).length ? m.etf : null };
      } else {
        const d = (pad) => metDelta(reeks, 'crypto.' + pad, m.crypto[pad]);
        const I = { btc: d('btc'), eth: d('eth'), ethbtc: d('ethbtc'), dom: d('dominantie'), fng: d('fng') };
        indicatoren = [
          ['BTC (USD)', I.btc], ['ETH (USD)', I.eth], ['ETH/BTC', I.ethbtc], ['BTC-dominantie %', I.dom], ['Fear & Greed', I.fng],
        ].map(([n, x]) => ({ n, w: x.w === null ? 'n.b.' : String(x.w), s: 'geel', d: x.d30 !== null ? ((x.d30 > 0 ? '+' : '') + x.d30 + ' ov. 30d') : 'bron: CoinGecko' }));
        indicatoren.push({ n: 'Maanden na halving', w: String(maandenSindsHalving()), s: 'geel', d: 'april 2024' });
        const blok = 'Indicator readings (bron: CoinGecko/alternative.me, ' + new Date(m.t).toISOString().slice(0, 10) + '):\n' +
          regel('Bitcoin USD', '', I.btc) + '\n' + regel('Ethereum USD', '', I.eth) + '\n' +
          regel('ETH/BTC', '', I.ethbtc) + '\n' + regel('BTC dominance', '%', I.dom) + '\n' +
          regel('Fear & Greed', '', I.fng) + '\n\n' + BASIS_CRYPTO;
        prompt = CRYPTO_PROMPT(blok, maandenSindsHalving());
        ref = { btc: num(m.crypto.btc), eth: num(m.crypto.eth) };
      }

      const runs = await Promise.all([0, 1, 2].map(() => anthropic(env, prompt).then(parseJson).catch(() => null)));
      const c = combineer(runs, soort === 'macro' ? 'faseVerdeling' : 'regimeVerdeling', soort === 'macro' ? 'sectoren' : 'assets');

      const sig = {
        datum: c.datum || new Date().toISOString().slice(0, 10),
        samenvatting: c.samenvatting, synthese: c.synthese, analogieen: c.analogieen,
        indicatoren, ref, stabiliteit: { runs: c.runs, spreiding: c.spreiding },
      };
      if (dataOud) sig.dataOud = true;
      if (soort === 'macro') { sig.fase = c.stand; sig.faseVerdeling = c.verdeling; sig.sectoren = c.calls; }
      else { sig.regime = c.stand; sig.regimeVerdeling = c.verdeling; sig.assets = c.calls; }

      const entry = {
        t: Date.now(), soort, versie: 2, datum: sig.datum,
        fase: sig.fase, regime: sig.regime,
        verdeling: sig.faseVerdeling || sig.regimeVerdeling,
        calls: c.calls.map((x) => ({ n: x.n, r: x.r, kMin: x.kMin, kMax: x.kMax })),
        ref, stabiliteit: sig.stabiliteit,
      };
      const log = (await env.TAKUMI_USERS.get(LOG_KEY, 'json')) || [];
      log.push(entry);
      await env.TAKUMI_USERS.put(LOG_KEY, JSON.stringify(log.slice(-60)));
      await env.TAKUMI_USERS.put('radar:latest:' + soort, JSON.stringify({ t: entry.t, sig }));
      return json({ t: entry.t, sig });
    }

    return json({ fout: 'stap moet meting of signaal zijn' }, 400);
  } catch (e) {
    return json({ fout: 'serverfout: ' + (e.message || e) }, 500);
  }
}
