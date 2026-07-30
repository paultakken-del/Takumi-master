// /mcp — Takumi Master MCP-server (Streamable HTTP, JSON-RPC 2.0)
//
// Het menselijke noorden, leesbaar voor agents.
// READ-ONLY: resources + één lees-tool. Geen handelingen. Takumi weegt, het handelt niet.
// (De lees-tool bestaat puur omdat chat-clients resources niet tonen, alleen tools.
//  Lezen is wegen — de filosofie blijft intact: Takumi voert nooit iets uit.)
// Stateless: berekent alles uit de datum + statische arrays. Nul API-calls, nul kosten.
//
// Endpoint:  POST https://app.takumi-master.com/mcp   (JSON-RPC)
//            GET  https://app.takumi-master.com/mcp   (server-info / health)
//
// Resources:
//   takumi://pulse/morning   — ochtendpuls: dag-leider + uitnodigende vraag
//   takumi://pulse/evening   — avondpuls:  dag-leider + reflecterende vraag
//   takumi://reflectie       — één reflectie uit Natuurlijk Agile, passend bij dagdeel
//   takumi://noorden         — het manifest-in-één-regel + de huidige dag-leider als oriëntatie

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'takumi-master',
  version: '0.3.0',
  title: 'Takumi — balans tussen mens en machine',
  websiteUrl: 'https://app.takumi-master.com/agents',
  icons: [
    { src: 'https://app.takumi-master.com/takumi-mcp.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
    { src: 'https://app.takumi-master.com/takumi-mcp-512.png', mimeType: 'image/png', sizes: ['512x512'] }
  ]
};

// — Dag-leider rotatie (spiegelt /api/pulse en getDayLeader() in index.html) —
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

