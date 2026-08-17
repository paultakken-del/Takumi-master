// /api/engine — Takumi Engine, R1.5: automatisch paper traden op BTC-EUR.
//
// De radar weegt (radar:latest:crypto), de engine handelt — fictief, binnen
// twee sloten en een 5%-grens. Geen mens in de lus; wel een publiek logboek,
// net als het trackrecord van de radar zelf.
//
//   GET  /api/engine                       → publieke status (portfolio, verslag, logboek)
//   POST /api/engine {"stap":"weekronde"}  → draait de weekronde (x-radar-key vereist)
//   POST /api/engine {"stap":"reset","bevestiging":"RESET"} → wist de engine (nooit de radar)
//
// Cron: .github/workflows/engine-cron.yml, maandag ~07:53 NL — ná de weekclose
// (ma 00:00 UTC) en ná de zondagweging van de radar. De radar kent de engine niet;
// de afhankelijkheid loopt één kant op.

const MARKT = 'BTC-EUR';
const SMA_WEKEN = 30;
const INZET_FRACTIE = 0.05;          // 5% van het vrije saldo per koop
const RADAR_MAX_LEEFTIJD_DAGEN = 9;  // weging ouder dan dit = verlopen
const RONDE_COOLDOWN_UREN = 20;      // dubbele cron-runs onschadelijk maken
const STOP_FRACTIE = 0.15;           // dagwacht: verkoop bij 15% onder de instapprijs
const LOG_MAX = 120;
const DAG_MS = 86400000;
const WEEK_MS = 7 * DAG_MS;

// Startstand: overgenomen van de eerste weekronde in de chat (12-08-2026),
// zodat de buy & hold-referentie doorloopt in plaats van opnieuw begint.
const START = {
  gestartOp: '2026-08-12T12:00:00.000Z',
  startSaldo: 10000,
  startPrijs: 56427,
  saldoEUR: 10000,
  btc: 0,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ---------------------------------------------------------------- METEN

async function haalPrijs() {
  const r = await fetch(`https://api.bitvavo.com/v2/ticker/price?market=${MARKT}`);
  if (!r.ok) throw new Error(`Bitvavo ticker: HTTP ${r.status}`);
  const prijs = Number((await r.json()).price);
  if (!Number.isFinite(prijs) || prijs <= 0) throw new Error('Bitvavo ticker: ongeldige prijs');
  return prijs;
}

// Weekcloses zelf opbouwen uit dagcandles (ISO-weken, ma 00:00 UTC), zodat we
// niet leunen op weekaggregatie van de beurs. Alleen afgesloten weken tellen.
async function haalWeektrend() {
  const r = await fetch(`https://api.bitvavo.com/v2/${MARKT}/candles?interval=1d&limit=${SMA_WEKEN * 7 + 30}`);
  if (!r.ok) throw new Error(`Bitvavo candles: HTTP ${r.status}`);
  const rauw = await r.json();
  if (!Array.isArray(rauw)) throw new Error('Bitvavo candles: onverwacht antwoord');

  const dagen = rauw
    .map((c) => ({ t: Number(c[0]), close: Number(c[4]) }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.close))
    .sort((a, b) => a.t - b.t);

  const weken = new Map(); // weekstart(ms, maandag 00:00 UTC) -> close laatste dag
  for (const d of dagen) {
    const datum = new Date(d.t);
    const dagVanWeek = (datum.getUTCDay() + 6) % 7; // ma=0 ... zo=6
    const weekStart = Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()) - dagVanWeek * DAG_MS;
    weken.set(weekStart, d.close); // dagen lopen op, dus dit eindigt op de laatste dag
  }

  const nu = Date.now();
  const afgesloten = [...weken.entries()]
    .filter(([start]) => start + WEEK_MS <= nu)
    .sort((a, b) => b[0] - a[0]);

  if (afgesloten.length < SMA_WEKEN) throw new Error('Te weinig afgesloten weken voor de 30-weeks trend');

  const venster = afgesloten.slice(0, SMA_WEKEN);
  const sma = venster.reduce((som, [, close]) => som + close, 0) / SMA_WEKEN;
  const [laatsteStart, laatsteClose] = venster[0];

  return {
    laatsteWeekclose: laatsteClose,
    weekVan: new Date(laatsteStart).toISOString().slice(0, 10),
    sma30: Math.round(sma * 100) / 100,
    bovenTrend: laatsteClose > sma,
  };
}

