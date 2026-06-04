// /mcp — Takumi Master MCP-server (Streamable HTTP, JSON-RPC 2.0)
//
// Het menselijke noorden, leesbaar voor agents.
// READ-ONLY: alleen resources, geen tools. Takumi weegt, het handelt niet.
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
  version: '0.1.0',
  title: 'Takumi — het menselijke noorden',
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
  chi:   ['Welk fundament onder vandaag draagt nog steeds?', 'Wat is de structuur waarop je vandaag bouwt?', 'Waar staat de aarde stevig onder je voeten?', 'Welke gewoonte verdient vandaag aandacht?'],
  sui:   ['Waar heeft je herstel ruimte vandaag?', 'Welk gesprek wacht onder de oppervlakte?', 'Wat stroomt al voor jij iets doet?', 'Wat heeft je lichaam vandaag te zeggen?'],
  fu:    ['Welke verbinding vraagt vandaag jouw stem?', 'Waar wil je vandaag schrijven of spreken?', 'Welk gesprek heeft te lang geduurd zonder lucht?', 'Wie wil je vandaag echt zien?'],
  ka:    ['Waar wil je vandaag je vuur leggen?', 'Welke beslissing wacht al te lang?', 'Wat verdient je volledige energie deze ochtend?', 'Welke actie maakt het verschil vandaag?'],
  board: ['Wat vraagt vandaag om synthese, niet om een nieuwe stap?', 'Welke vijf dingen zijn eigenlijk één?', 'Wat heeft de week tot nu toe geleerd?', 'Waar passen de elementen vandaag samen?'],
  ku:    ['Wat mag vandaag onaangeroerd blijven?', 'Waar past stilte beter dan een antwoord?', 'Wat wil je vandaag loslaten?', 'Welke vraag onder de vraag voel je al?']
};

const EVENING_QUESTIONS = {
  chi:   ['Welk fundament hield vandaag stand?', 'Wat bouwde je toe aan je grond?', 'Welke routine eerde je vandaag?', 'Wat van vandaag wil je morgen weer doen?'],
  sui:   ['Welk gesprek had je vandaag niet?', 'Wat stroomde, wat stokte?', 'Waar miste herstel zijn plek?', 'Wat voelde je dat je nog niet hebt gezegd?'],
  fu:    ['Welke verbinding kreeg vandaag jouw aandacht?', 'Wat heb je geschreven of gesproken dat ertoe deed?', 'Welk gesprek bleef je hangen?', 'Waar zat de wind van vandaag?'],
  ka:    ['Waar verschoof je energie vandaag?', 'Welke actie was beslissend?', 'Wat verbrandde voor niets?', 'Waar legde je vuur, waar doofde het?'],
  board: ['Wat liet vandaag de raad meekijken?', 'Welke elementen werkten samen, welke schuurden?', 'Wat zou de hele raad nu samen zeggen?', 'Waar kwam alles vandaag bij elkaar?'],
  ku:    ['Wat liet je vandaag liggen — en was dat goed?', 'Welke ruimte ontstond toen je niets deed?', 'Waar voelde je de leegte aanwezig?', 'Wat wist je voor je het kon benoemen?']
};

