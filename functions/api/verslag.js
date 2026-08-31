// /api/verslag — kort wedstrijdverslag voor de ouderapp, geschreven door Claude.
// Zelfde beveiliging als /api/coach-tip: teamcode + pincode verplicht.

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }){
  const body = await request.json().catch(() => null);
  if (!body?.wedstrijd) return json({ error: 'geen wedstrijd' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'geen API-sleutel geconfigureerd' }, 500);

  const code = (body.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const raw = code ? await env.TAKUMI_USERS.get(`wisselcoach:team:${code}`) : null;
  if (!raw || JSON.parse(raw).pinHash !== (await sha256(String(body.pin || '')))) {
    return json({ error: 'teamcode of pincode onjuist' }, 403);
  }

  const w = body.wedstrijd;
  const scorers = Array.isArray(body.scorers) ? body.scorers.slice(0, 15) : [];
  const steekwoorden = String(body.steekwoorden || '').slice(0, 300);
  const feiten = [
    `Wedstrijd: Jongens O16-5 (Schaerweijde) ${w.thuis ? 'thuis' : 'uit'} tegen ${String(w.tegenstander || '').slice(0, 60)}, datum ${w.datum}.`,
    `Uitslag: ${w.voor ?? '?'}-${w.tegen ?? '?'} vanuit ons gezien.`,
    scorers.length ? `Doelpuntenmakers: ${scorers.map(s => `${s.naam} (${s.n})`).join(', ')}.` : 'Doelpuntenmakers: geen geregistreerd.',
    steekwoorden ? `Aantekeningen van de coach: "${steekwoorden}".` : '',
  ].filter(Boolean).join('\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 450,
      system: 'Je schrijft korte wedstrijdverslagen voor de oudergroepsapp van veldhockeyteam Jongens O16-5 van Schaerweijde. Toon: warm, enthousiast en nuchter Nederlands; positief over de inzet, ook bij verlies, maar zonder overdrijving. Dit is veldhockey: gebruik hockeytaal en nooit voetbaltermen (aftrap, penalty, buitenspel, doeltrap bestaan niet). Lengte 80-120 woorden, \u00e9\u00e9n alinea. Benoem de uitslag en de doelpuntenmakers exact zoals aangeleverd; verzin geen spelmomenten die niet in de aantekeningen staan. Sluit af met \u00e9\u00e9n korte vooruitblik. Antwoord met alleen het verslag.',
      messages: [{ role: 'user', content: feiten }],
    }),
  });
  if (!r.ok) return json({ error: 'verslag maken mislukt' }, 502);
  const d = await r.json();
  const verslag = (d.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
  if (!verslag) return json({ error: 'leeg verslag ontvangen' }, 502);
  return json({ verslag });
}