// ---------------------------------------------------------------- WEGEN

async function leesRadar(env) {
  const opgeslagen = await env.TAKUMI_USERS.get('radar:latest:crypto', 'json');
  if (!opgeslagen || !opgeslagen.sig) {
    return { status: 'ontbreekt', melding: 'Geen crypto-weeksignaal in KV. Heeft de radar al gewogen?' };
  }
  const { t, sig } = opgeslagen;
  const leeftijdDagen = (Date.now() - t) / DAG_MS;
  const basis = {
    regime: sig.regime,
    verdeling: sig.regimeVerdeling || null,
    datum: sig.datum,
    tijdstip: new Date(t).toISOString(),
    leeftijdDagen: Math.round(leeftijdDagen * 10) / 10,
    samenvatting: sig.samenvatting,
  };
  if (!basis.verdeling) return { status: 'onvolledig', melding: 'regimeVerdeling ontbreekt in het weeksignaal.', ...basis };
  if (leeftijdDagen > RADAR_MAX_LEEFTIJD_DAGEN) {
    return { status: 'verouderd', melding: `Weging is ${Math.floor(leeftijdDagen)} dagen oud (max ${RADAR_MAX_LEEFTIJD_DAGEN}).`, ...basis };
  }
  if (sig.dataOud) {
    return { status: 'degradatie', melding: 'De radar meldt zelf verouderde brondata (dataOud) — eerlijke onzekerheid wordt geen trade.', ...basis };
  }
  return { status: 'ok', ...basis };
}

// ---------------------------------------------------------------- HANDELEN

function bepaalAdvies({ radar, trend, portfolio }) {
  if (radar.status !== 'ok') {
    return {
      actie: 'GEEN_ACTIE',
      reden: `Weging niet bruikbaar (${radar.status}): ${radar.melding} De engine handelt niet zonder eerlijke weging.`,
      sloten: null,
    };
  }
  const v = radar.verdeling; // percentages, som 100
  const sloten = {
    koop: { seizoen: v.accumulatie > v.capitulatie, markt: trend.bovenTrend },
    verkoop: { seizoen: v.distributie > v.expansie, markt: !trend.bovenTrend },
  };
  const eur = (n) => `€${Math.round(n).toLocaleString('nl-NL')}`;
  const heeftPositie = portfolio.btc > 0;

  if (!heeftPositie && sloten.koop.seizoen && sloten.koop.markt) {
    return {
      actie: 'KOOP',
      reden: `Beide koopsloten open: accumulatie ${v.accumulatie}% > capitulatie ${v.capitulatie}%, en weekclose ${eur(trend.laatsteWeekclose)} boven het 30-weeks gemiddelde ${eur(trend.sma30)}.`,
      sloten,
    };
  }
  if (heeftPositie && sloten.verkoop.seizoen && sloten.verkoop.markt) {
    return {
      actie: 'VERKOOP',
      reden: `Beide verkoopsloten open: distributie ${v.distributie}% > expansie ${v.expansie}%, en weekclose ${eur(trend.laatsteWeekclose)} onder het 30-weeks gemiddelde ${eur(trend.sma30)}.`,
      sloten,
    };
  }
  const s = heeftPositie ? sloten.verkoop : sloten.koop;
  const dicht = [!s.seizoen && 'seizoenslot (radarweging)', !s.markt && 'marktslot (30-weeks trend)'].filter(Boolean).join(' en ');
  return {
    actie: 'GEEN_ACTIE',
    reden: heeftPositie
      ? `Positie vastgehouden: ${dicht} nog dicht voor verkoop.`
      : `Geen instap: ${dicht} nog dicht voor koop.`,
    sloten,
  };
}


