import { ACTIONS, AGENT_GENERATION_TOOLS } from '../../shared/actions';
import { DEFAULT_MEDIA_WIDTH, nodeTitle, timelineDuration } from '../../shared/project';
import { findStyle } from '../../shared/styles';
import type { ActionType, CostEstimate, JobState, MediaNode, NoteColor, Project, TextNode, ToolCost, Vec2 } from '../../shared/types';
import { getProject, useProject } from '../store/project';
import {
  addNodesToTimeline,
  connect,
  createMediaNode,
  createSection,
  createTextNode,
  deleteNodes,
  findFreeSpot,
  organizeCanvas,
  viewportCenter,
  zoomToFit,
} from './canvasOps';
import { costPhrase, sumEstimates } from './cost';
import { generateAndWait } from './generation';
import { appendMarkdown, docToMarkdown, markdownToDoc } from './markdown';

// Client-side execution of the agent's tool calls (the server streams the
// call, we act on the canvas store and post the result back).

export interface ToolResult {
  ok: boolean;
  summary?: string;
  error?: string;
  nodeIds?: string[];
  data?: unknown;
  imageUrl?: string;
  rejected?: boolean;
  cost?: ToolCost;
}

export const TOOL_LABELS: Record<string, string> = {
  get_canvas_state: 'Ler o canvas',
  create_text_node: 'Criar nota',
  edit_text_node: 'Editar nota',
  create_section: 'Criar seção',
  generate_images: 'Gerar imagens',
  image_edit: 'Editar imagem',
  image_to_video: 'Gerar vídeo',
  run_action: 'Executar ação',
  generate_dialog: 'Gerar voz',
  generate_music: 'Gerar música',
  organize_nodes: 'Organizar canvas',
  update_story: 'Escrever na História',
  set_project_memory: 'Atualizar memória',
  timeline_read: 'Ler linha do tempo',
  timeline_add_clips: 'Montar linha do tempo',
  inspect_media: 'Analisar mídia',
};

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);

export function canvasSummary(p: Project, max = 60): string {
  const nodes = Object.values(p.nodes).slice(0, max);
  const lines = nodes.map((n) => {
    const sec = n.sectionId ? p.sections[n.sectionId]?.label : '';
    if (n.type === 'text') return `- [nota ${n.id}] ${nodeTitle(n)}${sec ? ` (em ${sec})` : ''}`;
    const m = n as MediaNode;
    const gs = m.data.generationSettings;
    return `- [${n.type} ${n.id}] "${nodeTitle(n)}" status=${m.data.url ? 'pronto' : m.data.status}${gs ? ` ação=${gs.actionType}` : ''}${sec ? ` (em ${sec})` : ''}`;
  });
  const secs = Object.values(p.sections).map((s) => `- [seção ${s.id}] ${s.label}`);
  return [`${Object.keys(p.nodes).length} nós, ${Object.keys(p.sections).length} seções.`, ...secs, ...lines].join('\n');
}

function fullState(p: Project) {
  const t = p.timelines[p.activeTimelineId];
  return {
    project: p.name,
    aspectRatio: p.projectSettings.aspectRatio,
    style: findStyle(p.projectSettings.styleId, p.customStyles)?.name ?? null,
    memory: p.story.memory,
    sections: Object.values(p.sections).map((s) => ({ id: s.id, label: s.label, members: Object.values(p.nodes).filter((n) => n.sectionId === s.id).map((n) => n.id) })),
    nodes: Object.values(p.nodes).map((n) => {
      if (n.type === 'text') return { id: n.id, type: 'text', title: nodeTitle(n), content: (n as TextNode).data.content.slice(0, 600), sectionId: n.sectionId ?? null };
      const m = n as MediaNode;
      const gs = m.data.generationSettings;
      return {
        id: n.id,
        type: n.type,
        title: nodeTitle(n),
        status: m.data.url ? 'ready' : m.data.status,
        error: m.data.error,
        action: gs?.actionType,
        model: gs?.inputs.model,
        prompt: str(gs?.inputs.prompt).slice(0, 300),
        duration: m.data.duration,
        sectionId: n.sectionId ?? null,
        inputs: p.edges.filter((e) => e.target === n.id).map((e) => ({ from: e.source, slot: e.data.mediaInputId })),
      };
    }),
    timeline: { duration: timelineDuration(t), clips: Object.values(t.clips).map((c) => ({ nodeId: c.nodeId, start: c.start, duration: c.duration })) },
    story: docToMarkdown(p.story.doc).slice(0, 4000),
  };
}