// — Reflecties uit Natuurlijk Agile (subset, één source of truth blijft index.html) —
const REFLECTIONS = [
  { q: 'De rots in de branding houdt geen gevoel, maar kent het beste de zee.', a: 'Natuurlijk Agile', el: 'chi', time: 'morning' },
  { q: 'Creativiteit en vrijheid zijn waardevol — maar discipline redt soms je leven.', a: 'Natuurlijk Agile', el: 'chi', time: 'morning' },
  { q: 'Vandaag overwin je de jij van gisteren.', a: 'Miyamoto Musashi', el: 'chi', time: 'morning' },
  { q: 'De weg is in de training.', a: 'Miyamoto Musashi', el: 'chi', time: 'morning' },
  { q: 'Ken de kleinste dingen en de grootste dingen.', a: 'Miyamoto Musashi', el: 'chi', time: 'morning' },
  { q: 'De reis van duizend mijl begint onder je voeten.', a: 'Lao Tzu', el: 'chi', time: 'morning' },
  { q: 'Natuurlijke groei verslaat kunstmatig schalen.', a: 'Natuurlijk Agile', el: 'chi', time: 'morning' },
  { q: 'Doe niets dat geen nut heeft.', a: 'Miyamoto Musashi', el: 'chi', time: 'evening' },
  { q: 'Aanvaard alles precies zoals het is.', a: 'Miyamoto Musashi', el: 'chi', time: 'evening' },
  { q: 'Wees noch overmoedig in voorspoed, noch verslagen in tegenspoed.', a: 'Miyamoto Musashi', el: 'chi', time: 'evening' },
  { q: 'Voetballen is simpel, maar simpel voetballen is het moeilijkst.', a: 'Johan Cruijff', el: 'chi', time: 'evening' },
  { q: 'Een organisatie is een organisme: hartslag, ademhaling, bewustzijn.', a: 'Natuurlijk Agile', el: 'chi', time: 'evening' },
  { q: 'Eerst meebewegen met wat is. Dan pas een nieuwe richting tonen.', a: 'Natuurlijk Agile', el: 'sui', time: 'morning' },
  { q: 'Je verplaatsen in je tegenstander, tegendruk verlagen, een andere richting tonen.', a: 'Natuurlijk Agile', el: 'sui', time: 'morning' },
  { q: 'Niets is zachter dan water, en niets verslaat het.', a: 'Lao Tzu', el: 'sui', time: 'morning' },
  { q: 'Een groene golf, maar dan de menselijke variant.', a: 'Natuurlijk Agile', el: 'sui', time: 'morning' },
  { q: 'Be water, my friend.', a: 'Bruce Lee', el: 'sui', time: 'morning' },
  { q: 'Agile is nooit een doel op zich.', a: 'Natuurlijk Agile', el: 'sui', time: 'morning' },
  { q: 'De stijfste boom breekt het eerst. De bamboe overleeft door mee te buigen.', a: 'Bruce Lee', el: 'sui', time: 'evening' },
  { q: 'Wat stroomt, hoef je niet te duwen.', a: 'Takumi', el: 'sui', time: 'evening' },
  { q: 'Herstel is geen pauze van het pad; het is het pad.', a: 'Takumi', el: 'sui', time: 'evening' },
  { q: 'Elk nadeel heb z\'n voordeel.', a: 'Johan Cruijff', el: 'sui', time: 'evening' },
  { q: 'Soms moet er gewoon een andere wind waaien.', a: 'Natuurlijk Agile', el: 'fu', time: 'morning' },
  { q: 'Zonder ademruimte ontstaat tunnelvisie.', a: 'Natuurlijk Agile', el: 'fu', time: 'morning' },
  { q: 'Wie anderen kent is wijs; wie zichzelf kent is verlicht.', a: 'Lao Tzu', el: 'fu', time: 'morning' },
  { q: 'Een goede vraag brengt meer lucht dan tien antwoorden.', a: 'Takumi', el: 'fu', time: 'morning' },
  { q: 'Veerkracht is de kunst van terugveren zonder te breken.', a: 'Takumi', el: 'fu', time: 'morning' },
  { q: 'De bovenliggende stroom gaat in de juiste richting — ook als de wind nu guur is.', a: 'Natuurlijk Agile', el: 'fu', time: 'evening' },
  { q: 'Woorden die ertoe doen, waaien verder dan de dag.', a: 'Takumi', el: 'fu', time: 'evening' },
  { q: 'Lichtheid en humor zijn dragende constructies.', a: 'Natuurlijk Agile', el: 'fu', time: 'evening' },
  { q: 'Elke dag is er een keuze: wakker je het vuur aan, of laat je het uitdoven?', a: 'Natuurlijk Agile', el: 'ka', time: 'morning' },
  { q: 'Weten is niet genoeg, we moeten toepassen. Willen is niet genoeg, we moeten handelen.', a: 'Bruce Lee', el: 'ka', time: 'morning' },
  { q: 'De succesvolle krijger is de gewone mens, met laserscherpe focus.', a: 'Bruce Lee', el: 'ka', time: 'morning' },
  { q: 'Ons buikgevoel is het derde brein dat we vergeten zijn.', a: 'Natuurlijk Agile', el: 'ka', time: 'morning' },
  { q: 'Wat de weg verspert, wordt de weg.', a: 'Marcus Aurelius', el: 'ka', time: 'morning' },
  { q: 'Natuurlijk leiderschap is kracht en vastberadenheid uitstralen — en het vuur doorgeven.', a: 'Natuurlijk Agile', el: 'ka', time: 'morning' },
  { q: 'Het is niet dat we weinig tijd hebben, maar dat we er veel verspillen.', a: 'Seneca', el: 'ka', time: 'evening' },
  { q: 'Je hebt macht over je geest, niet over gebeurtenissen.', a: 'Marcus Aurelius', el: 'ka', time: 'evening' },
  { q: 'Vuur dat alles wil verbranden, verwarmt niets.', a: 'Takumi', el: 'ka', time: 'evening' },
  { q: 'Ontleren is de belangrijkste stap.', a: 'Natuurlijk Agile', el: 'ka', time: 'evening' },
  { q: 'Slow down to speed up.', a: 'Natuurlijk Agile', el: 'ku', time: 'morning' },
  { q: 'Het hamsterwiel tot stilstand brengen — dat is de essentie.', a: 'Natuurlijk Agile', el: 'ku', time: 'morning' },
  { q: 'Leegte ervaren is topsport.', a: 'Natuurlijk Agile', el: 'ku', time: 'morning' },
  { q: 'Stilte is een bron van grote kracht.', a: 'Lao Tzu', el: 'ku', time: 'morning' },
  { q: 'Zie wat niet gezien kan worden.', a: 'Miyamoto Musashi', el: 'ku', time: 'morning' },
  { q: 'Leegte is waar alles samenkomt.', a: 'Natuurlijk Agile', el: 'ku', time: 'evening' },
  { q: 'Echte innovatie vindt plaats in de Leegte; daar worden patronen doorbroken.', a: 'Natuurlijk Agile', el: 'ku', time: 'evening' },
  { q: 'Verlies jezelf niet, juist als het zwaar wordt.', a: 'Miyamoto Musashi', el: 'ku', time: 'evening' },
  { q: 'Jouw team is het ruimteschip, jouw dojo om Leegte te bereiken.', a: 'Natuurlijk Agile', el: 'ku', time: 'evening' },
  { q: 'Denk licht over jezelf, en diep over de wereld.', a: 'Miyamoto Musashi', el: 'ku', time: 'evening' },
  { q: 'Je gaat het pas zien als je het doorhebt.', a: 'Johan Cruijff', el: 'ku', time: 'morning' },
  { q: 'Vijf elementen, één beoefenaar. Vandaag draag jij de vorm.', a: 'Takumi', time: 'morning' },
  { q: 'Niet sneller. Scherper.', a: 'Takumi', time: 'morning' },
  { q: 'Kachou Fuugetsu — ervaar de schoonheid van de natuur, leer over jezelf.', a: 'Japans gezegde', time: 'morning' },
  { q: 'Wijsheid is een hogere vorm van stille kennis.', a: 'Ikujiro Nonaka', time: 'morning' },
  { q: 'De agents navigeren, jij houdt het noorden.', a: 'Takumi', time: 'morning' },
  { q: 'Het kompas wijst, het duwt niet.', a: 'Takumi', time: 'morning' },
  { q: 'Meten is tellen; wegen is begrijpen.', a: 'Takumi', time: 'morning' },
  { q: 'We zijn wat we steeds opnieuw doen. Uitmuntendheid is geen daad, maar een gewoonte.', a: 'Aristoteles', time: 'morning' },
  { q: 'Een dag van rust telt mee — als je hem bewust kiest.', a: 'Takumi', time: 'evening' },
  { q: 'Balans is geen toestand maar een beweging.', a: 'Takumi', time: 'evening' },
  { q: 'De weegschaal beweegt pas als jij stilstaat.', a: 'Takumi', time: 'evening' },
  { q: 'Een vraag per dag weegt meer dan tien antwoorden.', a: 'Takumi', time: 'evening' },
  { q: 'Wat je vandaag niet afmaakt, mag morgen rijpen.', a: 'Takumi', time: 'evening' },
  // — Uit de grijze zone: de naald, terugveren boven toestand —
  { q: 'De grijze zone is hard, half en blind roeien.', a: 'Uit de grijze zone', el: 'ka', time: 'morning' },
  { q: 'Verdwaald ben je niet als je van de route raakt, maar als je het noorden kwijt bent.', a: 'Uit de grijze zone', el: 'ku', time: 'morning' },
  { q: 'De koers mag schuiven, het ritme staat vast.', a: 'Uit de grijze zone', el: 'chi', time: 'morning' },
  { q: 'Echte waarde is wat overblijft na herstel.', a: 'Uit de grijze zone', el: 'sui', time: 'evening' },
  { q: 'Wie te moe is, gelooft elke verkoper op de kade.', a: 'Uit de grijze zone', el: 'sui', time: 'evening' },
  { q: 'De golf krijgt alle aandacht, de berg geeft alle houvast.', a: 'Uit de grijze zone', el: 'ku', time: 'evening' },
];

