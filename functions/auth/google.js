export async function onRequest({ request, env }) {
  const id = env.GOOGLE_CLIENT_ID;
  if (!id) return new Response('GOOGLE_CLIENT_ID niet ingesteld', { status: 500 });

  // Pak optionele source-tag uit ?source=<channel> en sanitize
  const url = new URL(request.url);
  let source = url.searchParams.get('source') || '';
  source = source.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

  const p = new URLSearchParams({
    client_id: id,
    redirect_uri: 'https://app.takumi-master.com/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  });
  if (source) p.set('state', source);

  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + p, 302);
}