// ================================================================ ETF-ENVELOP
// Tweede, gescheiden envelop: Pauls werkelijke ETF-mix als één blok, paper.
// De macroweging (vroeg/midden/laat/contractie) is het seizoenslot, de
// 30-weeks trend van IWDA (kernpositie, wereldindex) het marktslot.
// Twee standen: IN (het blok) of UIT (cash). Fractionele aantallen zijn
// toegestaan — dit is papier, de schakelaar is wat getest wordt.

const ETF_MACRO_MAX_LEEFTIJD_DAGEN = 35; // macrosignaal is maandelijks
const ETF_TREND_SYMBOOL = 'iwda.nl';

// Startmix per 13-08-2026 (DEGIRO-export van Paul; koersen = slotkoersen export).
// Per positie meerdere Stooq-kandidaten; de eerste die antwoordt wint.
const ETF_START = {
  gestartOp: '2026-08-13T00:00:00.000Z',
  startWaarde: 16820.07,
  stand: 'IN',
  cashEUR: 247.48,
  posities: [
    { naam: 'iShares Core MSCI World', isin: 'IE00B4L5Y983', symbolen: ['iwda.nl'], aantal: 29, prijs: 128.84, prijsVan: '2026-08-13' },
    { naam: 'iShares Core MSCI EM IMI', isin: 'IE00BKM4GZ66', symbolen: ['emim.nl'], aantal: 75, prijs: 47.11, prijsVan: '2026-08-13' },
    { naam: 'Franklin FTSE India', isin: 'IE00BHZRQZ17', symbolen: ['flxi.de'], aantal: 25, prijs: 36.11, prijsVan: '2026-08-13' },
    { naam: 'SPDR MSCI World Small Cap', isin: 'IE00BCBJG560', symbolen: ['zprs.de', 'wdsc.uk'], aantal: 5, prijs: 131.92, prijsVan: '2026-08-13' },
    { naam: 'VanEck Defense', isin: 'IE000YYE6WK5', symbolen: ['dfen.de', 'dfns.nl'], aantal: 33, prijs: 58.80, prijsVan: '2026-08-13' },
    { naam: 'VanEck Gold Miners', isin: 'IE00BQQP9F84', symbolen: ['gdx.nl', 'g2x.de'], aantal: 15, prijs: 88.39, prijsVan: '2026-08-13' },
    { naam: 'VanEck World Equal Weight', isin: 'NL0010408704', symbolen: ['tswe.nl'], aantal: 28, prijs: 43.45, prijsVan: '2026-08-13' },
    { naam: 'Vanguard FTSE Developed Europe', isin: 'IE00B945VV12', symbolen: ['veur.nl'], aantal: 31, prijs: 50.93, prijsVan: '2026-08-13' },
    { naam: 'WisdomTree AI', isin: 'IE00BDVPNG13', symbolen: ['wti2.de', 'wtai.uk'], aantal: 12, prijs: 104.40, prijsVan: '2026-08-13' },
    { naam: 'Xtrackers II ESG EUR Corp Bond', isin: 'LU0484968812', symbolen: ['xb4f.de'], aantal: 3, prijs: 142.06, prijsVan: '2026-08-13' },
  ],
};

const TIJDSLIMIET = 6000;
const haalMetLimiet = (url) => fetch(url, { signal: AbortSignal.timeout(TIJDSLIMIET) });

async function stooqKoers(symbolen) {
  for (const s of symbolen) {
    try {
      const r = await haalMetLimiet(`https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&h&e=csv`);
      if (!r.ok) continue;
      const regels = (await r.text()).trim().split('\n');
      if (regels.length < 2) continue;
      const kolommen = regels[1].split(',');
      const koers = parseFloat(kolommen[6]);
      if (Number.isFinite(koers) && koers > 0) return { koers, symbool: s, datum: kolommen[1] };
    } catch { /* volgende kandidaat */ }
  }
  return null;
}

