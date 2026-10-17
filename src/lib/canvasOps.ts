import { ACTIONS, defaultModelId, pickInputFor } from '../../shared/actions';
import { DEFAULT_MEDIA_WIDTH, nodeSize, nodeTitle, uid } from '../../shared/project';
import type {
  ActionType,
  CanvasNode,
  Clip,
  Edge,
  MediaKind,
  MediaNode,
  NoteColor,
  Project,
  Section,
  TextNode,
  Vec2,
} from '../../shared/types';
import { getProject, useProject } from '../store/project';
import { api, type UploadedMedia } from './api';

const st = () => useProject.getState();

/** Default model for an action from the active provider catalog. */
export function defaultModelFor(action: ActionType): string {
  return defaultModelId(st().models, action);
}

export function rectOf(p: Project, n: CanvasNode) {
  const s = nodeSize(n, p.projectSettings.aspectRatio);
  return { x: n.position.x, y: n.position.y, w: s.width, h: s.height };
}

/** World coordinates of the visible canvas center. */
export function viewportCenter(): Vec2 {
  const { viewport } = st();
  const el = document.querySelector('.canvas-root') as HTMLElement | null;
  const w = el?.clientWidth ?? window.innerWidth;
  const h = el?.clientHeight ?? window.innerHeight;
  return { x: (w / 2 - viewport.x) / viewport.zoom, y: (h / 2 - viewport.y) / viewport.zoom };
}

function overlaps(p: Project, x: number, y: number, w: number, h: number, ignore?: Set<string>) {
  return Object.values(p.nodes).some((n) => {
    if (ignore?.has(n.id)) return false;
    const r = rectOf(p, n);
    return x < r.x + r.w + 24 && x + w + 24 > r.x && y < r.y + r.h + 40 && y + h + 40 > r.y;
  });
}

/** Nearest free spot scanning right then down from `near`. */
export function findFreeSpot(near: Vec2, w: number, h: number): Vec2 {
  const p = getProject();
  if (!p) return near;
  for (let ring = 0; ring < 30; ring++) {
    for (let i = 0; i <= ring; i++) {
      const cands = [
        { x: near.x + ring * (w + 40), y: near.y + i * (h + 60) },
        { x: near.x + i * (w + 40), y: near.y + ring * (h + 60) },
      ];
      for (const c of cands) if (!overlaps(p, c.x, c.y, w, h)) return c;
    }
  }
  return near;
}

export interface NewMediaOpts {
  actionType?: ActionType;
  prompt?: string;
  model?: string;
  title?: string;
  position?: Vec2;
  sectionId?: string | null;
  settings?: Record<string, unknown>;
  select?: boolean;
  focus?: boolean;
}

export function createMediaNode(kind: MediaKind, opts: NewMediaOpts = {}): string {
  const p = getProject();
  if (!p) return '';
  const actionType = opts.actionType ?? (kind === 'image' ? 'Image' : kind === 'video' ? 'ImageToVideo' : 'TextToDialog');
  const id = uid();
  const aspect = (opts.settings?.aspect_ratio as string) ?? p.projectSettings.aspectRatio;
  const [aw, ah] = aspect.split(':').map(Number);
  const h = kind === 'audio' ? 120 : Math.round((DEFAULT_MEDIA_WIDTH * (ah || 9)) / (aw || 16));
  const position = opts.position ?? findFreeSpot(viewportCenter(), DEFAULT_MEDIA_WIDTH, h);
  const node: MediaNode = {
    id,
    type: kind,
    position,
    sectionId: opts.sectionId ?? sectionAt(p, position.x + 10, position.y + 10)?.id ?? null,
    data: {
      status: 'idle',
      user_input_title: opts.title,
      generationSettings: {
        actionType,
        inputs: {
          model: opts.model || defaultModelFor(actionType),
          prompt: opts.prompt ?? '',
          ...(kind !== 'audio' ? { aspect_ratio: aspect } : {}),
          ...(opts.settings ?? {}),
        },
      },
    },
  };
  st().update((d) => {
    d.nodes[id] = node;
  });
  if (opts.select !== false) st().select([id]);
  if (opts.focus) st().requestPromptFocus(id);
  return id;
}

