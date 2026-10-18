-- Flick is server-owned: only the API server touches these tables, using the
-- service_role key (which bypasses RLS). The browser never talks to Supabase.
-- So: keep RLS on, drop every policy, and revoke the anon/authenticated grants.
-- Without a policy, anon and authenticated get nothing even if a grant returns.

DROP POLICY IF EXISTS flick_projects_auth_manage ON public.flick_projects;
DROP POLICY IF EXISTS flick_projects_anon_all ON public.flick_projects;
DROP POLICY IF EXISTS flick_chat_threads_auth_manage ON public.flick_chat_threads;
DROP POLICY IF EXISTS flick_chat_threads_anon_all ON public.flick_chat_threads;
DROP POLICY IF EXISTS flick_jobs_all ON public.flick_jobs;
DROP POLICY IF EXISTS flick_media_all ON public.flick_media;
DROP POLICY IF EXISTS flick_settings_all ON public.flick_settings;

ALTER TABLE public.flick_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flick_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.flick_projects, public.flick_chat_threads, public.flick_jobs,
  public.flick_media, public.flick_settings FROM anon, authenticated;

-- Project list shows a node count without downloading every canvas.
ALTER TABLE public.flick_projects ADD COLUMN IF NOT EXISTS node_count INTEGER NOT NULL DEFAULT 0;

-- timezone('utc', now()) yields a timestamp WITHOUT time zone that is cast back
-- through the session time zone; now() is the correct timestamptz default.
ALTER TABLE public.flick_projects
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN last_saved SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.flick_chat_threads
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.flick_jobs
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.flick_media ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.flick_settings ALTER COLUMN updated_at SET DEFAULT now();
