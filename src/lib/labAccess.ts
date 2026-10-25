import { supabase } from './supabase';

let activeUser: string | null = null;

/** The gate sets this only after Auth and has_tool both authorize the person. */
export function activateLabUser(userId: string | null): void { activeUser = userId; }

export async function labCredentials(): Promise<{ userId: string; token: string }> {
  const expected = activeUser;
  if (!expected) throw new Error('Entre no LAB para usar o Claquete.');
  const { data, error } = await supabase.auth.getSession();
  const candidate = data.session;
  if (error || !candidate?.access_token || candidate.user.id !== expected) throw new Error('Sua sessão mudou. Entre novamente.');
  const { data: verified, error: authError } = await supabase.auth.getUser(candidate.access_token);
  if (authError || !verified.user || verified.user.is_anonymous || verified.user.id !== expected || activeUser !== expected) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  return { userId: expected, token: candidate.access_token };
}

export async function labAuthorization(): Promise<{ Authorization: string }> {
  const { token } = await labCredentials();
  return { Authorization: `Bearer ${token}` };
}
