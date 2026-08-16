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

// ---------------------------------------------------------------- GET

export async function onRequestGet({ env }) {
  if (!env.TAKUMI_USERS) return json({ fout: 'KV niet geconfigureerd' }, 500);
  const [portfolio, laatste, logboek] = await Promise.all([
    env.TAKUMI_USERS.get('engine:portfolio', 'json'),
    env.TAKUMI_USERS.get('engine:laatste', 'json'),
    env.TAKUMI_USERS.get('engine:logboek', 'json'),
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
  });
}

// ---------------------------------------------------------------- POST

export async function onRequestPost({ request, env }) {
  if (!env.TAKUMI_USERS) return json({ fout: 'KV niet geconfigureerd' }, 500);
  const sleutelOk = env.RADAR_KEY && request.headers.get('x-radar-key') === env.RADAR_KEY;
  if (!sleutelOk) return json({ fout: 'x-radar-key ontbreekt of is ongeldig.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ fout: 'Verwacht een JSON-body.' }, 400); }

  if (body.stap === 'reset') {
    if (body.bevestiging !== 'RESET') return json({ fout: 'Reset vereist {"bevestiging":"RESET"}.' }, 400);
    for (const k of ['engine:portfolio', 'engine:laatste', 'engine:logboek']) await env.TAKUMI_USERS.delete(k);
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

  if (body.stap !== 'weekronde') return json({ fout: `Onbekende stap "${body.stap}". Beschikbaar: weekronde, dagwacht, reset.` }, 400);

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
