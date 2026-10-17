import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Draft } from 'immer';
import type { Edge, JobState, ModelInfo, Project, Section, StageScene, Timeline, CanvasNode } from '../../shared/types';
import { DEFAULT_MODELS } from '../../shared/actions';

export type View = 'canvas' | 'story' | 'stage' | 'editor';

interface Snapshot {
  nodes: Record<string, CanvasNode>;
  edges: Edge[];
  sections: Record<string, Section>;
  timelines: Record<string, Timeline>;
  stage: { scenes: Record<string, StageScene>; activeSceneId?: string };
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface ProjectState {
  project: Project | null;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  /** bumps on every mutation; autosave watches it */
  revision: number;
  selection: string[];
  selectedSection: string | null;
  selectedEdge: string | null;
  viewport: Viewport;
  tool: 'select' | 'hand';
  past: Snapshot[];
  future: Snapshot[];
  models: ModelInfo[];
  jobs: Record<string, JobState>;
  /** "pick a node on the canvas to connect into <nodeId>.<inputId>" */
  pick: { nodeId: string; inputId: string } | null;
  editingTextId: string | null;
  focusPrompt: { nodeId: string; nonce: number } | null;
  clipboard: { nodes: CanvasNode[]; edges: Edge[] } | null;
  chatAttachments: string[];

  setProject(p: Project | null): void;
  update(recipe: (draft: Draft<Project>) => void, opts?: { record?: boolean }): void;
  snapshot(): Snapshot | null;
  pushSnapshot(s: Snapshot): void;
  undo(): void;
  redo(): void;
  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  selectSection(id: string | null): void;
  selectEdge(id: string | null): void;
  clearSelection(): void;
  setViewport(v: Partial<Viewport>): void;
  setTool(t: 'select' | 'hand'): void;
  setModels(m: ModelInfo[]): void;
  upsertJob(j: JobState): void;
  setPick(p: ProjectState['pick']): void;
  setEditingText(id: string | null): void;
  requestPromptFocus(nodeId: string): void;
  setClipboard(c: ProjectState['clipboard']): void;
  setChatAttachments(ids: string[]): void;
  setSaveState(s: ProjectState['saveState']): void;
}

const HISTORY_LIMIT = 120;

function snap(p: Project): Snapshot {
  return { nodes: p.nodes, edges: p.edges, sections: p.sections, timelines: p.timelines, stage: p.stage };
}

export const useProject = create<ProjectState>()(
  immer((set, get) => ({
    project: null,
    saveState: 'idle',
    revision: 0,
    selection: [],
    selectedSection: null,
    selectedEdge: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    tool: 'select',
    past: [],
    future: [],
    models: DEFAULT_MODELS,
    jobs: {},
    pick: null,
    editingTextId: null,
    focusPrompt: null,
    clipboard: null,
    chatAttachments: [],

    setProject: (p) =>
      set((s) => {
        s.project = p as Draft<Project> | null;
        s.past = [];
        s.future = [];
        s.selection = [];
        s.selectedSection = null;
        s.selectedEdge = null;
        s.revision = 0;
        s.saveState = 'idle';
        s.jobs = {};
      }),

    update: (recipe, opts) => {
      const before = get().project;
      if (!before) return;
      const record = opts?.record ?? true;
      set((s) => {
        if (!s.project) return;
        if (record) {
          s.past.push(snap(before) as Draft<Snapshot>);
          if (s.past.length > HISTORY_LIMIT) s.past.shift();
          s.future = [];
        }
        recipe(s.project);
        s.revision++;
      });
    },

    snapshot: () => {
      const p = get().project;
      return p ? snap(p) : null;
    },

    pushSnapshot: (sn) =>
      set((s) => {
        s.past.push(sn as Draft<Snapshot>);
        if (s.past.length > HISTORY_LIMIT) s.past.shift();
        s.future = [];
      }),

    undo: () =>
      set((s) => {
        const prev = s.past.pop();
        if (!prev || !s.project) return;
        s.future.push(snap(s.project as Project) as Draft<Snapshot>);
        Object.assign(s.project, prev);
        s.selection = s.selection.filter((id) => id in prev.nodes);
        s.revision++;
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop();
        if (!next || !s.project) return;
        s.past.push(snap(s.project as Project) as Draft<Snapshot>);
        Object.assign(s.project, next);
        s.selection = s.selection.filter((id) => id in next.nodes);
        s.revision++;
      }),

    select: (ids, mode = 'replace') =>
      set((s) => {
        if (mode === 'replace') s.selection = [...ids];
        else if (mode === 'add') s.selection = [...new Set([...s.selection, ...ids])];
        else {
          const cur = new Set(s.selection);
          ids.forEach((id) => (cur.has(id) ? cur.delete(id) : cur.add(id)));
          s.selection = [...cur];
        }
        s.selectedEdge = null;
        if (ids.length) s.selectedSection = null;
      }),

    selectSection: (id) =>
      set((s) => {
        s.selectedSection = id;
        if (id) {
          s.selection = [];
          s.selectedEdge = null;
        }
      }),

    selectEdge: (id) =>
      set((s) => {
        s.selectedEdge = id;
        if (id) {
          s.selection = [];
          s.selectedSection = null;
        }
      }),

    clearSelection: () =>
      set((s) => {
        s.selection = [];
        s.selectedSection = null;
        s.selectedEdge = null;
        s.editingTextId = null;
      }),

    setViewport: (v) =>
      set((s) => {
        Object.assign(s.viewport, v);
      }),

    setTool: (t) =>
      set((s) => {
        s.tool = t;
      }),

    setModels: (m) =>
      set((s) => {
        s.models = m;
      }),

    upsertJob: (j) =>
      set((s) => {
        s.jobs[j.id] = j as Draft<JobState>;
      }),

    setPick: (p) =>
      set((s) => {
        s.pick = p;
      }),

    setEditingText: (id) =>
      set((s) => {
        s.editingTextId = id;
      }),

    requestPromptFocus: (nodeId) =>
      set((s) => {
        s.focusPrompt = { nodeId, nonce: (s.focusPrompt?.nonce ?? 0) + 1 };
      }),

    setClipboard: (c) =>
      set((s) => {
        s.clipboard = c as Draft<ProjectState['clipboard']>;
      }),

    setChatAttachments: (ids) =>
      set((s) => {
        s.chatAttachments = ids;
      }),

    setSaveState: (st) =>
      set((s) => {
        s.saveState = st;
      }),
  })),
);

export const getProject = () => useProject.getState().project;
