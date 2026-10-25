import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_URL = 'https://fzhzpzxsttflgtassyex.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6aHpwenhzdHRmbGd0YXNzeWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTU2NTIsImV4cCI6MjEwNDkzMTY1Mn0.rWO90rI-O8XVOWAlvuylkFWMNpjkocC0HRHBNbmrJj4';
export const MEDIA_COOKIE = 'claquete_media_session';
const PROJECT_ID = /^[a-zA-Z0-9-]{6,64}$/;

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface AccessContext {
  userId: string;
  token: string;
  db: SupabaseClient;
  expiresAt: number;
  projects: Set<string>;
}

export const accessScope = new AsyncLocalStorage<AccessContext>();
export function currentAccess(): AccessContext {
  const value = accessScope.getStore();
  if (!value) throw new AccessError(401, 'Entre no LAB para continuar.');
  return value;
}

/** Validates with Auth and checks current acquisition. Decoded/local user claims never authorize. */
export async function verifyAccess(authorization: string | undefined): Promise<AccessContext> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new AccessError(401, 'Entre no LAB para continuar.');
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_URL).replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let auth: Response;
  try {
    auth = await fetch(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10_000) });
  } catch { throw new AccessError(503, 'Não foi possível verificar sua sessão.'); }
  if (auth.status === 401 || auth.status === 403) throw new AccessError(401, 'Sua sessão expirou. Entre novamente.');
  if (!auth.ok) throw new AccessError(503, 'Não foi possível verificar sua sessão.');
  const user = await auth.json().catch(() => null);
  if (!user || typeof user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) || user.is_anonymous === true) {
    throw new AccessError(401, 'Sessão inválida. Entre novamente.');
  }
  let owns: Response;
  try {
    owns = await fetch(`${url}/rest/v1/rpc/has_tool`, {
      method: 'POST', headers, body: JSON.stringify({ p_slug: 'claquete' }), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new AccessError(503, 'Não foi possível conferir seu acesso.'); }
  if (owns.status === 401) throw new AccessError(401, 'Sua sessão expirou. Entre novamente.');
  if (!owns.ok) throw new AccessError(503, 'Não foi possível conferir seu acesso.');
  const ownership = await owns.json().catch(() => null);
  if (ownership === false) throw new AccessError(403, 'Adquira o Claquete na Loja do LAB.');
  if (ownership !== true) throw new AccessError(503, 'Não foi possível conferir seu acesso.');
  // Expiry is used only after remote validation, to bound streams/cookies already authorized.
  let expiresAt = 0;
  try { expiresAt = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp) * 1000; } catch {}
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new AccessError(401, 'Sua sessão expirou. Entre novamente.');
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { userId: user.id, token, db, expiresAt, projects: new Set() };
}

export async function requireAdmin(): Promise<void> {
  const { db } = currentAccess();
  let available = false;
  for (const name of ['is_lab_admin', 'is_admin']) {
    const { data, error } = await db.rpc(name);
    if (!error && (data === true || data === false)) available = true;
    if (!error && data === true) return;
  }
  if (!available) throw new AccessError(503, 'Não foi possível conferir o acesso de administrador.');
  throw new AccessError(403, 'Apenas administradores podem configurar os provedores do servidor.');
}

/** Explicit ownership check in addition to the caller's RLS context. */
export async function requireProject(projectId: string): Promise<void> {
  if (!PROJECT_ID.test(projectId)) throw new AccessError(400, 'Projeto inválido.');
  const { db, userId } = currentAccess();
  const { data, error } = await db.from('flick_projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw new AccessError(503, 'Não foi possível conferir o projeto.');
  if (!data) throw new AccessError(404, 'Projeto não encontrado.');
  currentAccess().projects.add(projectId);
}

export function mayReadProjectMedia(projectId: string): boolean {
  const access = accessScope.getStore();
  // Maintenance scripts keep their explicit machine access. Every HTTP request
  // has a context and can only resolve media belonging to projects checked there.
  return !access || access.projects.has(projectId);
}

export async function authorizeMediaReferences(value: unknown): Promise<void> {
  if (!accessScope.getStore()) return;
  const projects = new Set<string>();
  const visit = (entry: unknown) => {
    if (typeof entry === 'string') {
      const found = /^(?:\/media\/|https:\/\/media\.umcaracaramelo\.com\.br\/claquete\/)([a-zA-Z0-9-]{6,64})\//.exec(entry);
      if (found) projects.add(found[1]);
    } else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === 'object') Object.values(entry).forEach(visit);
  };
  visit(value);
  for (const projectId of projects) await requireProject(projectId);
}

/** Cookie is accepted for read-only media routes only. APIs always require the Bearer header. */
export function mediaAuthorization(cookie: string | undefined): string | undefined {
  const value = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${MEDIA_COOKIE}=`))?.slice(MEDIA_COOKIE.length + 1);
  if (!value || !/^[a-zA-Z0-9_.-]+$/.test(value)) return undefined;
  return `Bearer ${value}`;
}

export function mediaCookie(access: AccessContext, secure: boolean): string {
  const age = Math.max(0, Math.min(300, Math.floor((access.expiresAt - Date.now()) / 1000)));
  return `${MEDIA_COOKIE}=${access.token}; Path=/media; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
