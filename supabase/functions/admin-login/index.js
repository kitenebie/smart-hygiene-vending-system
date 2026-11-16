import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function findUserByEmail(client, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

function randomPassword() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const clientIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 || !password || new TextEncoder().encode(password).length > 72) {
      return respond({ error: 'Invalid email or password.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase Edge Function secrets are missing.');
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: admins, error: verifyError } = await admin.rpc('verify_legacy_admin_login', {
      p_email: email,
      p_password: password,
      p_client_ip: clientIp,
    });
    if (verifyError) throw verifyError;
    const legacyAdmin = admins?.[0];
    if (!legacyAdmin) return respond({ error: 'Invalid email or password.' }, 401);

    let user = await findUserByEmail(admin, legacyAdmin.email.toLowerCase());
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: legacyAdmin.email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { username: legacyAdmin.username, full_name: legacyAdmin.full_name, phone: legacyAdmin.phone },
      });
      if (error) throw error;
      user = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(user.id, {
        password: randomPassword(),
        email_confirm: true,
      });
      if (error) throw error;
      user = data.user;
    }

    const { error: profileError } = await admin.from('profiles').upsert({
      id: user.id,
      username: legacyAdmin.username,
      full_name: legacyAdmin.full_name,
      phone: legacyAdmin.phone,
      role: legacyAdmin.role,
    }, { onConflict: 'id' });
    if (profileError) throw profileError;

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: legacyAdmin.email });
    if (linkError || !link?.properties?.hashed_token) throw linkError ?? new Error('Supabase did not return a login token.');
    return respond({ token_hash: link.properties.hashed_token });
  } catch {
    return respond({ error: 'Unable to sign in. Try again.' }, 500);
  }
});