// 30-weeks trend van de wereldindex via Stooq-daghistorie (ISO-weken, alleen afgesloten).
async function haalEtfTrend() {
  // Alleen het benodigde venster ophalen en parseren: de volledige historie kost te veel rekentijd.
  const ymd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
  const vanaf = ymd(Date.now() - 400 * DAG_MS);
  const tot = ymd(Date.now());
  const r = await haalMetLimiet(`https://stooq.com/q/d/l/?s=${ETF_TREND_SYMBOOL}&i=d&d1=${vanaf}&d2=${tot}`);
  if (!r.ok) throw new Error(`Stooq historie: HTTP ${r.status}`);
  const alleRegels = (await r.text()).trim().split('\n').slice(1); // kop eraf
  const regels = alleRegels.slice(-(SMA_WEKEN * 7 + 60));          // parseer alleen de staart
  const dagen = regels
    .map((regel) => {
      const k = regel.split(',');
      return { t: Date.parse(k[0] + 'T00:00:00Z'), close: parseFloat(k[4]) };
    })
    .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.close))
    .sort((a, b) => a.t - b.t)
    .slice(-(SMA_WEKEN * 7 + 40));

  const weken = new Map();
  for (const d of dagen) {
    const datum = new Date(d.t);
    const dagVanWeek = (datum.getUTCDay() + 6) % 7;
    const weekStart = Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()) - dagVanWeek * DAG_MS;
    weken.set(weekStart, d.close);
  }
  const nu = Date.now();
  const afgesloten = [...weken.entries()].filter(([start]) => start + WEEK_MS <= nu).sort((a, b) => b[0] - a[0]);
  if (afgesloten.length < SMA_WEKEN) throw new Error('Stooq: te weinig afgesloten weken voor de 30-weeks trend');
  const venster = afgesloten.slice(0, SMA_WEKEN);
  const sma = venster.reduce((som, [, close]) => som + close, 0) / SMA_WEKEN;
  const [laatsteStart, laatsteClose] = venster[0];
  return {
    symbool: ETF_TREND_SYMBOOL,
    laatsteWeekclose: laatsteClose,
    weekVan: new Date(laatsteStart).toISOString().slice(0, 10),
    sma30: Math.round(sma * 100) / 100,
    bovenTrend: laatsteClose > sma,
  };
}

async function leesMacro(env) {
  const opgeslagen = await env.TAKUMI_USERS.get('radar:latest:macro', 'json');
  if (!opgeslagen || !opgeslagen.sig) return { status: 'ontbreekt', melding: 'Geen macrosignaal in KV.' };
  const { t, sig } = opgeslagen;
  const leeftijdDagen = (Date.now() - t) / DAG_MS;
  const basis = {
    fase: sig.fase,
    verdeling: sig.faseVerdeling || null,
    datum: sig.datum,
    tijdstip: new Date(t).toISOString(),
    leeftijdDagen: Math.round(leeftijdDagen * 10) / 10,
    samenvatting: sig.samenvatting,
  };
  if (!basis.verdeling) return { status: 'onvolledig', melding: 'faseVerdeling ontbreekt in het macrosignaal.', ...basis };
  if (leeftijdDagen > ETF_MACRO_MAX_LEEFTIJD_DAGEN) {
    return { status: 'verouderd', melding: `Macrosignaal is ${Math.floor(leeftijdDagen)} dagen oud (max ${ETF_MACRO_MAX_LEEFTIJD_DAGEN}).`, ...basis };
  }
  if (sig.dataOud) return { status: 'degradatie', melding: 'De radar meldt zelf verouderde brondata (dataOud).', ...basis };
  return { status: 'ok', ...basis };
}