// — Tijd: alles in Amsterdamse tijd (Cloudflare draait UTC; Intl regelt zomertijd) —
function amsNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
}
function dayOfYear() {
  const n = amsNow();
  const start = new Date(n.getFullYear(), 0, 0);
  return Math.floor((n - start) / 86400000);
}
function dagdeelNow() {
  const h = amsNow().getHours();
  return (h >= 17 || h < 5) ? 'evening' : 'morning'; // spiegelt tijdsbesef in index.html
}
function pick(arr) { return arr[dayOfYear() % arr.length]; }
function leaderToday() { return DAY_LEADERS[amsNow().getDay()]; }

// — Weging v1.1: de agent levert coördinaten uit de wereld, Takumi weegt ze tot een element —
// beweging: gereden (vandaag/gisteren) · hersteld (2–4 dagen) · rust (5+ dagen)
// Geen API-calls, geen handeling: de meting komt binnen, het kompas kiest de richting van de vraag.
function weeg(co) {
  if (!co || (!co.beweging && !co.agenda)) return null;
  const b = co.beweging, a = co.agenda;
  let el, reden;
  if (b === 'gereden' && a === 'vol')        { el = 'ku';  reden = 'Je hebt al bewogen en de dag is vol. Leegte: kies wat vandaag onaangeroerd blijft.'; }
  else if (b === 'gereden' && a === 'ruim')  { el = 'fu';  reden = 'Je hebt bewogen en de agenda heeft lucht. Wind: ruimte voor geest en verbinding.'; }
  else if (b === 'hersteld' && a === 'vol')  { el = 'chi'; reden = 'Uitgerust aan het begin van een volle dag. Aarde: laat structuur het werk dragen.'; }
  else if (b === 'hersteld' && a === 'ruim') { el = 'ka';  reden = 'Energie opgebouwd en ruimte in de dag. Vuur: kies waar je het legt.'; }
  else if (b === 'rust' && a === 'vol')      { el = 'sui'; reden = 'Al een tijd geen beweging en een volle agenda. Water: beweeg mee en bewaak je herstel.'; }
  else if (b === 'rust' && a === 'ruim')     { el = 'ka';  reden = 'Al een tijd geen beweging, wel ruimte. Vuur: wakker het voorzichtig weer aan.'; }
  else if (b === 'gereden')                  { el = 'chi'; reden = 'Je hebt bewogen. Aarde: de gewoonte draagt je.'; }
  else if (b === 'hersteld')                 { el = 'sui'; reden = 'Uitgerust. Water: bouw de flow rustig op.'; }
  else if (b === 'rust')                     { el = 'sui'; reden = 'Winterslaap. Water: voel eerst wat er stroomt.'; }
  else if (a === 'vol')                      { el = 'ku';  reden = 'Een volle agenda. Leegte: bewaak de stilte.'; }
  else                                       { el = 'ka';  reden = 'Een ruime agenda. Vuur: kies je richting.'; }
  return { element: el, reden, coordinaten: co };
}

