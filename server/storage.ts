import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PROJECTS_DIR, DATA_DIR, MEDIA_DIR, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './config';
import { createEmptyProject, normalizeProject } from '../shared/project';
import type { ChatThread, Project, ProjectSummary } from '../shared/types';

const SAFE_ID = /^[a-zA-Z0-9-]{6,64}$/;

export function assertId(id: string): string {
  if (!SAFE_ID.test(id)) throw Object.assign(new Error('id inválido'), { status: 400 });
  return id;
}

export interface ChatFile {
  threads: Record<string, ChatThread & { openai: unknown[] }>;
}

// ---------- JSON files (also used for provider auth state, which stays per machine) ----------

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

// Serialize writes per key so a slow write never lands after a newer one.
const writeChains = new Map<string, Promise<void>>();

function serialized(key: string, fn: () => Promise<void>): Promise<void> {
  const next = (writeChains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  writeChains.set(key, next);
  return next;
}

/** Atomic write, so a crash never leaves half a file. */
export function writeJson(file: string, value: unknown): Promise<void> {
  return serialized(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, file);
  });
}

// ---------- backends ----------

interface Store {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project | undefined>;
  put(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
  readChat(projectId: string): Promise<ChatFile>;
  writeChat(projectId: string, chat: ChatFile): Promise<void>;
  readSettings<T>(): Promise<T | undefined>;
  writeSettings(value: unknown): Promise<void>;
}

const projectDir = (id: string) => path.join(PROJECTS_DIR, assertId(id));
const projectFile = (id: string) => path.join(projectDir(id), 'project.json');
const chatFile = (id: string) => path.join(projectDir(id), 'chat.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const fileStore: Store = {
  async list() {
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const out: ProjectSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !SAFE_ID.test(e.name)) continue;
      const p = await readJson<Project>(projectFile(e.name));
      if (!p) continue;
      out.push({
        projectId: p.projectId,
        name: p.name,
        createdAt: p.createdAt,
        lastSaved: p.lastSaved,
        thumbnail: p.thumbnail,
        nodeCount: Object.keys(p.nodes ?? {}).length,
      });
    }
    return out.sort((a, b) => b.lastSaved.localeCompare(a.lastSaved));
  },
  get: (id) => readJson<Project>(projectFile(id)),
  put: (p) => writeJson(projectFile(p.projectId), p),
  remove: (id) => fs.rm(projectDir(id), { recursive: true, force: true }),
  async readChat(projectId) {
    return (await readJson<ChatFile>(chatFile(projectId))) ?? { threads: {} };
  },
  writeChat: (projectId, chat) => writeJson(chatFile(projectId), chat),
  readSettings: <T>() => readJson<T>(SETTINGS_FILE),
  writeSettings: (value) => writeJson(SETTINGS_FILE, value),
};

/**
 * Supabase tables from supabase/migrations. Only this server reaches them, with
 * the service_role key; RLS has no policies, so the public keys get nothing.
 */
function supabaseStore(db: SupabaseClient): Store {
  const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
    if (res.error) throw Object.assign(new Error(`Supabase (${what}): ${res.error.message}`), { status: 502 });
    return res.data;
  };
  const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : new Date().toISOString());

  const toRow = (p: Project) => ({
    id: p.projectId,
    name: p.name,
    version: p.version,
    thumbnail: p.thumbnail ?? null,
    nodes: p.nodes,
    edges: p.edges,
    sections: p.sections,
    timelines: p.timelines,
    active_timeline_id: p.activeTimelineId,
    stage: p.stage,
    story: p.story,
    custom_styles: p.customStyles,
    project_settings: p.projectSettings,
    node_count: Object.keys(p.nodes ?? {}).length,
    created_at: p.createdAt,
    last_saved: p.lastSaved,
    updated_at: new Date().toISOString(),
  });

  type ProjectRow = ReturnType<typeof toRow>;
  const fromRow = (r: ProjectRow): Project => ({
    version: r.version,
    projectId: r.id,
    name: r.name,
    createdAt: iso(r.created_at),
    lastSaved: iso(r.last_saved),
    thumbnail: r.thumbnail ?? undefined,
    nodes: r.nodes,
    edges: r.edges,
    sections: r.sections,
    timelines: r.timelines,
    activeTimelineId: r.active_timeline_id,
    stage: r.stage,
    story: r.story,
    customStyles: r.custom_styles,
    projectSettings: r.project_settings,
  });

  // updatedAt of each thread as last read or written: the agent rewrites the
  // whole chat each turn, but only threads whose updatedAt moved need sending.
  const seenThreads = new Map<string, string>();

  return {
    async list() {
      const rows = must(
        await db.from('flick_projects').select('id, name, created_at, last_saved, thumbnail, node_count').order('last_saved', { ascending: false }),
        'listar projetos',
      );
      return (rows ?? []).map((r) => ({
        projectId: r.id,
        name: r.name,
        createdAt: iso(r.created_at),
        lastSaved: iso(r.last_saved),
        thumbnail: r.thumbnail ?? undefined,
        nodeCount: r.node_count,
      }));
    },
    async get(id) {
      const row = must(await db.from('flick_projects').select('*').eq('id', assertId(id)).maybeSingle(), 'ler projeto');
      return row ? fromRow(row as ProjectRow) : undefined;
    },
    put: (p) =>
      serialized(`project:${p.projectId}`, async () => {
        must(await db.from('flick_projects').upsert(toRow(p)), 'salvar projeto');
      }),
    async remove(id) {
      // chat threads, jobs and media rows go with it (ON DELETE CASCADE)
      must(await db.from('flick_projects').delete().eq('id', assertId(id)), 'apagar projeto');
    },
    async readChat(projectId) {
      const rows = must(
        await db.from('flick_chat_threads').select('id, title, messages, openai_history, updated_at').eq('project_id', assertId(projectId)),
        'ler chat',
      );
      const threads: ChatFile['threads'] = {};
      for (const r of rows ?? []) {
        const updatedAt = iso(r.updated_at);
        threads[r.id] = { id: r.id, title: r.title, updatedAt, messages: r.messages, openai: r.openai_history };
        seenThreads.set(r.id, updatedAt);
      }
      return { threads };
    },
    writeChat: (projectId, chat) =>
      serialized(`chat:${projectId}`, async () => {
        const threads = Object.values(chat.threads);
        const changed = threads.filter((t) => seenThreads.get(t.id) !== t.updatedAt);
        if (changed.length) {
          const rows = changed.map((t) => ({
            id: t.id,
            project_id: assertId(projectId),
            title: t.title,
            messages: t.messages,
            openai_history: t.openai,
            updated_at: t.updatedAt,
          }));
          must(await db.from('flick_chat_threads').upsert(rows), 'salvar chat');
          for (const t of changed) seenThreads.set(t.id, t.updatedAt);
        }
        // threads removed from the chat object were deleted by the user
        let del = db.from('flick_chat_threads').delete().eq('project_id', assertId(projectId));
        if (threads.length) del = del.not('id', 'in', `(${threads.map((t) => `"${t.id}"`).join(',')})`);
        must(await del, 'apagar conversas');
      }),
    async readSettings<T>() {
      const row = must(await db.from('flick_settings').select('value').eq('key', 'app').maybeSingle(), 'ler configurações');
      return (row?.value ?? undefined) as T | undefined;
    },
    writeSettings: (value) =>
      serialized('settings', async () => {
        must(await db.from('flick_settings').upsert({ key: 'app', value, updated_at: new Date().toISOString() }), 'salvar configurações');
      }),
  };
}

