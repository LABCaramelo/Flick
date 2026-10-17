import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { JobState } from '../../shared/types';
import { api } from '../lib/api';
import { applyJob } from '../lib/generation';
import { useProject, type View } from '../store/project';
import { TopBar } from '../components/TopBar';
import { Canvas } from '../components/canvas/Canvas';
import { ChatPanel } from '../components/chat/ChatPanel';
import { FullscreenViewer } from '../components/canvas/FullscreenViewer';

const StoryView = lazy(() => import('../components/story/StoryView').then((m) => ({ default: m.StoryView })));
const StageView = lazy(() => import('../components/stage/StageView').then((m) => ({ default: m.StageView })));
const EditorView = lazy(() => import('../components/editor/EditorView').then((m) => ({ default: m.EditorView })));

const VIEWS: View[] = ['canvas', 'story', 'stage', 'editor'];

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const view = (VIEWS.includes(params.get('view') as View) ? params.get('view') : 'canvas') as View;
  const loaded = useProject((s) => s.project?.projectId === projectId);
  const [error, setError] = useState<string | null>(null);

  // ---------- load ----------
  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .getProject(projectId)
      .then((p) => {
        if (!alive) return;
        useProject.getState().setProject(p);
        document.title = `${p.name} — Claquete`;
      })
      .catch((e) => alive && setError(String(e.message)));
    return () => {
      alive = false;
      useProject.getState().setProject(null);
      document.title = 'Claquete — cinema com IA';
    };
  }, [projectId]);

  // ---------- autosave ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const save = async () => {
      const st = useProject.getState();
      if (!st.project) return;
      if (saving.current) {
        pending.current = true;
        return;
      }
      saving.current = true;
      st.setSaveState('saving');
      try {
        await api.saveProject(st.project);
        useProject.getState().setSaveState('saved');
      } catch {
        useProject.getState().setSaveState('error');
      } finally {
        saving.current = false;
        if (pending.current) {
          pending.current = false;
          save();
        }
      }
    };
    const unsub = useProject.subscribe((s, prev) => {
      if (s.revision !== prev.revision && s.project) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = undefined;
          save();
        }, 700);
      }
    });
    // best effort: a pending debounced save is sent with keepalive (body limit ~64KB)
    const flush = () => {
      const p = useProject.getState().project;
      if (!p || !saveTimer.current) return;
      const body = JSON.stringify(p);
      if (body.length < 60_000) fetch(`/api/projects/${p.projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', flush);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        save();
      }
    };
  }, [loaded]);

  // ---------- server events ----------
  useEffect(() => {
    if (!loaded) return;
    const es = new EventSource(`/api/events?projectId=${projectId}`);
    es.addEventListener('job', (e) => applyJob(JSON.parse((e as MessageEvent).data) as JobState));
    // reconcile after (re)connect so no finished job is missed
    es.addEventListener('hello', () => {
      api
        .listJobs(projectId)
        .then((jobs) => jobs.forEach(applyJob))
        .catch(() => undefined);
    });
    return () => es.close();
  }, [loaded, projectId]);

  if (error)
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div>
          <p>Não foi possível abrir o projeto: {error}</p>
          <button className="btn" onClick={() => nav('/projects')}>
            Voltar aos projetos
          </button>
        </div>
      </div>
    );

  if (!loaded)
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="spinner" />
      </div>
    );

  return (
    <div className="app-shell">
      <TopBar view={view} />
      <div className="workspace">
        <div className="main-view">
          {view === 'canvas' && <Canvas />}
          <Suspense fallback={<div className="empty-state" style={{ height: '100%' }}><span className="spinner" /></div>}>
            {view === 'story' && <StoryView />}
            {view === 'stage' && <StageView />}
            {view === 'editor' && <EditorView />}
          </Suspense>
        </div>
        <ChatPanel view={view} />
      </div>
      <FullscreenViewer />
    </div>
  );
}