async function herwaardeerEtf(portfolio) {
  const fouten = [];
  let belegd = 0;
  const versies = await Promise.all(portfolio.posities.map(async (p) => {
    try { return await stooqKoers(p.symbolen); } catch { return null; }
  }));
  portfolio.posities.forEach((p, i) => {
    const vers = versies[i];
    if (vers) { p.prijs = vers.koers; p.prijsVan = vers.datum; p.bron = vers.symbool; }
    else fouten.push(p.naam);          // laatste bekende koers blijft staan
    belegd += p.aantal * p.prijs;
  });
  return { belegd: Math.round(belegd * 100) / 100, fouten };
}

// ---------------------------------------------------------------- GET

export async function onRequestGet({ env }) {
  if (!env.TAKUMI_USERS) return json({ fout: 'KV niet geconfigureerd' }, 500);
  const [portfolio, laatste, logboek, etfPortfolio, etfLaatste, etfLogboek] = await Promise.all([
    env.TAKUMI_USERS.get('engine:portfolio', 'json'),
    env.TAKUMI_USERS.get('engine:laatste', 'json'),
    env.TAKUMI_USERS.get('engine:logboek', 'json'),
    env.TAKUMI_USERS.get('engine:etf:portfolio', 'json'),
    env.TAKUMI_USERS.get('engine:etf:laatste', 'json'),
    env.TAKUMI_USERS.get('engine:etf:logboek', 'json'),
  ]);
  let prijs = null;
  try { prijs = await haalPrijs(); } catch { /* status blijft leesbaar zonder live prijs */ }

  const p = portfolio || { ...START };
  const waardeBtc = prijs != null ? p.btc * prijs : null;
  const totaal = waardeBtc != null ? p.saldoEUR + waardeBtc : null;

  return json({
    tijd: new Date().toISOString(),
    markt: MARKT,
    prijs,
    portfolio: {
      ...p,
      waardeBtcEUR: waardeBtc != null ? Math.round(waardeBtc * 100) / 100 : null,
      totaalEUR: totaal != null ? Math.round(totaal * 100) / 100 : null,
      rendementEngine: totaal != null ? Math.round((totaal / p.startSaldo - 1) * 1000) / 10 : null,
      rendementBuyHold: prijs != null ? Math.round((prijs / p.startPrijs - 1) * 1000) / 10 : null,
    },
    laatsteWeekronde: laatste || null,
    logboek: (logboek || []).slice(0, 26),
    etf: (() => {
      const p = etfPortfolio || ETF_START;
      const belegd = p.posities.reduce((som, pos) => som + pos.aantal * pos.prijs, 0);
      const totaal = Math.round((belegd + p.cashEUR) * 100) / 100;
      return {
        portfolio: { stand: p.stand, cashEUR: p.cashEUR, belegdEUR: Math.round(belegd * 100) / 100, totaalEUR: totaal,
          startWaarde: p.startWaarde, gestartOp: p.gestartOp,
          rendementEnvelop: Math.round((totaal / p.startWaarde - 1) * 1000) / 10,
          posities: p.posities.map(({ naam, aantal, prijs, prijsVan }) => ({ naam, aantal, prijs, prijsVan })) },
        laatsteWeekronde: etfLaatste || null,
        logboek: (etfLogboek || []).slice(0, 26),
      };
    })(),
  });
}

// ---------------------------------------------------------------- POST

export async function onRequestPost(ctx) {
  try {
    return await postRonde(ctx);
  } catch (e) {
    return json({ fout: 'serverfout: ' + String((e && e.message) || e) }, 500);
  }
}

