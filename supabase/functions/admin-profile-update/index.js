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

const randomPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('authorization') ?? '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return respond({ error: 'Sign in again to update your profile.' }, 401);

  let admin;
  let userId;
  let previousEmail;
  let emailChanged = false;
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
    const password = typeof body.password === 'string' && body.password ? body.password : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150
      || !username || username.length > 50 || !fullName || fullName.length > 100
      || (phone?.length ?? 0) > 20 || (password && new TextEncoder().encode(password).length > 72)) {
      return respond({ error: 'Check the profile fields and try again.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase Edge Function secrets are missing.');
    admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData.user) return respond({ error: 'Sign in again to update your profile.' }, 401);
    userId = authData.user.id;

    const { data: currentRows, error: currentError } = await admin.rpc('get_legacy_admin_profile', { p_user_id: userId });
    const current = currentRows?.[0];
    if (currentError || !current) return respond({ error: 'This account is not authorized to update the admin profile.' }, 403);
    previousEmail = current.email;
    emailChanged = email !== previousEmail.toLowerCase();

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
      password: randomPassword(),
    });
    if (authUpdateError) return respond({ error: 'Could not update the account email.' }, 400);

    const { data: updatedRows, error: updateError } = await admin.rpc('update_legacy_admin_profile', {
      p_user_id: userId,
      p_previous_email: previousEmail,
      p_email: email,
      p_username: username,
      p_full_name: fullName,
      p_phone: phone,
      p_password: password,
    });
    const profile = updatedRows?.[0];
    if (updateError || !profile) {
      if (emailChanged) {
        await admin.auth.admin.updateUserById(userId, {
          email: previousEmail,
          email_confirm: true,
          password: randomPassword(),
        });
      }
      return respond({ error: 'Could not save profile. Check for a duplicate email or username.' }, 400);
    }

    return respond({ profile });
  } catch {
    if (admin && userId && emailChanged && previousEmail) {
      try {
        await admin.auth.admin.updateUserById(userId, {
          email: previousEmail,
          email_confirm: true,
          password: randomPassword(),
        });
      } catch { /* Keep the login password random even if an email rollback fails. */ }
    }
    return respond({ error: 'Could not save profile. Try again.' }, 500);
  }
});
