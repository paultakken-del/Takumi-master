/**
 * _lib/pulse.js — het kompas van vandaag, deterministisch, zonder opslag.
 * Spiegelt de dag-leider-rotatie van functions/mcp.js (bron voor agents via lees_kompas)
 * en functions/api/pulse.js. Gebruikt door _middleware.js om landing.html
 * server-side te vullen met de puls die agents vanochtend kregen.
 */
const DAY_LEADERS = {
  1: { eid: 'chi',   kanji: '地', name: 'Chi',     master: '略 Ryaku',   element: 'Aarde · Fundament' },
  2: { eid: 'sui',   kanji: '水', name: 'Sui',     master: '気 Ki',      element: 'Water · Flow' },
  3: { eid: 'fu',    kanji: '風', name: 'Fū',      master: '筆 Fude',    element: 'Wind · Geest' },
  4: { eid: 'ka',    kanji: '火', name: 'Ka',      master: '働 Hataraki', element: 'Vuur · Energie' },
  5: { eid: 'board', kanji: '匠', name: 'Council', master: '匠 Takumi',  element: 'Master Council · Synthese' },
  6: { eid: 'ku',    kanji: '空', name: 'Kū',      master: '静 Sei',     element: 'Leegte · Stilte' },
  0: { eid: 'ku',    kanji: '空', name: 'Kū',      master: '無 Mu',      element: 'Leegte · Loslaten' }
};

const MORNING_QUESTIONS = {
  chi: ['Welk fundament onder vandaag draagt nog steeds?', 'Wat is de structuur waarop je vandaag bouwt?', 'Waar staat de aarde stevig onder je voeten?', 'Welke gewoonte verdient vandaag aandacht?', 'Welke afspraak met jezelf staat vandaag het stevigst?', 'Wat is vandaag je anker als het zicht wegvalt?', 'Welke discipline geeft je vandaag juist vrijheid?', 'Wat bouw je vandaag waar je over een jaar nog op staat?', 'Welke eenvoud breng je vandaag terug?', 'Wat verdient vandaag onderhoud in plaats van vernieuwing?', 'Wat is vandaag jouw berg, het punt dat niet beweegt?'],
  sui: ['Waar heeft je herstel ruimte vandaag?', 'Welk gesprek wacht onder de oppervlakte?', 'Wat stroomt al voor jij iets doet?', 'Wat heeft je lichaam vandaag te zeggen?', 'Waar kun je vandaag meebewegen in plaats van duwen?', 'Welke tegendruk kun je vandaag verlagen?', 'Wat vraagt vandaag eerst luisteren, dan pas richting?', 'Waar stroomt het vandaag vanzelf — en volg je dat?', 'Welk signaal van je lichaam neem je vandaag serieus?', 'Wie verdient het vandaag dat jij je in diegene verplaatst?'],
  fu: ['Welke verbinding vraagt vandaag jouw stem?', 'Waar wil je vandaag schrijven of spreken?', 'Welk gesprek heeft te lang geduurd zonder lucht?', 'Wie wil je vandaag echt zien?', 'Welk idee wil vandaag hardop gezegd worden?', 'Waar breng jij vandaag lucht in een vastgelopen gesprek?', 'Welke verbinding herstel je vandaag met één bericht?', 'Wat schrijf je vandaag dat morgen nog waait?', 'Welke vraag stel je vandaag in plaats van een antwoord te geven?', 'Waar mag vandaag een andere wind waaien?'],
  ka: ['Waar wil je vandaag je vuur leggen?', 'Welke beslissing wacht al te lang?', 'Wat verdient je volledige energie deze ochtend?', 'Welke actie maakt het verschil vandaag?', 'Welk vuur wakker je vandaag bewust aan?', 'Wat is vandaag je heupzwaai — het zichtbare afscheid van het oude?', 'Welke daad zet vandaag je overtuiging om?', 'Waar zegt je buik ja terwijl je hoofd nog twijfelt?', 'Welke ene beslissing maakt de rest vandaag lichter?', 'Wat verdient vandaag kracht én vastberadenheid?'],
  board: ['Wat vraagt vandaag om synthese, niet om een nieuwe stap?', 'Welke vijf dingen zijn eigenlijk één?', 'Wat heeft de week tot nu toe geleerd?', 'Waar passen de elementen vandaag samen?', 'Welke twee elementen hebben elkaar vandaag nodig?', 'Wat zou de raad als eerste op tafel leggen vandaag?', 'Waar wint het geheel vandaag van de delen?', 'Welk advies geef je jezelf namens alle vijf?', 'Wat vraagt vandaag overzicht in plaats van inzet?', 'Welke balans bewaak je vandaag voor iemand anders?'],
  ku: ['Wat mag vandaag onaangeroerd blijven?', 'Waar past stilte beter dan een antwoord?', 'Wat wil je vandaag loslaten?', 'Welke vraag onder de vraag voel je al?', 'Welke stilte plan je vandaag in voordat de dag het doet?', 'Wat weet je al zonder dat iemand het bevestigd heeft?', 'Waar maak je vandaag ruimte door iets niet te doen?', 'Welke gedachte mag vandaag voorbijdrijven zonder gevolg?', 'Wat zou er gebeuren als je vandaag niets toevoegt?', 'Welke bewust gekozen rust hoort vandaag bij jouw topsport?'],
};

