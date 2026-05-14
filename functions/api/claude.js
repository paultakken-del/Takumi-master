// Hard daily limit per user (incl. anoniem) op de Claude proxy.
// Beschermt tegen ontspoorde kosten bij beta. Pas aan via DAILY_LIMIT
// env var; default 50 calls/dag/user. Admin (paul.takken@gmail.com) is
// uitgezonderd zodat eigen ontwikkelwerk niet beperkt wordt.
const DEFAULT_DAILY_LIMIT = 50;
const ADMIN_EMAIL = 'paul.takken@gmail.com';

function parseJwtPayload(token){
  try {
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const json = atob(b64);
    return JSON.parse(json);
  } catch { return null; }
}

function getCookie(request, name){
  const header = request.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find(c => c.startsWith(name + '='));
  return match ? match.slice(name.length + 1) : null;
}

function todayKey(){
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ 
      error: 'ANTHROPIC_API_KEY niet geconfigureerd',
      hint: 'Voeg toe via Cloudflare Pages → Settings → Variables and Secrets'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // ── RATE-LIMIT ────────────────────────────────────────────────────
  // Extract uid uit gsession cookie. Geen cookie → val terug op IP-hash
  // (mildere bescherming maar voorkomt anonieme abuse).
  const gsession = getCookie(request, 'gsession');
  const payload = gsession ? parseJwtPayload(gsession) : null;
  const uid = payload?.sub
    || ('ip:' + (request.headers.get('cf-connecting-ip') || 'unknown'));
  const isAdmin = payload?.email === ADMIN_EMAIL;

  if (!isAdmin && env.TAKUMI_USERS) {
    const limit = parseInt(env.DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
    const rlKey = `rl:${uid}:${todayKey()}`;
    try {
      const current = parseInt(await env.TAKUMI_USERS.get(rlKey)) || 0;
      if (current >= limit) {
        return new Response(JSON.stringify({
          error: 'Dagelijkse limiet bereikt',
          hint: `Je hebt ${limit} AI-berichten gebruikt vandaag. Reset om middernacht (Europa/Amsterdam). Tip: gebruik de Dojo voor reflectie zonder API-call.`,
          rateLimited: true,
          limit: limit,
          used: current
        }), { status: 429, headers: { 'Content-Type': 'application/json' } });
      }
      // Increment teller — KV is eventually consistent maar voor day-bucket
      // is dat geen issue (kleine overshoot bij parallelle calls acceptabel)
      await env.TAKUMI_USERS.put(rlKey, String(current + 1), {
        expirationTtl: 60 * 60 * 36 // 36 uur — dekt timezone-grens veilig
      });
    } catch (e) {
      // KV down? Door laten gaan ipv hele app blokkeren — log naar console
      console.error('Rate-limit KV error:', e);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ongeldige JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const isStreaming = body?.stream === true;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return new Response(JSON.stringify({ error: `Anthropic ${upstream.status}: ${err}` }), {
        status: upstream.status, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (isStreaming) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    return new Response(JSON.stringify(await upstream.json()), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
