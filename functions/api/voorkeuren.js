// /api/voorkeuren — WhatsApp-antwoorden vertalen naar voorkeursposities per speler.
// Zelfde beveiliging als de andere AI-endpoints: teamcode + pincode verplicht.

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }){
  const body = await request.json().catch(() => null);
  if (!body?.tekst || !Array.isArray(body.spelers) || !Array.isArray(body.posities)) return json({ error: 'ongeldige aanvraag' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'geen API-sleutel geconfigureerd' }, 500);

  const code = (body.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const raw = code ? await env.TAKUMI_USERS.get(`wisselcoach:team:${code}`) : null;
  if (!raw || JSON.parse(raw).pinHash !== (await sha256(String(body.pin || '')))) {
    return json({ error: 'teamcode of pincode onjuist' }, 403);
  }

  const spelers = body.spelers.slice(0, 25).map(String);
  const posities = body.posities.slice(0, 15).map(p => ({ code: String(p.code), naam: String(p.naam) }));
  const geldigeCodes = new Set(posities.map(p => p.code));

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system: `Je krijgt geplakte WhatsApp-berichten waarin jeugdspelers van een veldhockeyteam hun favoriete posities doorgeven, plus de spelerslijst en de positielijst. Haal per speler maximaal 3 voorkeursposities in volgorde eruit.

Regels:
- Koppel WhatsApp-namen ruimhartig aan de spelerslijst (voornaam, volledige naam, bijnaam, "mama van X" betekent speler X). Twijfel je serieus, koppel dan niet.
- Vertaal positiewoorden en synoniemen naar de gegeven codes (bijv. spits/centrumspits, mid/middenmid/centrale middenvelder, laatste man/libero, vrije man/voorlaatste man, linksback/linksachter, linksvoor/linksbuiten). Keeper is geen veldpositie: negeren.
- De volgorde van noemen is de voorkeursvolgorde. Berichten zonder posities (grappen, emoji, vragen) negeer je.
- Als iemand meerdere keren antwoordt, telt zijn laatste bericht.

Antwoord met UITSLUITEND geldige JSON, zonder toelichting of codeblok, in dit formaat:
{"voorkeuren":[{"speler":"<exacte naam uit de spelerslijst>","posities":["CODE","CODE"]}],"nietHerkend":["<naam uit de chat die je niet kon koppelen>"]}`,
      messages: [{ role: 'user', content: `Spelerslijst: ${spelers.join(', ')}\nPosities: ${posities.map(p => `${p.code}=${p.naam}`).join(', ')}\n\nWhatsApp-berichten:\n${body.tekst.slice(0, 6000)}` }],
    }),
  });
  if (!r.ok) return json({ error: 'verwerken mislukt' }, 502);
  const d = await r.json();
  const ruwe = (d.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(ruwe); } catch { return json({ error: 'antwoord niet leesbaar' }, 502); }

  const voorkeuren = (Array.isArray(parsed.voorkeuren) ? parsed.voorkeuren : [])
    .filter(v => spelers.includes(v.speler) && Array.isArray(v.posities))
    .map(v => ({ speler: v.speler, posities: [...new Set(v.posities.filter(c => geldigeCodes.has(c)))].slice(0, 3) }))
    .filter(v => v.posities.length > 0);
  const nietHerkend = (Array.isArray(parsed.nietHerkend) ? parsed.nietHerkend : []).map(String).slice(0, 15);
  return json({ voorkeuren, nietHerkend });
}