/** Lay out new nodes for the agent: inside a section when given, else to the right of the content. */
function placer(sectionId?: string) {
  const p = getProject()!;
  const sec = sectionId ? p.sections[sectionId] : undefined;
  let origin: Vec2;
  if (sec) origin = { x: sec.position.x + 40, y: sec.position.y + 40 };
  else {
    const xs = Object.values(p.nodes).map((n) => n.position.x + 400);
    origin = xs.length ? { x: Math.max(...xs) + 80, y: Math.min(...Object.values(p.nodes).map((n) => n.position.y)) } : viewportCenter();
  }
  return (h = 210) => {
    const spot = findFreeSpot(origin, DEFAULT_MEDIA_WIDTH, h);
    return spot;
  };
}

function growSection(sectionId: string | undefined, ids: string[]) {
  if (!sectionId) return;
  const p = getProject();
  const s = p?.sections[sectionId];
  if (!p || !s) return;
  let r = s.position.x + s.dimensions.width;
  let b = s.position.y + s.dimensions.height;
  for (const id of ids) {
    const n = p.nodes[id];
    if (!n) continue;
    r = Math.max(r, n.position.x + DEFAULT_MEDIA_WIDTH + 40);
    b = Math.max(b, n.position.y + 260);
  }
  useProject.getState().update(
    (d) => {
      d.sections[sectionId].dimensions = { width: r - s.position.x, height: b - s.position.y };
    },
    { record: false },
  );
}

/** Generates the nodes; `prices` (from estimateGenerations) tags each one with its estimated cost. */
async function runAll(ids: string[], timeoutMs: number, prices: Record<string, CostEstimate>): Promise<ToolResult> {
  const results = await Promise.allSettled(ids.map((id) => generateAndWait(id, timeoutMs)));
  const lines: string[] = [];
  const submitted: CostEstimate[] = [];
  let alive = 0; // finished or still running
  results.forEach((r, i) => {
    const id = ids[i];
    if (r.status === 'rejected') {
      // refused before reaching the provider: nothing was charged
      lines.push(`${id}: erro — ${r.reason?.message ?? r.reason}`);
      return;
    }
    const price = prices[id];
    if (price) submitted.push(price);
    const j: JobState = r.value;
    if (j.status !== 'failed') alive++;
    const status = j.status === 'completed' ? 'pronto' : j.status === 'failed' ? `falhou — ${j.error}` : `ainda gerando (${j.progress}%)`;
    lines.push(`${id}: ${status}${price ? ` · ${costPhrase(price)}` : ''}`);
  });
  zoomToFit(ids);
  const summary = lines.join('\n');
  return { ok: alive > 0, summary, nodeIds: ids, error: alive > 0 ? undefined : summary, cost: submitted.length ? sumEstimates(submitted) : undefined };
}

function createGenerator(kind: 'image' | 'video' | 'audio', actionType: ActionType, opts: { prompt?: string; title?: string; model?: string; settings?: Record<string, unknown>; sectionId?: string; position: Vec2 }) {
  return createMediaNode(kind, {
    actionType,
    prompt: opts.prompt,
    title: opts.title,
    model: opts.model || undefined,
    settings: opts.settings,
    sectionId: opts.sectionId ?? null,
    position: opts.position,
    select: false,
  });
}

export const isGenerationTool = (name: string) => AGENT_GENERATION_TOOLS.includes(name);

/** Nodes a generation tool laid out, not generated yet: they are priced and approved first. */
export interface PlannedGeneration {
  nodeIds: string[];
  timeoutMs: number;
}

