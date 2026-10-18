-- Written by the Supabase MCP on 2026-10-17 as migration "create_flick_tables".
-- Run it before the next migration, which drops the anon policies created here.

-- 1. flick_projects
CREATE TABLE IF NOT EXISTS public.flick_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Sem título',
    version INTEGER NOT NULL DEFAULT 6,
    thumbnail TEXT,
    nodes JSONB NOT NULL DEFAULT '{}'::jsonb,
    edges JSONB NOT NULL DEFAULT '[]'::jsonb,
    sections JSONB NOT NULL DEFAULT '{}'::jsonb,
    timelines JSONB NOT NULL DEFAULT '{}'::jsonb,
    active_timeline_id TEXT,
    stage JSONB NOT NULL DEFAULT '{"scenes": {}}'::jsonb,
    story JSONB NOT NULL DEFAULT '{"memory": "", "doc": null}'::jsonb,
    custom_styles JSONB NOT NULL DEFAULT '[]'::jsonb,
    project_settings JSONB NOT NULL DEFAULT '{"aspectRatio": "16:9", "styleId": null, "styleLock": false}'::jsonb,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_saved TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. flick_chat_threads
CREATE TABLE IF NOT EXISTS public.flick_chat_threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES public.flick_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Novo chat',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    openai_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. flick_jobs
CREATE TABLE IF NOT EXISTS public.flick_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES public.flick_projects(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'generate',
    action_type TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT,
    request JSONB,
    created_nodes JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. flick_media
CREATE TABLE IF NOT EXISTS public.flick_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT REFERENCES public.flick_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    url TEXT NOT NULL,
    mime_type TEXT,
    kind TEXT,
    size_bytes BIGINT,
    width INTEGER,
    height INTEGER,
    duration NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. flick_settings
CREATE TABLE IF NOT EXISTS public.flick_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_flick_projects_last_saved ON public.flick_projects(last_saved DESC);
CREATE INDEX IF NOT EXISTS idx_flick_projects_user_id ON public.flick_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_flick_chat_threads_project_id ON public.flick_chat_threads(project_id);
CREATE INDEX IF NOT EXISTS idx_flick_jobs_project_id ON public.flick_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_flick_jobs_status ON public.flick_jobs(status);
CREATE INDEX IF NOT EXISTS idx_flick_media_project_id ON public.flick_media(project_id);

-- Enable RLS
ALTER TABLE public.flick_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_settings ENABLE ROW LEVEL SECURITY;

-- Policies for flick_projects
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_projects' AND policyname = 'flick_projects_auth_manage') THEN
    CREATE POLICY flick_projects_auth_manage ON public.flick_projects FOR ALL TO authenticated USING (user_id IS NULL OR user_id = auth.uid()) WITH CHECK (user_id IS NULL OR user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_projects' AND policyname = 'flick_projects_anon_all') THEN
    CREATE POLICY flick_projects_anon_all ON public.flick_projects FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Policies for flick_chat_threads
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_chat_threads' AND policyname = 'flick_chat_threads_auth_manage') THEN
    CREATE POLICY flick_chat_threads_auth_manage ON public.flick_chat_threads FOR ALL TO authenticated USING (user_id IS NULL OR user_id = auth.uid()) WITH CHECK (user_id IS NULL OR user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_chat_threads' AND policyname = 'flick_chat_threads_anon_all') THEN
    CREATE POLICY flick_chat_threads_anon_all ON public.flick_chat_threads FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Policies for flick_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_jobs' AND policyname = 'flick_jobs_all') THEN
    CREATE POLICY flick_jobs_all ON public.flick_jobs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Policies for flick_media
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_media' AND policyname = 'flick_media_all') THEN
    CREATE POLICY flick_media_all ON public.flick_media FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Policies for flick_settings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flick_settings' AND policyname = 'flick_settings_all') THEN
    CREATE POLICY flick_settings_all ON public.flick_settings FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('flick-media', 'flick-media', true)
ON CONFLICT (id) DO NOTHING;