function pulsePayload(type, weging) {
  const leader = leaderToday();
  const eid = (weging && MORNING_QUESTIONS[weging.element]) ? weging.element : leader.eid;
  const questions = type === 'morning' ? MORNING_QUESTIONS[eid] : EVENING_QUESTIONS[eid];
  const out = {
    type,
    timestamp: new Date().toISOString(),
    leader: { kanji: leader.kanji, name: leader.name, master: leader.master, element: leader.element },
    question: pick(questions)
  };
  if (weging) out.weging = weging;
  return out;
}

function reflectionPayload(period, weging) {
  const want = period === 'evening' ? 'evening' : 'morning';
  let pool = REFLECTIONS.filter(r => r.time === want || r.time === 'any');
  if (weging) {
    const elPool = pool.filter(r => r.el === weging.element);
    const elAny = REFLECTIONS.filter(r => r.el === weging.element);
    if (elPool.length) pool = elPool;
    else if (elAny.length) pool = elAny;
  }
  if (!pool.length) pool = REFLECTIONS;
  const r = pool[dayOfYear() % pool.length];
  const out = { reflectie: r.q, bron: r.a, element: r.el || null, dagdeel: want };
  if (weging) out.weging = weging;
  return out;
}

function noordenPayload() {
  const leader = leaderToday();
  return {
    noorden: 'De agents navigeren. De wereld levert de coördinaten. Takumi houdt het noorden vast — niet het magnetische, het menselijke.',
    dag_leider: { kanji: leader.kanji, name: leader.name, element: leader.element },
    bron: 'Het Menselijke Noorden — Takumi Master (Paul Takken)'
  };
}

// — MCP resource-catalogus —
const RESOURCES = [
  { uri: 'takumi://pulse/morning', name: 'Ochtendpuls',  description: 'Dag-leider (Godai-element) plus een uitnodigende ochtendvraag. Roteert dagelijks.', mimeType: 'application/json' },
  { uri: 'takumi://pulse/evening', name: 'Avondpuls',    description: 'Dag-leider plus een reflecterende avondvraag. Roteert dagelijks.', mimeType: 'application/json' },
  { uri: 'takumi://reflectie',     name: 'Dagreflectie', description: 'Eén reflectie uit Natuurlijk Agile, passend bij het dagdeel.', mimeType: 'application/json' },
  { uri: 'takumi://noorden',       name: 'Het Noorden',  description: 'Het oriëntatiepunt: de kernregel van het manifest plus de dag-leider als richting.', mimeType: 'application/json' }
];

function readResource(uri) {
  switch (uri) {
    case 'takumi://pulse/morning': return JSON.stringify(pulsePayload('morning'), null, 2);
    case 'takumi://pulse/evening': return JSON.stringify(pulsePayload('evening'), null, 2);
    case 'takumi://reflectie':     return JSON.stringify(reflectionPayload(dagdeelNow()), null, 2);
    case 'takumi://noorden':       return JSON.stringify(noordenPayload(), null, 2);
    default: return null;
  }
}

// — Lees-tool: de enige tool, puur read-only —
// Chat-clients tonen geen resources, alleen tools. Deze tool leest een oriëntatiepunt
// en geeft de inhoud terug. Geen zij-effecten, geen handeling — alleen wegen.
const ORIENTATIES = ['noorden', 'pulse/morning', 'pulse/evening', 'reflectie'];