export function createTextNode(content = '', opts: { position?: Vec2; color?: NoteColor; title?: string; sectionId?: string | null; edit?: boolean } = {}): string {
  const p = getProject();
  if (!p) return '';
  const id = uid();
  const dims = { width: 300, height: Math.min(420, Math.max(160, 60 + content.split('\n').length * 20)) };
  const position = opts.position ?? findFreeSpot(viewportCenter(), dims.width, dims.height);
  const node: TextNode = {
    id,
    type: 'text',
    position,
    sectionId: opts.sectionId ?? sectionAt(p, position.x + 10, position.y + 10)?.id ?? null,
    data: { color: opts.color ?? 'yellow', content, dimensions: dims, user_input_title: opts.title },
  };
  st().update((d) => {
    d.nodes[id] = node;
  });
  st().select([id]);
  if (opts.edit) st().setEditingText(id);
  return id;
}

export function sectionAt(p: Project, x: number, y: number): Section | undefined {
  return Object.values(p.sections)
    .filter((s) => !s.collapsed && x >= s.position.x && x <= s.position.x + s.dimensions.width && y >= s.position.y && y <= s.position.y + s.dimensions.height)
    .sort((a, b) => a.dimensions.width * a.dimensions.height - b.dimensions.width * b.dimensions.height)[0];
}

export function boundsOf(p: Project, ids: string[]) {
  const rects = ids.map((id) => p.nodes[id]).filter(Boolean).map((n) => rectOf(p, n));
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((r) => r.x + r.w));
  const b = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: r - x, h: b - y };
}

export function createSection(label?: string, nodeIds: string[] = []): string {
  const p = getProject();
  if (!p) return '';
  const id = uid();
  const n = Object.keys(p.sections).length + 1;
  const name = label ?? `S${String(n).padStart(2, '0')} - Nova cena`;
  const b = boundsOf(p, nodeIds);
  const pad = 40;
  let section: Section;
  if (b) {
    section = { id, label: name, position: { x: b.x - pad, y: b.y - pad }, dimensions: { width: b.w + pad * 2, height: b.h + pad * 2 } };
  } else {
    const c = findFreeSpot(viewportCenter(), 900, 420);
    section = { id, label: name, position: c, dimensions: { width: 900, height: 420 } };
  }
  st().update((d) => {
    d.sections[id] = section;
    nodeIds.forEach((nid) => {
      if (d.nodes[nid]) d.nodes[nid].sectionId = id;
    });
  });
  st().selectSection(id);
  return id;
}

/** Re-evaluate which section each node belongs to (after drags). */
export function refreshMembership(ids: string[]) {
  st().update(
    (d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        const r = rectOf(d as Project, n as CanvasNode);
        n.sectionId = sectionAt(d as Project, r.x + r.w / 2, r.y + r.h / 2)?.id ?? null;
      }
    },
    { record: false },
  );
}

export function fitSectionToMembers(sectionId: string) {
  const p = getProject();
  if (!p) return;
  const members = Object.values(p.nodes).filter((n) => n.sectionId === sectionId).map((n) => n.id);
  const b = boundsOf(p, members);
  if (!b) return;
  const pad = 40;
  st().update((d) => {
    const s = d.sections[sectionId];
    s.position = { x: b.x - pad, y: b.y - pad };
    s.dimensions = { width: b.w + pad * 2, height: b.h + pad * 2 };
  });
}

export function deleteNodes(ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  st().update((d) => {
    ids.forEach((id) => delete d.nodes[id]);
    d.edges = d.edges.filter((e) => !set.has(e.source) && !set.has(e.target));
    for (const t of Object.values(d.timelines)) for (const c of Object.values(t.clips)) if (c.nodeId && set.has(c.nodeId)) delete t.clips[c.id];
  });
  st().clearSelection();
}

export function deleteSection(id: string, withMembers = false) {
  const p = getProject();
  if (!p) return;
  const members = Object.values(p.nodes).filter((n) => n.sectionId === id).map((n) => n.id);
  st().update((d) => {
    delete d.sections[id];
    for (const m of members) {
      if (withMembers) delete d.nodes[m];
      else if (d.nodes[m]) d.nodes[m].sectionId = null;
    }
    if (withMembers) d.edges = d.edges.filter((e) => !members.includes(e.source) && !members.includes(e.target));
  });
  st().clearSelection();
}

export function duplicateNodes(ids: string[], offset: Vec2 = { x: 40, y: 40 }): string[] {
  const p = getProject();
  if (!p) return [];
  const map = new Map<string, string>();
  ids.forEach((id) => p.nodes[id] && map.set(id, uid()));
  st().update((d) => {
    for (const [oldId, newId] of map) {
      const copy = structuredClone(p.nodes[oldId]) as CanvasNode;
      copy.id = newId;
      copy.position = { x: copy.position.x + offset.x, y: copy.position.y + offset.y };
      if ('jobId' in copy.data) delete (copy.data as MediaNode['data']).jobId;
      d.nodes[newId] = copy;
    }
    for (const e of p.edges) {
      const s = map.get(e.source);
      const t = map.get(e.target);
      if (t) d.edges.push({ id: uid(), source: s ?? e.source, target: t, data: { ...e.data } });
    }
  });
  const out = [...map.values()];
  st().select(out);
  return out;
}

