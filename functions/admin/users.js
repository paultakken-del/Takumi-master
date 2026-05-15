const ADMIN_EMAIL = 'paul.takken@gmail.com';

async function getUser(env, id) {
  const val = await env.TAKUMI_USERS.get(id);
  return val ? { id, ...JSON.parse(val) } : null;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/gsession=([^;]+)/)?.[1] || url.searchParams.get('t');

  if (!token) return unauthorized();

  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.email !== ADMIN_EMAIL) return unauthorized();
    if (payload.exp < Math.floor(Date.now()/1000)) return unauthorized();
  } catch { return unauthorized(); }

  // Handle ban/unban/cleanup POST
  if (request.method === 'POST') {
    const body = await request.formData();
    const action = body.get('action');
    const uid = body.get('uid');
    if (uid && (action === 'ban' || action === 'unban')) {
      const user = await getUser(env, uid);
      if (user) {
        user.banned = action === 'ban';
        user.bannedAt = action === 'ban' ? Math.floor(Date.now()/1000) : null;
        const { id, ...data } = user;
        await env.TAKUMI_USERS.put(uid, JSON.stringify(data));
      }
    }
    // Cleanup dead records — records zonder name én zonder email zijn
    // legacy/corrupt vanuit vroege callback-versies; verwijder permanent.
    if (action === 'cleanup_dead') {
      const list = await env.TAKUMI_USERS.list();
      const all = await Promise.all(list.keys.map(k => getUser(env, k.name)));
      const dead = all.filter(u => u && !u.name && !u.email);
      await Promise.all(dead.map(u => env.TAKUMI_USERS.delete(u.id)));
    }
    return Response.redirect(url.toString(), 303);
  }

  // List all users
  const list = await env.TAKUMI_USERS.list();
  const allUsers = (await Promise.all(list.keys.map(k => getUser(env, k.name))))
    .filter(Boolean);

  // Tel dead records (geen name én geen email) — corrupt vanuit legacy
  // callback-versies, niet zichtbaar in de lijst.
  const deadCount = allUsers.filter(u => !u.name && !u.email).length;

  // Toon alleen records met op zijn minst een name OF email
  const users = allUsers
    .filter(u => u.name || u.email)
    .sort((a,b) => (b.lastSeen || 0) - (a.lastSeen || 0));

  const fmt = ts => ts ? new Date(ts*1000).toLocaleString('nl-NL', {timeZone:'Europe/Amsterdam'}) : '—';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const active = users.filter(u => !u.banned);
  const banned = users.filter(u => u.banned);

  // Source-telling (alleen actieve users)
  const sourceCounts = {};
  let noSource = 0;
  active.forEach(u => {
    if (u.source) sourceCounts[u.source] = (sourceCounts[u.source] || 0) + 1;
    else noSource++;
  });
  const sortedSources = Object.entries(sourceCounts).sort((a,b) => b[1]-a[1]);
  const sourcesHtml = (sortedSources.length || noSource)
    ? `<div class="sources">${sortedSources.map(([k,v]) => `<span class="src-pill"><code>${esc(k)}</code> · ${v}</span>`).join('')}${noSource ? `<span class="src-pill src-pill-none">geen tag · ${noSource}</span>` : ''}</div>`
    : '';

  const userCard = (u) => `
<div class="card ${u.banned ? 'banned' : ''}">
  <div class="card-top">
    <div>
      <div class="name">${esc(u.name || u.email || '(geen naam)')} ${u.banned ? '<span class="badge red">Gebanned</span>' : `<span class="badge">${u.loginCount || 1}×</span>`}</div>
      <div class="email">${esc(u.email || '—')}</div>
    </div>
    <form method="POST">
      <input type="hidden" name="uid" value="${u.id}">
      <input type="hidden" name="action" value="${u.banned ? 'unban' : 'ban'}">
      <button class="btn ${u.banned ? 'btn-green' : 'btn-red'}" type="submit">${u.banned ? 'Unban' : 'Ban'}</button>
    </form>
  </div>
  <div class="meta">
    <span>Eerste login: ${fmt(u.firstSeen)}</span>
    <span>Laatste login: ${fmt(u.lastSeen)}</span>
    ${u.source ? `<span>Bron: <code>${esc(u.source)}</code></span>` : ''}
    ${u.banned ? `<span>Gebanned op: ${fmt(u.bannedAt)}</span>` : ''}
  </div>
</div>`;

  // Cleanup-knop alleen tonen als er dode records bestaan
  const cleanupHtml = deadCount > 0
    ? `<form method="POST" class="cleanup" onsubmit="return confirm('${deadCount} legacy record(s) zonder name+email permanent verwijderen uit KV?')">
         <input type="hidden" name="action" value="cleanup_dead">
         <button class="btn-cleanup" type="submit">🗑 ${deadCount} dode record${deadCount===1?'':'s'} opruimen</button>
       </form>`
    : '';

  return new Response(`<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Takumi — Gebruikers</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f6f2eb;color:#1a1815;padding:24px;max-width:620px;margin:0 auto}
h1{font-size:22px;font-weight:600;margin-bottom:4px}
h2{font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#7a7060;margin:28px 0 12px}
.sub{font-size:13px;color:#7a7060;margin-bottom:8px}
.card{background:#fff;border-radius:12px;border:1px solid rgba(28,24,21,.09);padding:16px 20px;margin-bottom:10px}
.card.banned{background:#fff5f5;border-color:rgba(200,50,50,.15)}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
.name{font-size:15px;font-weight:600;margin-bottom:3px}
.email{font-size:13px;color:#c4532a}
.meta{font-size:12px;color:#7a7060;display:flex;flex-direction:column;gap:3px}
.badge{display:inline-block;background:rgba(196,83,42,.1);color:#c4532a;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:6px}
.badge.red{background:rgba(200,50,50,.12);color:#c83232}
.btn{border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui;white-space:nowrap}
.btn-red{background:#c83232;color:#fff}
.btn-green{background:#2d8a4e;color:#fff}
.empty{color:#7a7060;font-size:14px;padding:16px 0}
.sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;margin-bottom:6px}
.src-pill{background:#fff;border:1px solid rgba(28,24,21,.09);border-radius:20px;padding:4px 11px;font-size:11.5px;color:#5a5248}
.src-pill code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#c4532a;font-size:11px}
.src-pill-none{color:#a8a097;font-style:italic}
.cleanup{margin-top:14px}
.btn-cleanup{background:none;border:1px dashed rgba(28,24,21,.18);color:#7a7060;font-size:12px;padding:8px 14px;border-radius:8px;cursor:pointer;font-family:system-ui;letter-spacing:.02em;transition:all .15s}
.btn-cleanup:hover{border-color:#c83232;color:#c83232;border-style:solid}
</style></head><body>
<h1>匠 Gebruikers</h1>
<p class="sub">${active.length} actief · ${banned.length} gebanned${deadCount > 0 ? ` · <span style="color:#a8a097">${deadCount} legacy</span>` : ''}</p>
${sourcesHtml}
${cleanupHtml}
<h2>Actief</h2>
${active.length ? active.map(userCard).join('') : '<p class="empty">Geen actieve gebruikers.</p>'}
${banned.length ? `<h2>Gebanned</h2>${banned.map(userCard).join('')}` : ''}
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

function unauthorized() {
  return new Response(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px">
<h2>Geen toegang</h2><p style="margin:12px 0;color:#888">Log in via de app.</p>
<a href="https://app.takumi-master.com" style="background:#c4532a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px">Naar app →</a>
</body></html>`, { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
