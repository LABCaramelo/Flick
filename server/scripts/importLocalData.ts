/**
 * Copies projects, chats and settings from data/ into Supabase.
 * Run once after setting SUPABASE_SERVICE_ROLE_KEY: npm run db:import
 * Safe to repeat (upserts). Media files stay in data/media.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, PROJECTS_DIR } from '../config';
import { STORAGE_BACKEND, checkStorage, importProject, readJson, writeChat, writeSettings, type ChatFile } from '../storage';
import type { Project } from '../../shared/types';

if (STORAGE_BACKEND !== 'supabase') {
  console.error('Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local antes de importar.');
  process.exit(1);
}
await checkStorage();

const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
let projects = 0;
let threads = 0;
for (const e of entries) {
  if (!e.isDirectory()) continue;
  const p = await readJson<Project>(path.join(PROJECTS_DIR, e.name, 'project.json'));
  if (!p) continue;
  await importProject(p);
  projects++;
  const chat = await readJson<ChatFile>(path.join(PROJECTS_DIR, e.name, 'chat.json'));
  if (chat && Object.keys(chat.threads).length) {
    await writeChat(p.projectId, chat);
    threads += Object.keys(chat.threads).length;
  }
  console.log(`✓ ${p.name} (${p.projectId})`);
}

const settings = await readJson(path.join(DATA_DIR, 'settings.json'));
if (settings) await writeSettings(settings);

console.log(`Importados: ${projects} projeto(s), ${threads} conversa(s)${settings ? ', configurações' : ''}.`);
