import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');

// .env.local (secrets, git-ignored) wins over .env
dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), quiet: true });
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT_DIR, 'data'));
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

// own variable: hosts often export PORT for the web dev server
export const PORT = Number(process.env.API_PORT ?? 8787);
export const LOCAL_BASE_URL = `http://localhost:${PORT}`;
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || undefined;

export const HIGGSFIELD_MCP_URL = process.env.HIGGSFIELD_MCP_URL || 'https://mcp.higgsfield.ai/mcp';
export const HIGGSFIELD_MCP_TOKEN = process.env.HIGGSFIELD_MCP_TOKEN || '';

/** Higgsfield API credentials, "key-id:key-secret" (never logged) */
export const HF_CREDENTIALS = (process.env.HF_CREDENTIALS || process.env.HF_KEY || '').trim();

/** Supabase database. Server-only: the service_role key bypasses RLS and must never reach the browser. */
export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const GENERATION_PROVIDER =(process.env.GENERATION_PROVIDER || (HF_CREDENTIALS ? 'higgsfield-api' : 'higgsfield')).toLowerCase();

export const IS_PROD = process.env.NODE_ENV === 'production';