// — Reflecties uit Natuurlijk Agile (subset, één source of truth blijft index.html) —
const REFLECTIONS = [
  { q: 'De rots in de branding houdt geen gevoel, maar kent het beste de zee.', a: 'Natuurlijk Agile', el: 'chi', time: 'morning' },
  { q: 'Creativiteit en vrijheid zijn waardevol — maar discipline redt soms je leven.', a: 'Natuurlijk Agile', el: 'chi', time: 'morning' },
  { q: 'Vandaag overwin je de jij van gisteren.', a: 'Miyamoto Musashi', el: 'chi', time: 'morning' },
  { q: 'Denk zuiver. De weg ligt in de beoefening.', a: 'Miyamoto Musashi', el: 'chi', time: 'any' },
  { q: 'Eerst meebewegen met wat is. Dan pas een nieuwe richting tonen.', a: 'Natuurlijk Agile', el: 'sui', time: 'morning' },
  { q: 'De stijfste boom breekt het eerst. De bamboe overleeft door mee te buigen.', a: 'Bruce Lee', el: 'sui', time: 'evening' },
  { q: 'Wees als water dat door elke kier zijn weg vindt. Wees water, mijn vriend.', a: 'Bruce Lee', el: 'sui', time: 'any' },
  { q: 'Soms moet er gewoon een andere wind waaien.', a: 'Natuurlijk Agile', el: 'fu', time: 'morning' },
  { q: 'De bovenliggende stroom gaat in de juiste richting — ook als de wind nu guur is.', a: 'Natuurlijk Agile', el: 'fu', time: 'evening' },
  { q: 'Verandering komt in spiralen, niet in lijnen.', a: 'Natuurlijk Agile', el: 'fu', time: 'any' },
  { q: 'Elke dag is er een keuze: wakker je het vuur aan, of laat je het uitdoven?', a: 'Natuurlijk Agile', el: 'ka', time: 'morning' },
  { q: 'Weten is niet genoeg, we moeten toepassen. Willen is niet genoeg, we moeten handelen.', a: 'Bruce Lee', el: 'ka', time: 'morning' },
  { q: 'De succesvolle krijger is de gewone mens, met laserscherpe focus.', a: 'Bruce Lee', el: 'ka', time: 'morning' },
  { q: 'Slow down to speed up.', a: 'Natuurlijk Agile', el: 'ku', time: 'morning' },
  { q: 'Leegte is waar alles samenkomt.', a: 'Natuurlijk Agile', el: 'ku', time: 'evening' },
  { q: 'Je gaat het pas zien als je het doorhebt.', a: 'Johan Cruijff', el: 'ku', time: 'any' },
  { q: 'Verlies jezelf niet, juist als het zwaar wordt.', a: 'Miyamoto Musashi', el: 'ku', time: 'evening' },
  { q: 'Vijf elementen, één beoefenaar. Vandaag draag jij de vorm.', a: 'Takumi', time: 'morning' },
  { q: 'Niet sneller. Scherper.', a: 'Takumi', time: 'morning' },
  { q: 'De vraag is niet wat je bereikt. De vraag is wat je waarneemt onderweg.', a: 'Takumi', time: 'any' },
  { q: 'Een dag van rust telt mee — als je hem bewust kiest.', a: 'Takumi', time: 'evening' },
  { q: 'Denk licht over jezelf, en diep over de wereld.', a: 'Miyamoto Musashi', time: 'evening' },
  { q: 'We zijn wat we steeds opnieuw doen. Uitmuntendheid is geen daad, maar een gewoonte.', a: 'Aristoteles', time: 'morning' },
  { q: 'Een doel hoeft niet altijd bereikt te worden — vaak dient het simpelweg als richtpunt.', a: 'Bruce Lee', time: 'any' }
];

function dayOfYear() { return Math.floor((Date.now() / 86400000) % 365); }
function pick(arr) { return arr[dayOfYear() % arr.length]; }
function leaderToday() { return DAY_LEADERS[new Date().getUTCDay()]; }

function pulsePayload(type) {
  const leader = leaderToday();
  const questions = type === 'morning' ? MORNING_QUESTIONS[leader.eid] : EVENING_QUESTIONS[leader.eid];
  return {
    type,
    timestamp: new Date().toISOString(),
    leader: { kanji: leader.kanji, name: leader.name, master: leader.master, element: leader.element },
    question: pick(questions)
  };
}

function reflectionPayload(period) {
  const want = period === 'evening' ? 'evening' : 'morning';
  let pool = REFLECTIONS.filter(r => r.time === want || r.time === 'any');
  if (!pool.length) pool = REFLECTIONS;
  const r = pool[dayOfYear() % pool.length];
  return { reflectie: r.q, bron: r.a, element: r.el || null, dagdeel: want };
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
    case 'takumi://reflectie':     return JSON.stringify(reflectionPayload('morning'), null, 2);
    case 'takumi://noorden':       return JSON.stringify(noordenPayload(), null, 2);
    default: return null;
  }
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
        capabilities: { resources: {} },
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
      // Bewust leeg. Takumi biedt geen tools — het weegt, het handelt niet.
      return rpcResult(id, { tools: [] });

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
      note: 'Takumi MCP — een spiegel, geen stuurman. Read-only resources, geen tools.'
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
