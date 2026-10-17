import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR, DATA_DIR, MEDIA_DIR } from './config';
import { createEmptyProject, normalizeProject } from '../shared/project';
import type { ChatThread, Project, ProjectSummary } from '../shared/types';

const SAFE_ID = /^[a-zA-Z0-9-]{6,64}$/;

export function assertId(id: string): string {
  if (!SAFE_ID.test(id)) throw Object.assign(new Error('id inválido'), { status: 400 });
  return id;
}

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

const projectDir = (id: string) => path.join(PROJECTS_DIR, assertId(id));
const projectFile = (id: string) => path.join(projectDir(id), 'project.json');
const chatFile = (id: string) => path.join(projectDir(id), 'chat.json');

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

// Serialize writes per file and write atomically so a crash never leaves half a file.
const writeChains = new Map<string, Promise<void>>();

export function writeJson(file: string, value: unknown): Promise<void> {
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value));
      await fs.rename(tmp, file);
    });
  writeChains.set(file, next);
  return next;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDirs();
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
}

export async function getProject(id: string): Promise<Project | undefined> {
  const p = await readJson<Project>(projectFile(id));
  return p ? normalizeProject(p) : undefined;
}

export async function createProject(name?: string): Promise<Project> {
  const p = createEmptyProject(name || 'Sem título');
  await writeJson(projectFile(p.projectId), p);
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
  await writeJson(projectFile(project.projectId), project);
  return project;
}

/** Read-modify-write used by background jobs (e.g. a finished generation). */
export async function patchProject(id: string, fn: (p: Project) => void): Promise<Project | undefined> {
  const p = await getProject(id);
  if (!p) return undefined;
  fn(p);
  return saveProject(p);
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true });
  await fs.rm(path.join(MEDIA_DIR, assertId(id)), { recursive: true, force: true });
}

export async function duplicateProject(id: string): Promise<Project | undefined> {
  const p = await getProject(id);
  if (!p) return undefined;
  const copy = createEmptyProject(`${p.name} (cópia)`);
  const dup: Project = { ...structuredClone(p), projectId: copy.projectId, name: copy.name, createdAt: copy.createdAt };
  await writeJson(projectFile(dup.projectId), dup);
  return dup;
}

// ---------- chat threads (server-owned) ----------

interface ChatFile {
  threads: Record<string, ChatThread & { openai: unknown[] }>;
}

export async function readChat(projectId: string): Promise<ChatFile> {
  return (await readJson<ChatFile>(chatFile(projectId))) ?? { threads: {} };
}

export async function writeChat(projectId: string, chat: ChatFile): Promise<void> {
  await writeJson(chatFile(projectId), chat);
}

export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
