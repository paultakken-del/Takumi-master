/**
 * Cyclusradar server-side.
 * GET  /api/radar                    -> { macro, crypto, log }
 * POST /api/radar  {"soort":"macro"|"crypto"} -> genereert vers signaal, slaat op in KV
 *
 * Bescherming: throttle van 6 uur per soort. Optioneel: zet env RADAR_KEY;
 * dan is een header x-radar-key vereist en geldt de throttle niet voor die aanroepen.
 */

const MODEL = 'claude-sonnet-4-20250514';
const LOG_KEY = 'radar:log';
const THROTTLE_MS = 6 * 3600 * 1000;

/* ---------- Anthropic ---------- */
async function anthropic(env, body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'API-fout');
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function parseJson(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  const a = clean.indexOf('{');
  const b = clean.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('geen JSON in antwoord');
  return JSON.parse(clean.slice(a, b + 1));
}

function pakGetal(tekst, patroon) {
  const m = tekst.match(patroon);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/* ---------- prompts ---------- */
const MACRO_RESEARCH = `Use web search to find the MOST RECENT values. Report each as one short line "name: value (date)": (1) US 10y-2y Treasury spread, (2) ISM Manufacturing PMI, (3) US unemployment rate vs its 12-month low (Sahm rule), (4) US High Yield OAS credit spread, (5) US CPI YoY, (6) Fed policy stance, (7) WTI oil price YoY change, (8) VIX, (9) S&P 500 index level. Output only the 9 lines.`;

const MACRO_KERN = (research) => `You are a macro business-cycle analyst with deep knowledge of 1900-2026 cycle history. Classify the current phase based on these readings.
Respond ONLY minified JSON, Dutch, terse: {"datum":"YYYY-MM-DD","fase":"vroeg|midden|laat|contractie","faseVerdeling":{"vroeg":10,"midden":25,"laat":45,"contractie":20},"samenvatting":"max 18 woorden","synthese":"max 40 woorden","indicatoren":[{"n":"naam","w":"waarde","s":"groen|geel|rood","d":"max 8 woorden"}]}
faseVerdeling sums to 100, spread honestly. Exactly 8 indicatoren.

Readings:
${research}`;

const MACRO_SECT = (kern) => `You are a sector-rotation analyst. Cycle assessment: phase=${kern.fase}, distribution=${JSON.stringify(kern.faseVerdeling)}, synthesis="${kern.synthese}". Estimate 6-month directional probabilities per sector from historical rotation patterns.
Respond ONLY minified JSON, Dutch, terse: {"sectoren":[{"n":"naam","r":"up|down|neutraal","kMin":50,"kMax":70,"reden":"max 6 woorden"}],"analogieen":[{"p":"periode","o":"max 8 woorden"}]}
Ranges never narrower than 10 points. Sectors: Technologie, Financi\u00eble waarden, Energie, Gezondheidszorg, Industrie, Defensieve consument, Cyclische consument, Grondstoffen, Vastgoed, Nutsbedrijven. Exactly 2 analogieen.`;

const CRYPTO_RESEARCH = `Use web search to find the MOST RECENT crypto indicators. One short line each "name: value (date)": (1) Bitcoin price USD, (2) MVRV z-score, (3) BTC funding rates, (4) stablecoin market cap 30d trend, (5) Bitcoin dominance %, (6) US spot BTC ETF net flows, (7) ETH price USD and ETH/BTC trend, (8) Fear & Greed index. Output only the 8 lines.`;

const CRYPTO_KERN = (research, mnd) => `You are a crypto market-cycle analyst. Only 4 complete cycles exist; every conclusion is a regime ESTIMATE with wide uncertainty. Position: ${mnd} months since the April 2024 halving (historical peaks month 16-19).
Respond ONLY minified JSON, Dutch, terse: {"datum":"YYYY-MM-DD","regime":"accumulatie|expansie|euforie|distributie|capitulatie","regimeVerdeling":{"accumulatie":10,"expansie":30,"euforie":15,"distributie":35,"capitulatie":10},"samenvatting":"max 18 woorden","synthese":"max 40 woorden","indicatoren":[{"n":"naam","w":"waarde","s":"groen|geel|rood","d":"max 8 woorden"}]}
regimeVerdeling sums to 100. Exactly 8 indicatoren.

Readings:
${research}`;

const CRYPTO_ASSETS = (kern, mnd) => `You are a crypto-cycle analyst. Regime: ${kern.regime}, distribution=${JSON.stringify(kern.regimeVerdeling)}, ${mnd} months post-halving.
Respond ONLY minified JSON, Dutch, terse: {"assets":[{"n":"Bitcoin","r":"up|down|neutraal","kMin":45,"kMax":70,"reden":"max 6 woorden"},{"n":"Ethereum","r":"...","kMin":40,"kMax":60,"reden":"..."},{"n":"Altcoins breed","r":"...","kMin":30,"kMax":60,"reden":"..."}],"analogieen":[{"p":"cyclus","o":"max 8 woorden"}]}
4-6 WEEK horizon, ranges never narrower than 15 points. Exactly 3 assets, 2 analogieen.`;

const maandenSindsHalving = () =>
  Math.floor((Date.now() - new Date('2024-04-19').getTime()) / (30.44 * 24 * 3600 * 1000));

/* ---------- generatie ---------- */
async function genereer(env, soort) {
  const zoek = { tools: [{ type: 'web_search_20250305', name: 'web_search' }] };
  let research = '';
  try {
    research = await anthropic(env, {
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: soort === 'macro' ? MACRO_RESEARCH : CRYPTO_RESEARCH }],
      ...zoek,
    });
  } catch (e) {
    research = 'Live data niet beschikbaar; schat conservatief op basis van je kennis en zeg dat erbij.';
  }

  if (soort === 'macro') {
    const kern = parseJson(await anthropic(env, {
      model: MODEL, max_tokens: 1500,
      messages: [{ role: 'user', content: MACRO_KERN(research) }],
    }));
    const sect = parseJson(await anthropic(env, {
      model: MODEL, max_tokens: 1500,
      messages: [{ role: 'user', content: MACRO_SECT(kern) }],
    }));
    const spx = pakGetal(research, /S&P\s*500[^0-9]{0,25}([\d.,]{3,10})/i);
    return { ...kern, ...sect, ref: spx ? { spx } : null };
  }

  const mnd = maandenSindsHalving();
  const kern = parseJson(await anthropic(env, {
    model: MODEL, max_tokens: 1500,
    messages: [{ role: 'user', content: CRYPTO_KERN(research, mnd) }],
  }));
  const rest = parseJson(await anthropic(env, {
    model: MODEL, max_tokens: 1500,
    messages: [{ role: 'user', content: CRYPTO_ASSETS(kern, mnd) }],
  }));
  const btc = pakGetal(research, /Bitcoin[^0-9$]{0,35}\$?\s?([\d.,]{4,12})/i);
  const eth = pakGetal(research, /(?:Ethereum|ETH)[^0-9$]{0,35}\$?\s?([\d.,]{3,12})/i);
  return { ...kern, ...rest, ref: btc || eth ? { btc, eth } : null };
}