async function postRonde({ request, env }) {
  if (!env.TAKUMI_USERS) return json({ fout: 'KV niet geconfigureerd' }, 500);
  const sleutelOk = env.RADAR_KEY && request.headers.get('x-radar-key') === env.RADAR_KEY;
  if (!sleutelOk) return json({ fout: 'x-radar-key ontbreekt of is ongeldig.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ fout: 'Verwacht een JSON-body.' }, 400); }

  if (body.stap === 'reset') {
    if (body.bevestiging !== 'RESET') return json({ fout: 'Reset vereist {"bevestiging":"RESET"}.' }, 400);
    for (const k of ['engine:portfolio', 'engine:laatste', 'engine:logboek', 'engine:etf:portfolio', 'engine:etf:laatste', 'engine:etf:logboek']) await env.TAKUMI_USERS.delete(k);
    return json({ status: 'gereset' });
  }

  if (body.stap === 'dagwacht') {
    // De dagwacht beschermt alleen: hij koopt nooit, hij verkoopt uitsluitend
    // als een open positie door de stop zakt. Zonder positie doet hij niets.
    const portfolio = (await env.TAKUMI_USERS.get('engine:portfolio', 'json')) || { ...START };
    if (!(portfolio.btc > 0) || !portfolio.instapPrijs) {
      return json({ status: 'rust', melding: 'Geen open positie — niets te bewaken.' });
    }
    let prijs;
    try { prijs = await haalPrijs(); } catch (fout) {
      return json({ status: 'meetfout', melding: String(fout.message || fout) }, 502);
    }
    const stopPrijs = portfolio.instapPrijs * (1 - STOP_FRACTIE);
    if (prijs > stopPrijs) {
      return json({ status: 'rust', melding: `Positie gezond: koers \u20ac${Math.round(prijs).toLocaleString('nl-NL')} boven de stop \u20ac${Math.round(stopPrijs).toLocaleString('nl-NL')}.` });
    }
    const opbrengst = Math.round(portfolio.btc * prijs * 100) / 100;
    const verslag = {
      tijd: new Date().toISOString(),
      meting: { prijs },
      weging: null,
      advies: {
        actie: 'STOP',
        reden: `Dagwacht: koers \u20ac${Math.round(prijs).toLocaleString('nl-NL')} zakte ${Math.round(STOP_FRACTIE * 100)}% of meer onder de instapprijs \u20ac${Math.round(portfolio.instapPrijs).toLocaleString('nl-NL')} — positie beschermend gesloten.`,
        sloten: null,
      },
      order: { actie: 'VERKOOP', prijs, bedragEUR: opbrengst, btc: portfolio.btc },
      portfolioNa: null,
    };
    portfolio.saldoEUR = Math.round((portfolio.saldoEUR + opbrengst) * 100) / 100;
    portfolio.btc = 0;
    portfolio.instapPrijs = null;
    verslag.portfolioNa = { saldoEUR: portfolio.saldoEUR, btc: 0 };
    const logboek = (await env.TAKUMI_USERS.get('engine:logboek', 'json')) || [];
    logboek.unshift(verslag);
    await env.TAKUMI_USERS.put('engine:logboek', JSON.stringify(logboek.slice(0, LOG_MAX)));
    await env.TAKUMI_USERS.put('engine:laatste', JSON.stringify(verslag));
    await env.TAKUMI_USERS.put('engine:portfolio', JSON.stringify(portfolio));
    return json({ status: 'gestopt', verslag });
  }

  if (body.stap === 'weekronde-etf') {
    const vorigeEtf = await env.TAKUMI_USERS.get('engine:etf:laatste', 'json');
    if (!body.forceer && vorigeEtf && Date.now() - new Date(vorigeEtf.tijd).getTime() < RONDE_COOLDOWN_UREN * 3600000) {
      return json({ status: 'overgeslagen', melding: `Vorige ETF-ronde was minder dan ${RONDE_COOLDOWN_UREN} uur geleden.` });
    }

    const portfolio = (await env.TAKUMI_USERS.get('engine:etf:portfolio', 'json')) || structuredClone(ETF_START);
    let trend;
    try { trend = await haalEtfTrend(); } catch (fout) {
      return json({ status: 'meetfout', melding: String(fout.message || fout) }, 502);
    }
    const { belegd, fouten } = await herwaardeerEtf(portfolio);
    const macro = await leesMacro(env);

    // Sloten op macroniveau: groeikansen (vroeg+midden) tegenover krimpkansen (laat+contractie).
    let advies;
    if (macro.status !== 'ok') {
      advies = { actie: 'GEEN_ACTIE', reden: `Macroweging niet bruikbaar (${macro.status}): ${macro.melding} De envelop schakelt niet zonder eerlijke weging.`, sloten: null };
    } else {
      const v = macro.verdeling;
      const groei = (v.vroeg || 0) + (v.midden || 0);
      const krimp = (v.laat || 0) + (v.contractie || 0);
      const sloten = {
        koop: { seizoen: groei > krimp, markt: trend.bovenTrend },
        verkoop: { seizoen: krimp > groei, markt: !trend.bovenTrend },
      };
      const eur = (n) => `\u20ac${Math.round(n).toLocaleString('nl-NL')}`;
      if (portfolio.stand === 'IN' && sloten.verkoop.seizoen && sloten.verkoop.markt) {
        advies = { actie: 'VERKOOP', reden: `Beide verkoopsloten open: laat+contractie ${krimp}% > vroeg+midden ${groei}%, en IWDA-weekclose ${eur(trend.laatsteWeekclose)} onder het 30-weeks gemiddelde ${eur(trend.sma30)}. Blok naar cash.`, sloten };
      } else if (portfolio.stand === 'UIT' && sloten.koop.seizoen && sloten.koop.markt) {
        advies = { actie: 'KOOP', reden: `Beide koopsloten open: vroeg+midden ${groei}% > laat+contractie ${krimp}%, en IWDA-weekclose ${eur(trend.laatsteWeekclose)} boven het 30-weeks gemiddelde ${eur(trend.sma30)}. Cash terug het blok in.`, sloten };
      } else {
        const s = portfolio.stand === 'IN' ? sloten.verkoop : sloten.koop;
        const dicht = [!s.seizoen && 'seizoenslot (macroweging)', !s.markt && 'marktslot (IWDA 30-weeks)'].filter(Boolean).join(' en ');
        advies = { actie: 'GEEN_ACTIE', reden: portfolio.stand === 'IN' ? `Blok blijft belegd: ${dicht} nog dicht voor verkoop.` : `Blok blijft in cash: ${dicht} nog dicht voor herinstap.`, sloten };
      }
    }

    // Schakelaar uitvoeren
    let order = null;
    if (advies.actie === 'VERKOOP') {
      order = { actie: 'VERKOOP', bedragEUR: belegd };
      portfolio.cashEUR = Math.round((portfolio.cashEUR + belegd) * 100) / 100;
      portfolio.gewichten = portfolio.posities.map((p) => ({ isin: p.isin, gewicht: (p.aantal * p.prijs) / belegd }));
      for (const p of portfolio.posities) p.aantal = 0;
      portfolio.stand = 'UIT';
    } else if (advies.actie === 'KOOP') {
      const inleg = portfolio.cashEUR;
      const gewichten = portfolio.gewichten || portfolio.posities.map((p) => ({ isin: p.isin, gewicht: 1 / portfolio.posities.length }));
      for (const p of portfolio.posities) {
        const g = gewichten.find((w) => w.isin === p.isin);
        if (g && p.prijs > 0) p.aantal = Math.round((inleg * g.gewicht / p.prijs) * 10000) / 10000;
      }
      order = { actie: 'KOOP', bedragEUR: inleg };
      portfolio.cashEUR = 0;
      portfolio.stand = 'IN';
    }

    const belegdNa = portfolio.posities.reduce((som, p) => som + p.aantal * p.prijs, 0);
    const verslag = {
      tijd: new Date().toISOString(),
      envelop: 'etf',
      meting: { trend, belegd: Math.round(belegdNa * 100) / 100, cashEUR: portfolio.cashEUR, herwaarderingFouten: fouten },
      weging: macro,
      advies,
      order,
      portfolioNa: { stand: portfolio.stand, totaalEUR: Math.round((belegdNa + portfolio.cashEUR) * 100) / 100 },
    };
    const logboek = (await env.TAKUMI_USERS.get('engine:etf:logboek', 'json')) || [];
    logboek.unshift(verslag);
    await env.TAKUMI_USERS.put('engine:etf:logboek', JSON.stringify(logboek.slice(0, LOG_MAX)));
    await env.TAKUMI_USERS.put('engine:etf:laatste', JSON.stringify(verslag));
    await env.TAKUMI_USERS.put('engine:etf:portfolio', JSON.stringify(portfolio));
    return json({ status: 'gedraaid', verslag });
  }

  if (body.stap !== 'weekronde') return json({ fout: `Onbekende stap "${body.stap}". Beschikbaar: weekronde, weekronde-etf, dagwacht, reset.` }, 400);

  // Cooldown: een dubbel afgevuurde cron mag geen dubbele ronde worden.
  const vorige = await env.TAKUMI_USERS.get('engine:laatste', 'json');
  if (!body.forceer && vorige && Date.now() - new Date(vorige.tijd).getTime() < RONDE_COOLDOWN_UREN * 3600000) {
    return json({ status: 'overgeslagen', melding: `Vorige weekronde was minder dan ${RONDE_COOLDOWN_UREN} uur geleden.`, vorige }, 200);
  }

  let prijs, trend;
  try {
    [prijs, trend] = await Promise.all([haalPrijs(), haalWeektrend()]);
  } catch (fout) {
    return json({ status: 'meetfout', melding: String(fout.message || fout) }, 502);
  }

  const portfolio = (await env.TAKUMI_USERS.get('engine:portfolio', 'json')) || { ...START };
  const radar = await leesRadar(env);
  const advies = bepaalAdvies({ radar, trend, portfolio });

  // Automatische uitvoering — de vangrails zíjn de regels: twee sloten, 5% inzet.
  let order = null;
  if (advies.actie === 'KOOP') {
    const bedrag = Math.round(portfolio.saldoEUR * INZET_FRACTIE * 100) / 100;
    if (bedrag >= 10) {
      const btcGekocht = bedrag / prijs;
      portfolio.saldoEUR = Math.round((portfolio.saldoEUR - bedrag) * 100) / 100;
      portfolio.instapPrijs = portfolio.btc > 0
        ? (portfolio.instapPrijs * portfolio.btc + prijs * btcGekocht) / (portfolio.btc + btcGekocht)
        : prijs;
      portfolio.btc += btcGekocht;
      order = { actie: 'KOOP', prijs, bedragEUR: bedrag, btc: btcGekocht };
    }
  } else if (advies.actie === 'VERKOOP' && portfolio.btc > 0) {
    const opbrengst = Math.round(portfolio.btc * prijs * 100) / 100;
    order = { actie: 'VERKOOP', prijs, bedragEUR: opbrengst, btc: portfolio.btc };
    portfolio.saldoEUR = Math.round((portfolio.saldoEUR + opbrengst) * 100) / 100;
    portfolio.btc = 0;
    portfolio.instapPrijs = null;
  }

  const verslag = {
    tijd: new Date().toISOString(),
    meting: { prijs, ...trend },
    weging: radar,
    advies: { actie: advies.actie, reden: advies.reden, sloten: advies.sloten },
    order,
    portfolioNa: { saldoEUR: portfolio.saldoEUR, btc: portfolio.btc },
  };

  const logboek = (await env.TAKUMI_USERS.get('engine:logboek', 'json')) || [];
  logboek.unshift(verslag);
  await env.TAKUMI_USERS.put('engine:logboek', JSON.stringify(logboek.slice(0, LOG_MAX)));
  await env.TAKUMI_USERS.put('engine:laatste', JSON.stringify(verslag));
  await env.TAKUMI_USERS.put('engine:portfolio', JSON.stringify(portfolio));

  return json({ status: 'gedraaid', verslag });
}
