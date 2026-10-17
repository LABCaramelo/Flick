import { PROJECT_VERSION, type CanvasNode, type MediaNode, type Project, type Size, type Timeline } from './types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function createTimeline(name = 'Linha do tempo'): Timeline {
  const id = uid();
  const main = uid();
  const audio = uid();
  return {
    id,
    name,
    magnetEnabled: true,
    tracks: [
      { type: 'main', id: main, name: 'Principal', visible: true, volume: 1, muted: false },
      { type: 'audio', id: audio, name: 'Áudio', visible: true, volume: 1, muted: false },
    ],
    clips: {},
  };
}

export function createEmptyProject(name = 'Sem título', projectId = uid()): Project {
  const now = new Date().toISOString();
  const timeline = createTimeline();
  return {
    version: PROJECT_VERSION,
    projectId,
    name,
    createdAt: now,
    lastSaved: now,
    nodes: {},
    edges: [],
    sections: {},
    timelines: { [timeline.id]: timeline },
    activeTimelineId: timeline.id,
    stage: { scenes: {} },
    story: { memory: '', doc: null },
    customStyles: [],
    projectSettings: { aspectRatio: '16:9', styleId: null, styleLock: false },
  };
}

/** Bring older/partial project files up to the current shape. */
export function normalizeProject(p: Partial<Project> & { projectId: string }): Project {
  const base = createEmptyProject(p.name ?? 'Sem título', p.projectId);
  const merged: Project = { ...base, ...p } as Project;
  merged.nodes ??= {};
  merged.edges ??= [];
  merged.sections ??= {};
  if (!merged.timelines || !Object.keys(merged.timelines).length) {
    merged.timelines = base.timelines;
    merged.activeTimelineId = base.activeTimelineId;
  }
  if (!merged.timelines[merged.activeTimelineId]) merged.activeTimelineId = Object.keys(merged.timelines)[0];
  merged.stage ??= { scenes: {} };
  merged.story ??= { memory: '', doc: null };
  merged.customStyles ??= [];
  merged.projectSettings = { ...base.projectSettings, ...(merged.projectSettings ?? {}) };
  merged.version = PROJECT_VERSION;
  return merged;
}

export const DEFAULT_MEDIA_WIDTH = 360;

export function aspectToSize(aspect: string, width = DEFAULT_MEDIA_WIDTH): Size {
  const [w, h] = aspect.split(':').map(Number);
  if (!w || !h) return { width, height: width };
  return { width, height: Math.round((width * h) / w) };
}

export function mediaNodeSize(node: MediaNode, fallbackAspect = '16:9'): Size {
  const width = node.data.displayWidth ?? DEFAULT_MEDIA_WIDTH;
  if (node.type === 'audio') return { width, height: 120 };
  const { width: w, height: h } = node.data;
  if (w && h) return { width, height: Math.round((width * h) / w) };
  const ar = (node.data.generationSettings?.inputs?.aspect_ratio as string) || fallbackAspect;
  return aspectToSize(ar, width);
}

export function nodeSize(node: CanvasNode, fallbackAspect = '16:9'): Size {
  if (node.type === 'text' || node.type === 'richtext') return node.data.dimensions;
  if (node.type === 'stage_scene') return { width: 360, height: 220 };
  return mediaNodeSize(node as MediaNode, fallbackAspect);
}

export function nodeTitle(node: CanvasNode): string {
  const d = node.data as { user_input_title?: string; auto_generated_title?: string };
  if (d.user_input_title) return d.user_input_title;
  if (d.auto_generated_title) return d.auto_generated_title;
  if (node.type === 'text') return firstLine((node.data as { content: string }).content) || 'Nota';
  if (node.type === 'image') return 'Imagem';
  if (node.type === 'video') return 'Vídeo';
  if (node.type === 'audio') return 'Áudio';
  return node.label ?? 'Nó';
}

export function firstLine(s: string): string {
  return (s ?? '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 60) ?? '';
}

export function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const words = clean.split(' ').slice(0, 6).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function timelineDuration(t: Timeline): number {
  return Object.values(t.clips).reduce((max, c) => Math.max(max, c.start + c.duration), 0);
}