export function copySelection() {
  const p = getProject();
  const ids = st().selection;
  if (!p || !ids.length) return;
  const set = new Set(ids);
  st().setClipboard({
    nodes: ids.map((id) => structuredClone(p.nodes[id])).filter(Boolean),
    edges: p.edges.filter((e) => set.has(e.source) && set.has(e.target)).map((e) => ({ ...e })),
  });
}

export function pasteClipboard() {
  const clip = st().clipboard;
  const p = getProject();
  if (!clip || !p || !clip.nodes.length) return;
  const c = viewportCenter();
  const minX = Math.min(...clip.nodes.map((n) => n.position.x));
  const minY = Math.min(...clip.nodes.map((n) => n.position.y));
  const map = new Map<string, string>();
  st().update((d) => {
    for (const n of clip.nodes) {
      const id = uid();
      map.set(n.id, id);
      const copy = structuredClone(n);
      copy.id = id;
      copy.position = { x: c.x + (n.position.x - minX) - 100, y: c.y + (n.position.y - minY) - 80 };
      d.nodes[id] = copy;
    }
    for (const e of clip.edges) d.edges.push({ id: uid(), source: map.get(e.source)!, target: map.get(e.target)!, data: { ...e.data } });
  });
  st().select([...map.values()]);
}

export function edgesInto(p: Project, nodeId: string): Edge[] {
  return p.edges.filter((e) => e.target === nodeId);
}

export function usedInputs(p: Project, nodeId: string): Record<string, number> {
  const used: Record<string, number> = {};
  for (const e of edgesInto(p, nodeId)) used[e.data.mediaInputId] = (used[e.data.mediaInputId] ?? 0) + 1;
  return used;
}

/** Connect `sourceId` into generator `targetId`. Returns an error message or null. */
export function connect(sourceId: string, targetId: string, inputId?: string): string | null {
  const p = getProject();
  if (!p || sourceId === targetId) return 'conexão inválida';
  const src = p.nodes[sourceId];
  const tgt = p.nodes[targetId] as MediaNode | undefined;
  if (!src || !tgt) return 'nó não encontrado';
  if (tgt.type !== 'image' && tgt.type !== 'video' && tgt.type !== 'audio') return 'só nós de geração recebem conexões';
  const gs = tgt.data.generationSettings;
  if (!gs) return 'este nó não é um gerador';
  if (p.edges.some((e) => e.source === sourceId && e.target === targetId)) return 'já conectado';
  if (src.type === 'text') {
    st().update((d) => {
      d.edges.push({ id: uid(), source: sourceId, target: targetId, data: { mediaInputId: 'prompt' } });
    });
    return null;
  }
  const action = ACTIONS[gs.actionType];
  const used = usedInputs(p, targetId);
  const input = inputId ? action.mediaInputs.find((m) => m.id === inputId) : pickInputFor(action, src.type, used);
  if (!input) return `"${action.name}" não aceita ${src.type === 'image' ? 'imagem' : src.type === 'video' ? 'vídeo' : 'áudio'} aqui`;
  if (!input.accepted.includes(src.type)) return `${input.label} não aceita este tipo de mídia`;
  if ((used[input.id] ?? 0) >= input.max) {
    if (input.max !== 1) return `${input.label}: limite de ${input.max}`;
    // single slot: replace the existing connection
    st().update((d) => {
      d.edges = d.edges.filter((e) => !(e.target === targetId && e.data.mediaInputId === input.id));
      d.edges.push({ id: uid(), source: sourceId, target: targetId, data: { mediaInputId: input.id } });
    });
    return null;
  }
  st().update((d) => {
    d.edges.push({ id: uid(), source: sourceId, target: targetId, data: { mediaInputId: input.id } });
  });
  return null;
}

export function disconnect(edgeId: string) {
  st().update((d) => {
    d.edges = d.edges.filter((e) => e.id !== edgeId);
  });
}