/** Lays out the nodes of a generation tool call without generating them. */
export function planAgentGeneration(name: string, args: Record<string, unknown>): PlannedGeneration | { error: string } {
  const p = getProject();
  if (!p) return { error: 'nenhum projeto aberto' };

  switch (name) {
    case 'generate_images': {
      const items = (Array.isArray(args.images) ? args.images : []) as { prompt?: string; title?: string; reference_node_ids?: string[] }[];
      if (!items.length) return { error: 'nenhuma imagem pedida' };
      const sectionId = str(args.section_id) && p.sections[str(args.section_id)] ? str(args.section_id) : undefined;
      const place = placer(sectionId);
      const ids: string[] = [];
      for (const it of items.slice(0, 8)) {
        const id = createGenerator('image', 'Image', {
          prompt: it.prompt,
          title: it.title,
          model: str(args.model),
          settings: args.aspect_ratio ? { aspect_ratio: str(args.aspect_ratio) } : undefined,
          sectionId,
          position: place(),
        });
        for (const ref of arr(it.reference_node_ids)) if (getProject()!.nodes[ref]) connect(ref, id, 'referenceImages');
        ids.push(id);
      }
      growSection(sectionId, ids);
      return { nodeIds: ids, timeoutMs: 4 * 60_000 };
    }

    case 'image_edit': {
      const sources = arr(args.source_node_ids).filter((id) => p.nodes[id]?.type === 'image');
      if (!sources.length) return { error: 'nenhuma imagem de origem válida' };
      const src = p.nodes[sources[0]];
      const pos = findFreeSpot({ x: src.position.x + 440, y: src.position.y }, DEFAULT_MEDIA_WIDTH, 210);
      const id = createGenerator('image', 'EditImage', { prompt: str(args.prompt), title: str(args.title), model: str(args.model), sectionId: src.sectionId ?? undefined, position: pos });
      sources.forEach((s) => connect(s, id, 'referenceImages'));
      return { nodeIds: [id], timeoutMs: 4 * 60_000 };
    }

    case 'image_to_video': {
      const start = str(args.start_frame_node_id);
      if (p.nodes[start]?.type !== 'image') return { error: 'quadro inicial inválido' };
      const src = p.nodes[start];
      const pos = findFreeSpot({ x: src.position.x + 440, y: src.position.y }, DEFAULT_MEDIA_WIDTH, 210);
      const id = createGenerator('video', 'ImageToVideo', {
        prompt: str(args.prompt),
        title: str(args.title),
        model: str(args.model),
        settings: args.duration ? { duration: str(args.duration) } : undefined,
        sectionId: src.sectionId ?? undefined,
        position: pos,
      });
      connect(start, id, 'startFrame');
      const end = str(args.end_frame_node_id);
      if (end && p.nodes[end]?.type === 'image') connect(end, id, 'endFrame');
      return { nodeIds: [id], timeoutMs: 3 * 60_000 };
    }

    case 'run_action': {
      const actionType = str(args.action_type) as ActionType;
      const action = ACTIONS[actionType];
      if (!action) return { error: `ação desconhecida: ${actionType}` };
      const inputs = (args.inputs ?? {}) as Record<string, unknown>;
      const firstSrc = Object.values(inputs).flatMap(arr).map((id) => p.nodes[id]).find(Boolean);
      const pos = firstSrc ? findFreeSpot({ x: firstSrc.position.x + 440, y: firstSrc.position.y }, DEFAULT_MEDIA_WIDTH, 210) : placer()();
      const id = createGenerator(action.output, actionType, {
        prompt: str(args.prompt),
        title: str(args.title),
        model: str(args.model),
        settings: (args.settings as Record<string, unknown>) ?? undefined,
        sectionId: firstSrc?.sectionId ?? undefined,
        position: pos,
      });
      for (const [inputId, ids] of Object.entries(inputs)) for (const src of arr(ids)) if (getProject()!.nodes[src]) connect(src, id, inputId);
      return { nodeIds: [id], timeoutMs: 4 * 60_000 };
    }

    case 'generate_dialog':
    case 'generate_music': {
      const music = name === 'generate_music';
      const id = createGenerator('audio', music ? 'TextToMusic' : 'TextToDialog', {
        prompt: str(music ? args.prompt : args.text),
        title: str(args.title) || (music ? 'Trilha' : 'Fala'),
        settings: music && args.duration ? { duration: str(args.duration) } : undefined,
        position: placer()(120),
      });
      return { nodeIds: [id], timeoutMs: 3 * 60_000 };
    }

    default:
      return { error: `ferramenta de geração desconhecida: ${name}` };
  }
}

/** Generates what planAgentGeneration laid out; the result reports each generation's estimated cost. */
export function runPlannedGeneration(plan: PlannedGeneration, prices: Record<string, CostEstimate>): Promise<ToolResult> {
  return runAll(plan.nodeIds, plan.timeoutMs, prices);
}

/** The user declined: take the planned nodes off the canvas. */
export function discardPlannedGeneration(plan: PlannedGeneration) {
  deleteNodes(plan.nodeIds.filter((id) => getProject()?.nodes[id]));
}

