// /api/coach-tip — korte coachtips van Claude op basis van steekwoorden.
// Beveiligd met teamcode + pincode (zelfde check als /api/team) zodat de
// Anthropic-sleutel niet publiek misbruikt kan worden.

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }){
  const body = await request.json().catch(() => null);
  if (!body?.tekst || typeof body.tekst !== 'string') return json({ error: 'geen invoer' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'geen API-sleutel geconfigureerd' }, 500);

  // Pincontrole tegen het teamrecord
  const code = (body.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const raw = code ? await env.TAKUMI_USERS.get(`wisselcoach:team:${code}`) : null;
  if (!raw || JSON.parse(raw).pinHash !== (await sha256(String(body.pin || '')))) {
    return json({ error: 'teamcode of pincode onjuist' }, 403);
  }

  const tekst = body.tekst.slice(0, 300);
  const c = body.context || {};
  const situatie = `Stand: ${c.voor ?? 0}-${c.tegen ?? 0} (wij eerst). Kwart ${c.kwart ?? '?'}, blok ${c.blok ?? '?'}.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system: 'Je bent assistent-coach van een JO16-hockeyteam (veldhockey, 11-tal). De hoofdcoach staat langs de lijn en stuurt je steekwoorden over wat hij ziet. Antwoord met precies 3 korte, direct uitvoerbare aanwijzingen in het Nederlands die de coach naar het veld kan roepen of in de kwartpauze kan meegeven. Elke tip is 1 zin van maximaal 12 woorden, concreet en positief geformuleerd, passend bij O16-niveau. Geen inleiding, geen uitleg: alleen de 3 tips, elk op een eigen regel zonder nummering of streepjes.',
      messages: [{ role: 'user', content: `${situatie}\nWaarneming van de coach: "${tekst}"` }],
    }),
  });
  if (!r.ok) return json({ error: 'tips ophalen mislukt' }, 502);
  const d = await r.json();
  const ruwe = (d.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  const tips = ruwe.split('\n').map(s => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3);
  if (!tips.length) return json({ error: 'geen tips ontvangen' }, 502);
  return json({ tips });
}
