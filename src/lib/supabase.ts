import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://fzhzpzxsttflgtassyex.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6aHpwenhzdHRmbGd0YXNzeWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTU2NTIsImV4cCI6MjEwNDkzMTY1Mn0.rWO90rI-O8XVOWAlvuylkFWMNpjkocC0HRHBNbmrJj4";

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseUrl = rawUrl && rawUrl.includes("fzhzpzxsttflgtassyex") ? rawUrl : DEFAULT_SUPABASE_URL;

const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
const supabaseAnonKey = rawKey && rawKey.startsWith("eyJ") ? rawKey : DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