const db =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : undefined;

const store: Store = db ? supabaseStore(db) : fileStore;

export const STORAGE_BACKEND: 'supabase' | 'local' = db ? 'supabase' : 'local';

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

/** Fail loudly at startup if the database is unreachable or the migrations are missing. */
export async function checkStorage(): Promise<void> {
  if (!db) return;
  const { error } = await db.from('flick_projects').select('id, node_count').limit(1);
  if (error) {
    throw new Error(`Supabase indisponível (${error.message}). Confira SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e se as migrações de supabase/migrations foram aplicadas.`);
  }
}

// ---------- projects ----------

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDirs();
  return store.list();
}

export async function getProject(id: string): Promise<Project | undefined> {
  const p = await store.get(id);
  return p ? normalizeProject(p) : undefined;
}

export async function createProject(name?: string): Promise<Project> {
  const p = createEmptyProject(name || 'Sem título');
  await store.put(p);
  return p;
}

export function thumbnailOf(p: Project): string | undefined {
  const media = Object.values(p.nodes).filter((n) => (n.type === 'image' || n.type === 'video') && (n.data as { url?: string }).url);
  const img = media.find((n) => n.type === 'image') ?? media[0];
  return (img?.data as { url?: string } | undefined)?.url;
}

export async function saveProject(p: Project): Promise<Project> {
  const project = normalizeProject(p);
  project.lastSaved = new Date().toISOString();
  project.thumbnail = thumbnailOf(project);
  await store.put(project);
  return project;
}

/** Store a project as-is (keeps its lastSaved), for imports. */
export async function importProject(p: Project): Promise<void> {
  await store.put(normalizeProject(p));
}

/** Read-modify-write used by background jobs (e.g. a finished generation). */
export async function patchProject(id: string, fn: (p: Project) => void): Promise<Project | undefined> {
  const p = await getProject(id);
  if (!p) return undefined;
  fn(p);
  return saveProject(p);
}

export async function deleteProject(id: string): Promise<void> {
  await store.remove(id);
  // media files stay on disk in both modes
  await fs.rm(path.join(MEDIA_DIR, assertId(id)), { recursive: true, force: true });
}

export async function duplicateProject(id: string): Promise<Project | undefined> {
  const p = await getProject(id);
  if (!p) return undefined;
  const copy = createEmptyProject(`${p.name} (cópia)`);
  const dup: Project = { ...structuredClone(p), projectId: copy.projectId, name: copy.name, createdAt: copy.createdAt };
  await store.put(dup);
  return dup;
}

// ---------- chat threads (server-owned) ----------

export function readChat(projectId: string): Promise<ChatFile> {
  return store.readChat(projectId);
}

export function writeChat(projectId: string, chat: ChatFile): Promise<void> {
  return store.writeChat(projectId, chat);
}

// ---------- app settings ----------

export function readSettings<T>(): Promise<T | undefined> {
  return store.readSettings<T>();
}

export function writeSettings(value: unknown): Promise<void> {
  return store.writeSettings(value);
}