/* ---------- handlers ---------- */
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestGet({ env }) {
  const [macro, crypto, log] = await Promise.all([
    env.TAKUMI_USERS.get('radar:latest:macro', 'json'),
    env.TAKUMI_USERS.get('radar:latest:crypto', 'json'),
    env.TAKUMI_USERS.get(LOG_KEY, 'json'),
  ]);
  return json({ macro, crypto, log: log || [] });
}

export async function onRequestPost({ request, env }) {
  let soort;
  try {
    soort = (await request.json()).soort;
  } catch {
    return json({ fout: 'body ontbreekt' }, 400);
  }
  if (soort !== 'macro' && soort !== 'crypto') return json({ fout: 'soort moet macro of crypto zijn' }, 400);

  const sleutelOk = env.RADAR_KEY && request.headers.get('x-radar-key') === env.RADAR_KEY;
  if (env.RADAR_KEY && !sleutelOk && request.headers.get('x-radar-key')) {
    return json({ fout: 'ongeldige sleutel' }, 403);
  }

  const laatste = await env.TAKUMI_USERS.get(`radar:latest:${soort}`, 'json');
  if (!sleutelOk && laatste && Date.now() - laatste.t < THROTTLE_MS) {
    const min = Math.ceil((THROTTLE_MS - (Date.now() - laatste.t)) / 60000);
    return json({ fout: `signaal is vers; nieuw genereren kan over ${min} minuten`, laatste }, 429);
  }

  try {
    const sig = await genereer(env, soort);
    const entry = {
      t: Date.now(),
      soort,
      datum: sig.datum,
      fase: sig.fase,
      regime: sig.regime,
      verdeling: sig.faseVerdeling || sig.regimeVerdeling,
      calls: (sig.sectoren || sig.assets || []).map((x) => ({ n: x.n, r: x.r, kMin: x.kMin, kMax: x.kMax })),
      ref: sig.ref,
    };
    const log = (await env.TAKUMI_USERS.get(LOG_KEY, 'json')) || [];
    log.push(entry);
    await env.TAKUMI_USERS.put(LOG_KEY, JSON.stringify(log.slice(-60)));
    await env.TAKUMI_USERS.put(`radar:latest:${soort}`, JSON.stringify({ t: entry.t, sig }));
    return json({ t: entry.t, sig });
  } catch (e) {
    return json({ fout: e.message || 'generatie mislukt' }, 502);
  }
}