/** Changing the action of a generator re-homes its connections where possible. */
export function setNodeAction(nodeId: string, actionType: ActionType) {
  const p = getProject();
  const node = p?.nodes[nodeId] as MediaNode | undefined;
  if (!p || !node?.data.generationSettings) return;
  const action = ACTIONS[actionType];
  st().update((d) => {
    const n = d.nodes[nodeId] as MediaNode;
    n.data.generationSettings!.actionType = actionType;
    n.data.generationSettings!.inputs.model = defaultModelFor(actionType);
    const used: Record<string, number> = {};
    d.edges = d.edges.filter((e) => {
      if (e.target !== nodeId || e.data.mediaInputId === 'prompt') return true;
      const src = d.nodes[e.source];
      if (!src) return false;
      const keep = action.mediaInputs.find((m) => m.id === e.data.mediaInputId && m.accepted.includes(src.type as never) && (used[m.id] ?? 0) < m.max);
      const target = keep ?? pickInputFor(action, src.type, used);
      if (!target) return false;
      e.data.mediaInputId = target.id;
      used[target.id] = (used[target.id] ?? 0) + 1;
      return true;
    });
  });
}

/** "Imagem / Vídeo / Áudio" next-step buttons on a selected node. */
export function createDownstream(sourceId: string, kind: MediaKind, actionType?: ActionType): string | undefined {
  const p = getProject();
  const src = p?.nodes[sourceId];
  if (!p || !src) return;
  const r = rectOf(p, src);
  const action: ActionType =
    actionType ??
    (kind === 'image'
      ? src.type === 'image'
        ? 'Image'
        : 'TextToImage'
      : kind === 'video'
        ? src.type === 'image'
          ? 'ImageToVideo'
          : src.type === 'video'
            ? 'VideoExtension'
            : src.type === 'audio'
              ? 'AudioToVideo'
              : 'ReferenceToVideo'
        : src.type === 'video'
          ? 'VideoToAudio'
          : 'TextToDialog');
  if (kind === 'audio' && action === 'VideoToAudio') kind = 'video';
  const h = kind === 'audio' ? 120 : Math.round((DEFAULT_MEDIA_WIDTH * 9) / 16);
  const pos = findFreeSpot({ x: r.x + r.w + 120, y: r.y }, DEFAULT_MEDIA_WIDTH, h);
  const id = createMediaNode(kind, { actionType: action, position: pos, sectionId: src.sectionId ?? null, focus: true });
  // text notes connect as prompt input; media connect into the first compatible slot
  connect(sourceId, id);
  return id;
}

// ---------- uploads ----------

export function mediaNodeFromUpload(u: UploadedMedia, position: Vec2): MediaNode {
  return {
    id: uid(),
    type: u.kind,
    position,
    data: {
      url: u.url,
      width: u.width,
      height: u.height,
      duration: u.duration,
      status: 'completed',
      user_input_title: u.name?.replace(/\.[^.]+$/, ''),
      versions: [{ url: u.url, width: u.width, height: u.height, duration: u.duration, createdAt: new Date().toISOString() }],
      activeVersion: 0,
    },
  };
}

export async function uploadFilesToCanvas(files: File[], at?: Vec2): Promise<string[]> {
  const p = getProject();
  if (!p || !files.length) return [];
  const uploaded = await api.upload(p.projectId, files);
  const ids: string[] = [];
  let cursor = at ?? viewportCenter();
  for (const u of uploaded) {
    const h = u.width && u.height ? (DEFAULT_MEDIA_WIDTH * u.height) / u.width : u.kind === 'audio' ? 120 : 220;
    const pos = findFreeSpot(cursor, DEFAULT_MEDIA_WIDTH, h);
    const node = mediaNodeFromUpload(u, pos);
    node.sectionId = sectionAt(getProject()!, pos.x + 10, pos.y + 10)?.id ?? null;
    st().update((d) => {
      d.nodes[node.id] = node;
    });
    ids.push(node.id);
    cursor = { x: pos.x + DEFAULT_MEDIA_WIDTH + 40, y: pos.y };
  }
  st().select(ids);
  return ids;
}

export function pickFiles(accept = 'image/*,video/*,audio/*', multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.click();
  });
}

// ---------- organize ----------