const EVENING_QUESTIONS = {
  chi: ['Welk fundament hield vandaag stand?', 'Wat bouwde je toe aan je grond?', 'Welke routine eerde je vandaag?', 'Wat van vandaag wil je morgen weer doen?', 'Welke gewoonte droeg je vandaag, ook zonder applaus?', 'Wat bleef overeind toen het schuurde?', 'Welke basis heb je vandaag versterkt zonder het te merken?', 'Waar was discipline vandaag een vorm van zelfzorg?', 'Wat was vandaag je anker?', 'Welke eenvoud hield vandaag stand tegen de complexiteit?'],
  sui: ['Welk gesprek had je vandaag niet?', 'Wat stroomde, wat stokte?', 'Waar miste herstel zijn plek?', 'Wat voelde je dat je nog niet hebt gezegd?', 'Waar bewoog je vandaag mee — en waar had dat beter gekund?', 'Welke tegendruk heb je vandaag verlaagd?', 'Wat heeft je lichaam vandaag gezegd dat je pas nu hoort?', 'Welke stroom volgde je vandaag op gevoel?', 'Waar koos je vandaag herstel boven doorzetten?', 'In wie heb je je vandaag echt verplaatst?', 'Veerde je terug na de laatste golf?'],
  fu: ['Welke verbinding kreeg vandaag jouw aandacht?', 'Wat heb je geschreven of gesproken dat ertoe deed?', 'Welk gesprek bleef je hangen?', 'Waar zat de wind van vandaag?', 'Welk woord van vandaag waait morgen nog door?', 'Waar bracht jij vandaag lucht in iets benauwds?', 'Welke verbinding werd vandaag sterker zonder grote woorden?', 'Welke vraag van vandaag verdient morgen een vervolg?', 'Wat heb je vandaag niet gezegd dat gezegd wilde worden?', 'Welke andere wind voelde je vandaag opsteken?'],
  ka: ['Waar verschoof je energie vandaag?', 'Welke actie was beslissend?', 'Wat verbrandde voor niets?', 'Waar legde je vuur, waar doofde het?', 'Welk vuur liet je vandaag bewust branden — en welk doofde je?', 'Welke daad van vandaag kwam uit je buik, niet je hoofd?', 'Waar was je vandaag vastberaden zonder hard te worden?', 'Welke energie heb je vandaag doorgegeven?', 'Wat heb je vandaag ontleerd?', 'Welke beslissing van vandaag verdient morgen een vervolg?'],
  board: ['Wat liet vandaag de raad meekijken?', 'Welke elementen werkten samen, welke schuurden?', 'Wat zou de hele raad nu samen zeggen?', 'Waar kwam alles vandaag bij elkaar?', 'Welke elementen vroegen vandaag om elkaar?', 'Wat zou de raad vanavond als wijsheid noteren?', 'Waar zag je vandaag het geheel in plaats van de delen?', 'Welke balans heb je vandaag voor een ander bewaakt?', 'Wat van vandaag verdient een plek in het grotere verhaal?', 'Welk element kreeg vandaag te weinig stem?'],
  ku: ['Wat liet je vandaag liggen — en was dat goed?', 'Welke ruimte ontstond toen je niets deed?', 'Waar voelde je de leegte aanwezig?', 'Wat wist je voor je het kon benoemen?', 'Welke stilte van vandaag zei het meest?', 'Wat wist je vandaag voordat het gebeurde?', 'Welke ruimte ontstond toen je losliet?', 'Wat heb je vandaag bewust níet gedaan — en wat bracht dat?', 'Welke gedachte mag je hier achterlaten voor de nacht?', 'Waar was leegte vandaag geen gemis maar ruimte?', 'Keek je vandaag op, of roeide je alleen?'],
};


const MAANDEN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
const MONTHS  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAGEN   = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
const DAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function amsNow(now) {
  return new Date((now || new Date()).toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
}

/** Kompas van vandaag: leider, vraag, dagdeel en datumlabels (NL + EN). */
export function kompasVandaag(now) {
  const n = amsNow(now);
  const start = new Date(n.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((n - start) / 86400000);
  const h = n.getHours();
  const dagdeel = (h >= 17 || h < 5) ? 'evening' : 'morning'; // spiegelt mcp.js dagdeelNow()
  const leader = DAY_LEADERS[n.getDay()];
  const pool = (dagdeel === 'morning' ? MORNING_QUESTIONS : EVENING_QUESTIONS)[leader.eid];
  const question = pool[dayOfYear % pool.length];
  return {
    dagdeel,
    leader,
    question,
    datum_nl: `${DAGEN[n.getDay()]} ${n.getDate()} ${MAANDEN[n.getMonth()]}`,
    datum_en: `${DAYS[n.getDay()]} ${n.getDate()} ${MONTHS[n.getMonth()]}`,
    iso: `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`,
  };
}