const TOOLS = [
  {
    name: 'lees_kompas',
    title: 'Lees het kompas',
    description: 'Lees een Takumi-oriëntatiepunt (read-only). Geeft de inhoud van een ' +
      'takumi://-resource terug. Kies een oriëntatie: "noorden" (het manifest + dag-leider), ' +
      '"pulse/morning", "pulse/evening" of "reflectie". Standaard "noorden". ' +
      'Optioneel: geef coordinaten mee (meetpunten uit de wereld, bijv. uit Strava of de agenda) — ' +
      'Takumi weegt ze tot een element en kiest daar de vraag of reflectie bij. De weging is ' +
      'transparant en komt mee terug in het antwoord. ' +
      'Takumi weegt, het handelt niet — deze tool voert niets uit, het leest alleen.',
    inputSchema: {
      type: 'object',
      properties: {
        orientatie: {
          type: 'string',
          enum: ORIENTATIES,
          description: 'Welk oriëntatiepunt je wilt lezen. Standaard "noorden".'
        },
        coordinaten: {
          type: 'object',
          description: 'Optionele meetpunten. De agent levert de coördinaten; Takumi weegt. Zonder coordinaten geldt de dag-rotatie.',
          properties: {
            beweging: { type: 'string', enum: ['gereden', 'hersteld', 'rust'], description: 'gereden = vandaag of gisteren actief; hersteld = 2–4 dagen geleden; rust = 5+ dagen geen activiteit.' },
            agenda:   { type: 'string', enum: ['vol', 'ruim'],     description: 'Hoe de agenda van vandaag oogt.' }
          }
        }
      },
      required: []
    },
    annotations: {
      title: 'Lees het kompas',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
];

function callTool(name, args) {
  if (name !== 'lees_kompas') return { error: `Onbekende tool: ${name}` };
  const orient = (args && args.orientatie) || 'noorden';
  if (!ORIENTATIES.includes(orient)) return { error: `Onbekende oriëntatie: ${orient}` };
  const weging = weeg(args && args.coordinaten);
  let payload;
  switch (orient) {
    case 'pulse/morning': payload = pulsePayload('morning', weging); break;
    case 'pulse/evening': payload = pulsePayload('evening', weging); break;
    case 'reflectie':     payload = reflectionPayload(dagdeelNow(), weging); break;
    default:              payload = noordenPayload();
  }
  return { text: JSON.stringify(payload, null, 2) };
}

// — JSON-RPC helpers —
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function handleRpc(msg) {
  const { id, method, params } = msg;

  // Notifications (geen id) → geen response
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { resources: {}, tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Takumi is read-only: een kompas, geen navigator. Lees resources voor oriëntatie; Takumi voert nooit handelingen uit.'
      });

    case 'ping':
      return rpcResult(id, {});

    case 'resources/list':
      return rpcResult(id, { resources: RESOURCES });

    case 'resources/read': {
      const uri = params && params.uri;
      const text = readResource(uri);
      if (text === null) return rpcError(id, -32602, `Onbekende resource: ${uri}`);
      return rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text }] });
    }

    case 'tools/list':
      // Eén read-only lees-tool. Takumi handelt niet; het leest en weegt.
      return rpcResult(id, { tools: TOOLS });

    case 'tools/call': {
      const r = callTool(params && params.name, params && params.arguments);
      if (r.error) return rpcResult(id, { isError: true, content: [{ type: 'text', text: r.error }] });
      return rpcResult(id, { content: [{ type: 'text', text: r.text }] });
    }

    case 'prompts/list':
      return rpcResult(id, { prompts: [] });

    default:
      return rpcError(id, -32601, `Methode niet ondersteund: ${method}`);
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // GET → health / server-info (handig voor browsers en eenvoudige checks)
  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      server: SERVER_INFO,
      iconUrl: 'https://app.takumi-master.com/takumi-mcp.svg',
      protocol: PROTOCOL_VERSION,
      transport: 'streamable-http',
      readonly: true,
      resources: RESOURCES.map(r => r.uri),
      tools: TOOLS.map(t => t.name),
      note: 'Takumi MCP — een balanslaag tussen mens en machine, geen actor. Read-only resources plus één lees-tool (lees_kompas). Geen handelingen.'
    }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, 'Parse error')), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }

  // Batch of enkel bericht
  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];
  const responses = messages.map(handleRpc).filter(r => r !== null);

  // Alleen notifications → 202 zonder body
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: CORS });
  }

  const payload = isBatch ? responses : responses[0];
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });
}
