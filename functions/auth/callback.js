export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return Response.redirect('https://app.takumi-master.com?auth_error=1', 302);

  // Pak signup-source uit OAuth state (door /auth/google meegegeven)
  let source = url.searchParams.get('state') || '';
  source = source.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  'https://app.takumi-master.com/auth/callback',
      grant_type:    'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokens.id_token) return Response.redirect('https://app.takumi-master.com?auth_error=2', 302);

  const payload = JSON.parse(atob(tokens.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const now = Math.floor(Date.now() / 1000);

  // Check of gebruiker gebanned is
  if (env.TAKUMI_USERS) {
    const existing = await env.TAKUMI_USERS.get(payload.sub);
    if (existing) {
      const user = JSON.parse(existing);
      if (user.banned) {
        return new Response(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#fff5f5">
<h2 style="color:#c83232">Toegang geblokkeerd</h2>
<p style="margin:12px 0;color:#888">Jouw account heeft geen toegang tot Takumi.</p>
<p style="color:#aaa;font-size:13px">${payload.email}</p>
</body></html>`, { status: 403, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
      }
    }
  }

  // Sla gebruiker op in KV
  if (env.TAKUMI_USERS) {
    // Check of gebruiker al bestaat (bewaar firstSeen + source)
    const existing = await env.TAKUMI_USERS.get(payload.sub);
    if (existing) {
      const prev = JSON.parse(existing);
      await env.TAKUMI_USERS.put(payload.sub, JSON.stringify({
        ...prev,
        lastSeen: now,
        loginCount: (prev.loginCount || 1) + 1,
        // source NIET overschrijven — eerste klap is een daalder waard
      }));
    } else {
      await env.TAKUMI_USERS.put(payload.sub, JSON.stringify({
        email:      payload.email,
        name:       payload.name || payload.email,
        picture:    payload.picture || '',
        firstSeen:  now,
        lastSeen:   now,
        loginCount: 1,
        ...(source ? { source } : {}),
      }));
    }
  }

  // Maak JWT sessie
  const sess = { sub: payload.sub, email: payload.email, name: payload.name||payload.email, picture: payload.picture||'', iat: now, exp: now+604800, loginAt: now };
  const h = btoa(JSON.stringify({alg:'HS256',typ:'JWT'})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const b = btoa(JSON.stringify(sess)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JWT_SECRET||'fallback'), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(h+'.'+b));
  const s = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  return Response.redirect('https://app.takumi-master.com?gsession='+h+'.'+b+'.'+s, 302);
}