export function organizeCanvas() {
  const p = getProject();
  if (!p) return;
  const gap = 48;
  let cursorY = 0;
  st().update((d) => {
    const groups: (string | null)[] = [...Object.keys(d.sections), null];
    for (const sid of groups) {
      const members = Object.values(d.nodes).filter((n) => (n.sectionId ?? null) === sid);
      if (!members.length && sid !== null) {
        const s = d.sections[sid];
        s.position = { x: 0, y: cursorY };
        cursorY += s.dimensions.height + gap * 2;
        continue;
      }
      if (!members.length) continue;
      // text notes first, then images, video, audio
      const order = { text: 0, richtext: 0, image: 1, stage_scene: 1, video: 2, audio: 3, placeholder: 4 } as Record<string, number>;
      members.sort((a, b) => order[a.type] - order[b.type] || a.position.y - b.position.y || a.position.x - b.position.x);
      const cols = Math.max(3, Math.ceil(Math.sqrt(members.length * 1.6)));
      const pad = sid ? 40 : 0;
      let x = pad;
      let rowH = 0;
      let y = cursorY + pad + (sid ? 10 : 0);
      members.forEach((n, i) => {
        const r = rectOf(d as Project, n as CanvasNode);
        if (i > 0 && i % cols === 0) {
          x = pad;
          y += rowH + gap;
          rowH = 0;
        }
        n.position = { x, y };
        x += r.w + gap;
        rowH = Math.max(rowH, r.h);
      });
      const height = y + rowH - cursorY + pad;
      if (sid) {
        const width = Math.max(600, Math.max(...members.map((n) => n.position.x + rectOf(d as Project, n as CanvasNode).w)) + pad);
        d.sections[sid].position = { x: 0, y: cursorY };
        d.sections[sid].dimensions = { width, height };
      }
      cursorY += height + gap * 2;
    }
  });
}

export function zoomToFit(ids?: string[]) {
  const p = getProject();
  if (!p) return;
  const el = document.querySelector('.canvas-root') as HTMLElement | null;
  if (!el) return;
  const all = ids?.length ? ids : Object.keys(p.nodes);
  let b = boundsOf(p, all);
  const secs = ids?.length ? [] : Object.values(p.sections);
  for (const s of secs) {
    const sb = { x: s.position.x, y: s.position.y - 30, w: s.dimensions.width, h: s.dimensions.height + 30 };
    b = b
      ? (() => {
          const x = Math.min(b!.x, sb.x);
          const y = Math.min(b!.y, sb.y);
          return { x, y, w: Math.max(b!.x + b!.w, sb.x + sb.w) - x, h: Math.max(b!.y + b!.h, sb.y + sb.h) - y };
        })()
      : sb;
  }
  if (!b) {
    st().setViewport({ x: el.clientWidth / 2, y: el.clientHeight / 2, zoom: 1 });
    return;
  }
  const pad = 80;
  const zoom = Math.max(0.1, Math.min(1.5, Math.min((el.clientWidth - pad * 2) / b.w, (el.clientHeight - pad * 2) / b.h)));
  st().setViewport({ zoom, x: el.clientWidth / 2 - (b.x + b.w / 2) * zoom, y: el.clientHeight / 2 - (b.y + b.h / 2) * zoom });
}

// ---------- timeline ----------

export function addNodesToTimeline(nodeIds: string[], imageDuration = 3): number {
  const p = getProject();
  if (!p) return 0;
  const t = p.timelines[p.activeTimelineId];
  const main = t.tracks.find((tr) => tr.type === 'main')!;
  const audioTrack = t.tracks.find((tr) => tr.type === 'audio');
  let mainEnd = Object.values(t.clips).filter((c) => c.trackId === main.id).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  let audioEnd = audioTrack ? Object.values(t.clips).filter((c) => c.trackId === audioTrack.id).reduce((m, c) => Math.max(m, c.start + c.duration), 0) : 0;
  const clips: Clip[] = [];
  for (const id of nodeIds) {
    const n = p.nodes[id] as MediaNode | undefined;
    if (!n || !(n.type === 'image' || n.type === 'video' || n.type === 'audio') || !n.data.url) continue;
    const dur = n.type === 'image' ? imageDuration : n.data.duration ?? 5;
    const isAudio = n.type === 'audio';
    const trackId = isAudio ? audioTrack?.id ?? main.id : main.id;
    const start = isAudio ? audioEnd : mainEnd;
    clips.push({
      id: uid(),
      trackId,
      nodeId: id,
      mediaType: n.type,
      url: n.data.url,
      label: nodeTitle(n),
      start,
      duration: dur,
      in: 0,
      sourceDuration: n.type === 'image' ? undefined : n.data.duration,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    });
    if (isAudio) audioEnd += dur;
    else mainEnd += dur;
  }
  if (!clips.length) return 0;
  st().update((d) => {
    const tl = d.timelines[d.activeTimelineId];
    for (const c of clips) tl.clips[c.id] = c;
  });
  return clips.length;
}

export function nodeLabel(id: string): string {
  const p = getProject();
  const n = p?.nodes[id];
  return n ? nodeTitle(n) : id;
}
