// /api/pulse — twee zachte pulsen per dag voor iOS Shortcut + Automation
// Geeft dag-leider + één meester-vraag terug als JSON (en als plain text via ?format=text)
//
// Usage:
//   GET /api/pulse?type=morning
//   GET /api/pulse?type=evening
//   GET /api/pulse?type=morning&format=text  → unformatted string voor iOS Shortcut notificaties

// Dag-leider rotatie — moet kloppen met getDayLeader() in index.html
const DAY_LEADERS = {
  1: {eid:'chi', kanji:'地', name:'Chi',     master:'略 Ryaku',  element:'Aarde · Fundament'},
  2: {eid:'sui', kanji:'水', name:'Sui',     master:'気 Ki',     element:'Water · Flow'},
  3: {eid:'fu',  kanji:'風', name:'Fū',      master:'筆 Fude',   element:'Wind · Geest'},
  4: {eid:'ka',  kanji:'火', name:'Ka',      master:'働 Hataraki',element:'Vuur · Energie'},
  5: {eid:'board',kanji:'匠', name:'Council', master:'匠 Takumi', element:'Master Council · Synthese'},
  6: {eid:'ku',  kanji:'空', name:'Kū',      master:'静 Sei',    element:'Leegte · Stilte'},
  0: {eid:'ku',  kanji:'空', name:'Kū',      master:'無 Mu',     element:'Leegte · Loslaten'}
};

// Eén-zin vragen per dag-leider — ochtend nodigt uit, avond reflecteert
const MORNING_QUESTIONS = {
  chi: [
    'Welk fundament onder vandaag draagt nog steeds?',
    'Wat is de structuur waarop je vandaag bouwt?',
    'Waar staat de aarde stevig onder je voeten?',
    'Welke gewoonte verdient vandaag aandacht?'
  ],
  sui: [
    'Waar heeft je herstel ruimte vandaag?',
    'Welk gesprek wacht onder de oppervlakte?',
    'Wat stroomt al voor jij iets doet?',
    'Wat heeft je lichaam vandaag te zeggen?'
  ],
  fu: [
    'Welke verbinding vraagt vandaag jouw stem?',
    'Waar wil je vandaag schrijven of spreken?',
    'Welk gesprek heeft te lang geduurd zonder lucht?',
    'Wie wil je vandaag echt zien?'
  ],
  ka: [
    'Waar wil je vandaag je vuur leggen?',
    'Welke beslissing wacht al te lang?',
    'Wat verdient je volledige energie deze ochtend?',
    'Welke actie maakt het verschil vandaag?'
  ],
  board: [
    'Wat vraagt vandaag om synthese, niet om een nieuwe stap?',
    'Welke vijf dingen zijn eigenlijk één?',
    'Wat heeft de week tot nu toe geleerd?',
    'Waar passen de elementen vandaag samen?'
  ],
  ku: [
    'Wat mag vandaag onaangeroerd blijven?',
    'Waar past stilte beter dan een antwoord?',
    'Wat wil je vandaag loslaten?',
    'Welke vraag onder de vraag voel je al?'
  ]
};

const EVENING_QUESTIONS = {
  chi: [
    'Welk fundament hield vandaag stand?',
    'Wat bouwde je toe aan je grond?',
    'Welke routine eerde je vandaag?',
    'Wat van vandaag wil je morgen weer doen?'
  ],
  sui: [
    'Welk gesprek had je vandaag niet?',
    'Wat stroomde, wat stokte?',
    'Waar miste herstel zijn plek?',
    'Wat voelde je dat je nog niet hebt gezegd?'
  ],
  fu: [
    'Welke verbinding kreeg vandaag jouw aandacht?',
    'Wat heb je geschreven of gesproken dat ertoe deed?',
    'Welk gesprek bleef je hangen?',
    'Waar zat de wind van vandaag?'
  ],
  ka: [
    'Waar verschoof je energie vandaag?',
    'Welke actie was beslissend?',
    'Wat verbrandde voor niets?',
    'Waar legde je vuur, waar doofde het?'
  ],
  board: [
    'Wat liet vandaag de raad meekijken?',
    'Welke elementen werkten samen, welke schuurden?',
    'Wat zou de hele raad nu samen zeggen?',
    'Waar kwam alles vandaag bij elkaar?'
  ],
  ku: [
    'Wat liet je vandaag liggen — en was dat goed?',
    'Welke ruimte ontstond toen je niets deed?',
    'Waar voelde je de leegte aanwezig?',
    'Wat wist je voor je het kon benoemen?'
  ]
};


export async function onRequest(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'morning';
  const format = url.searchParams.get('format') || 'json';
  const lang = url.searchParams.get('lang') || 'nl';

  if (type !== 'morning' && type !== 'evening') {
    return new Response(JSON.stringify({error: 'type must be morning or evening'}), {
      status: 400,
      headers: {'Content-Type': 'application/json'}
    });
  }

  // Dag-leider en rotatie in echte Amsterdamse tijd (Intl regelt zomertijd; Cloudflare draait UTC)
  const now = new Date();
  const ams = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const start = new Date(ams.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((ams - start) / 86400000);

  const leader = DAY_LEADERS[ams.getDay()];
  const questions = type === 'morning' ? MORNING_QUESTIONS[leader.eid] : EVENING_QUESTIONS[leader.eid];
  const question = questions[dayOfYear % questions.length];

  const data = {
    type: type,
    timestamp: now.toISOString(),
    leader: {
      kanji: leader.kanji,
      name: leader.name,
      master: leader.master,
      element: leader.element
    },
    question: question,
    open_url: type === 'morning' ? 'https://app.takumi-master.com/?v=ck' : 'https://app.takumi-master.com/?v=ri'
  };

  if (format === 'text') {
    // Plain-text formaat voor iOS Shortcut notificaties
    const greeting = type === 'morning' ? 'Goedemorgen' : 'Goedenavond';
    const txt = `${greeting} — ${leader.kanji} ${leader.name} leidt vandaag.\n\n${question}`;
    return new Response(txt, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