/** Tools that don't generate. Generation tools go through planAgentGeneration, so they are priced first. */
export async function executeAgentTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const st = useProject.getState();
  const p = st.project;
  if (!p) return { ok: false, error: 'nenhum projeto aberto' };
  if (isGenerationTool(name)) return { ok: false, error: `${name} precisa ser orçada antes de gerar` };

  switch (name) {
    case 'get_canvas_state':
      return { ok: true, data: fullState(p), summary: `${Object.keys(p.nodes).length} nós lidos` };

    case 'create_text_node': {
      const sectionId = str(args.section_id) || undefined;
      const place = placer(sectionId);
      const id = createTextNode(str(args.content), { title: str(args.title) || undefined, color: (str(args.color) || 'yellow') as NoteColor, sectionId: sectionId ?? null, position: place(220) });
      growSection(sectionId, [id]);
      return { ok: true, nodeIds: [id], summary: `nota ${id} criada` };
    }

    case 'edit_text_node': {
      const id = str(args.node_id);
      if (p.nodes[id]?.type !== 'text') return { ok: false, error: 'nota não encontrada' };
      st.update((d) => {
        (d.nodes[id] as TextNode).data.content = str(args.content);
      });
      return { ok: true, nodeIds: [id] };
    }

    case 'create_section': {
      const ids = arr(args.node_ids).filter((id) => p.nodes[id]);
      const id = createSection(str(args.label) || undefined, ids);
      return { ok: true, data: { sectionId: id }, summary: `seção ${id} criada` };
    }

    case 'organize_nodes':
      organizeCanvas();
      setTimeout(() => zoomToFit(), 30);
      return { ok: true, summary: 'canvas organizado' };

    case 'update_story': {
      const md = str(args.markdown);
      st.update((d) => {
        d.story.doc = (str(args.mode) === 'replace' ? markdownToDoc(md) : appendMarkdown(d.story.doc, md)) as never;
      });
      window.dispatchEvent(new CustomEvent('claquete:story-changed'));
      return { ok: true, summary: `${md.split('\n').length} linhas escritas na História` };
    }

    case 'set_project_memory':
      st.update((d) => {
        d.story.memory = str(args.memory);
      });
      return { ok: true, summary: 'memória atualizada' };

    case 'timeline_read': {
      const t = p.timelines[p.activeTimelineId];
      return {
        ok: true,
        data: {
          duration: timelineDuration(t),
          tracks: t.tracks.map((tr) => ({ id: tr.id, type: tr.type })),
          clips: Object.values(t.clips).sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, nodeId: c.nodeId, label: c.label, track: c.trackId, start: c.start, duration: c.duration })),
        },
      };
    }

    case 'timeline_add_clips': {
      const n = addNodesToTimeline(arr(args.node_ids), Number(args.image_duration) || 3);
      return n ? { ok: true, summary: `${n} clipe(s) adicionados à linha do tempo` } : { ok: false, error: 'nenhuma mídia pronta entre os nós informados' };
    }

    case 'inspect_media': {
      const n = p.nodes[str(args.node_id)] as MediaNode | undefined;
      if (!n?.data?.url) return { ok: false, error: 'mídia não encontrada ou ainda não gerada' };
      if (n.type !== 'image') return { ok: true, summary: `${n.type} "${nodeTitle(n)}" (${n.data.duration ?? '?'}s) — só imagens podem ser vistas` };
      return { ok: true, imageUrl: n.data.url, summary: `imagem "${nodeTitle(n)}" enviada para análise` };
    }

    default:
      return { ok: false, error: `ferramenta desconhecida: ${name}` };
  }
}

export function describeToolArgs(name: string, args: Record<string, unknown>): string {
  if (name === 'generate_images') return ((args.images as { title?: string; prompt?: string }[]) ?? []).map((i) => i.title || i.prompt?.slice(0, 60)).join(' · ');
  if (name === 'image_to_video' || name === 'image_edit' || name === 'run_action') return str(args.prompt).slice(0, 120);
  if (name === 'create_section') return str(args.label);
  if (name === 'create_text_node') return str(args.title) || str(args.content).slice(0, 80);
  if (name === 'generate_dialog') return str(args.text).slice(0, 100);
  if (name === 'generate_music') return str(args.prompt).slice(0, 100);
  return '';
}
