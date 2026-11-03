import { useState, useEffect, createContext, useContext } from 'react';
import { supabase } from '../utils/supabase';

export interface AdminUser {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  last_login: string | null;
}

interface AuthCtx {
  admin: AdminUser | null;
  loading: boolean;
  login: (identity: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateAdminState: (user: AdminUser) => void;
}

const AuthContext = createContext<AuthCtx>({ admin: null, loading: true, login: async () => ({ success: false }), logout: async () => {}, updateAdminState: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string, email: string | undefined) {
    const { data, error } = await supabase.from('profiles').select('id, username, full_name, phone, role, last_login').eq('id', userId).maybeSingle();
    return error || !data ? null : { ...data, email: email ?? null } as AdminUser;
  }

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const profile = session ? await loadProfile(session.user.id, session.user.email) : null;
      if (mounted) { setAdmin(profile); setLoading(false); }
    };
    void sync();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => { if (mounted) setAdmin(session ? await loadProfile(session.user.id, session.user.email) : null); })();
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const login = async (identity: string, password: string) => {
    const email = identity.trim().toLowerCase() === 'admin' ? 'team4peace@veritas.edu.ph' : identity.trim();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { success: false, error: 'Invalid email or password.' };
    const profile = await loadProfile(data.user.id, data.user.email);
    if (!profile) {
      await supabase.auth.signOut();
      return { success: false, error: 'This account is not authorized for the dashboard.' };
    }
    const last_login = new Date().toISOString();
    await supabase.from('profiles').update({ last_login }).eq('id', profile.id);
    setAdmin({ ...profile, last_login });
    return { success: true };
  };

  const logout = async () => { await supabase.auth.signOut(); setAdmin(null); };
  return <AuthContext.Provider value={{ admin, loading, login, logout, updateAdminState: setAdmin }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
