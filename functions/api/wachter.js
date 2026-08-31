/**
 * POST /api/wachter  (x-radar-key vereist)
 *   {}            -> vergelijkt de stand met de vorige snapshot; mailt alleen bij veranderingen
 *   {"puls":true} -> mailt altijd de dagpuls: afstand tot elk slot + eventuele veranderingen
 *
 * Interactie zonder de tucht te slopen: het systeem meldt zich wanneer er iets
 * kantelt, en vertelt dagelijks hoe dichtbij actie is. Verzending via Resend
 * (zelfde route als het contactformulier) naar env CONTACT_TO.
 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const pct = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

function standBeeld(radarCrypto, radarMacro, engineLaatste, etfLaatste, etfPortfolio, btcPortfolio, ladder) {
  const b = {};

  // BTC: seizoenslot = accumulatie vs capitulatie; marktslot = weekclose vs SMA30
  const rv = radarCrypto && radarCrypto.sig ? radarCrypto.sig.regimeVerdeling || {} : {};
  b.regime = radarCrypto && radarCrypto.sig ? radarCrypto.sig.regime : null;
  b.btcSeizoenGap = Number.isFinite(rv.accumulatie) && Number.isFinite(rv.capitulatie)
    ? rv.accumulatie - rv.capitulatie : null;                      // > 0 = koopseizoen open
  const bm = engineLaatste && engineLaatste.meting ? engineLaatste.meting : {};
  b.btcMarktAfstand = Number.isFinite(bm.laatsteWeekclose) && Number.isFinite(bm.sma30)
    ? ((bm.laatsteWeekclose - bm.sma30) / bm.sma30) * 100 : null;  // > 0 = boven trend
  b.btcPositie = !!(btcPortfolio && btcPortfolio.btc > 0);

  // Macro/ETF: seizoen = vroeg+midden vs laat+contractie; markt = IWDA vs SMA30
  const fv = radarMacro && radarMacro.sig ? radarMacro.sig.faseVerdeling || {} : {};
  b.fase = radarMacro && radarMacro.sig ? radarMacro.sig.fase : null;
  b.etfSeizoenGap = ['vroeg', 'midden', 'laat', 'contractie'].every((k) => Number.isFinite(fv[k]))
    ? fv.vroeg + fv.midden - fv.laat - fv.contractie : null;       // > 0 = groei zwaarder
  const em = etfLaatste && etfLaatste.meting && etfLaatste.meting.trend ? etfLaatste.meting.trend : {};
  b.etfMarktAfstand = Number.isFinite(em.laatsteWeekclose) && Number.isFinite(em.sma30)
    ? ((em.laatsteWeekclose - em.sma30) / em.sma30) * 100 : null;
  b.etfStand = etfPortfolio ? etfPortfolio.stand || 'IN' : null;

  b.ladderGedaan = ladder ? ladder.gedaan : null;
  return b;
}

function veranderingen(oud, nieuw) {
  if (!oud) return [];
  const uit = [];
  const kantel = (naam, o, n, drempel = 0) => {
    if (o === null || n === null || o === undefined || n === undefined) return;
    if ((o > drempel) !== (n > drempel)) uit.push(naam + ': ' + (n > drempel ? 'OPEN' : 'dicht') + ` (${pct(o)} \u2192 ${pct(n)})`);
  };
  if (oud.regime !== nieuw.regime && nieuw.regime) uit.push(`Cryptoregime: ${oud.regime} \u2192 ${nieuw.regime}`);
  if (oud.fase !== nieuw.fase && nieuw.fase) uit.push(`Macrofase: ${oud.fase} \u2192 ${nieuw.fase}`);
  kantel('BTC seizoenslot (koop)', oud.btcSeizoenGap, nieuw.btcSeizoenGap);
  kantel('BTC marktslot', oud.btcMarktAfstand, nieuw.btcMarktAfstand);
  kantel('ETF seizoenslot', oud.etfSeizoenGap, nieuw.etfSeizoenGap);
  kantel('ETF marktslot', oud.etfMarktAfstand, nieuw.etfMarktAfstand);
  if (oud.btcPositie !== nieuw.btcPositie) uit.push(nieuw.btcPositie ? 'BTC-envelop heeft GEKOCHT' : 'BTC-envelop heeft VERKOCHT (positie naar nul)');
  if (oud.etfStand !== nieuw.etfStand) uit.push(`ETF-envelop: ${oud.etfStand} \u2192 ${nieuw.etfStand}`);
  if (Number.isFinite(oud.ladderGedaan) && Number.isFinite(nieuw.ladderGedaan) && nieuw.ladderGedaan > oud.ladderGedaan)
    uit.push(`Koopladder: tranche ${nieuw.ladderGedaan} uitgevoerd`);
  return uit;
}

function pulsTekst(b) {
  const r = [];
  const slot = (open) => (open ? 'OPEN' : 'dicht');
  r.push('TAKUMI DAGPULS \u00b7 afstand tot actie');
  r.push('');
  r.push('BTC-envelop (' + (b.btcPositie ? 'positie' : 'cash') + ', regime ' + (b.regime || '?') + ')');
  if (b.btcSeizoenGap !== null) r.push(`- Seizoenslot koop: ${slot(b.btcSeizoenGap > 0)} \u00b7 accumulatie min capitulatie = ${pct(b.btcSeizoenGap)} punt`);
  if (b.btcMarktAfstand !== null) r.push(`- Marktslot: ${slot(b.btcMarktAfstand > 0)} \u00b7 weekclose ${pct(b.btcMarktAfstand)}% t.o.v. 30-weeks trend`);
  r.push('');
  r.push('ETF-envelop (stand ' + (b.etfStand || '?') + ', fase ' + (b.fase || '?') + ')');
  if (b.etfSeizoenGap !== null) r.push(`- Seizoen: groei min krimp = ${pct(b.etfSeizoenGap)} punt (${b.etfSeizoenGap > 0 ? 'groei zwaarder' : 'krimp zwaarder'})`);
  if (b.etfMarktAfstand !== null) r.push(`- Markt: IWDA ${pct(b.etfMarktAfstand)}% t.o.v. 30-weeks trend`);
  if (Number.isFinite(b.ladderGedaan)) r.push(`- Koopladder: tranche ${b.ladderGedaan}/4`);
  r.push('');
  r.push('Kansverdelingen, geen voorspellingen. Takumi weegt, het handelt niet.');
  return r.join('\n');
}

async function mail(env, onderwerp, tekst) {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) return { verstuurd: false, reden: 'mailconfig ontbreekt' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.RESEND_API_KEY },
    body: JSON.stringify({
      from: env.CONTACT_FROM || 'onboarding@resend.dev',
      to: env.CONTACT_TO,
      subject: onderwerp,
      text: tekst,
    }),
  });
  return { verstuurd: r.ok, status: r.status };
}

export async function onRequestPost({ request, env }) {
  try {
    const sleutelOk = env.RADAR_KEY && request.headers.get('x-radar-key') === env.RADAR_KEY;
    if (!sleutelOk) return json({ fout: 'x-radar-key ontbreekt of is ongeldig.' }, 401);
    let body = {};
    try { body = await request.json(); } catch { /* leeg is ok */ }

    const [rc, rm, el, etl, etp, bp, lad, vorig] = await Promise.all([
      env.TAKUMI_USERS.get('radar:latest:crypto', 'json'),
      env.TAKUMI_USERS.get('radar:latest:macro', 'json'),
      env.TAKUMI_USERS.get('engine:laatste', 'json'),
      env.TAKUMI_USERS.get('engine:etf:laatste', 'json'),
      env.TAKUMI_USERS.get('engine:etf:portfolio', 'json'),
      env.TAKUMI_USERS.get('engine:portfolio', 'json'),
      env.TAKUMI_USERS.get('engine:ladder:staat', 'json'),
      env.TAKUMI_USERS.get('wachter:vorig', 'json'),
    ]);

    const beeld = standBeeld(rc, rm, el, etl, etp, bp, lad);
    const delta = veranderingen(vorig, beeld);
    await env.TAKUMI_USERS.put('wachter:vorig', JSON.stringify(beeld));

    let post = null;
    if (delta.length) {
      post = await mail(env, 'Takumi \u00b7 ' + delta[0], 'Er is iets gekanteld:\n\n- ' + delta.join('\n- ') + '\n\n' + pulsTekst(beeld));
    } else if (body.puls) {
      post = await mail(env, 'Takumi \u00b7 dagpuls', pulsTekst(beeld));
    }
    return json({ ok: true, veranderingen: delta, gemaild: post ? post.verstuurd : false, beeld });
  } catch (e) {
    return json({ fout: 'serverfout: ' + String((e && e.message) || e) }, 500);
  }
}
