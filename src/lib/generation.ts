import { ACTIONS, defaultModelId, findModel, modelSettings } from '../../shared/actions';
import { titleFromPrompt } from '../../shared/project';
import { findStyle } from '../../shared/styles';
import type { CanvasNode, GenerateRequest, JobState, MediaNode, MediaRef, TextNode } from '../../shared/types';
import { getProject, useProject } from '../store/project';
import { toast, useUi } from '../store/ui';
import { api } from './api';

const st = () => useProject.getState();

const MENTION = /@\[([^\]]+)\]\(([^)]+)\)/g;

function refOf(n: CanvasNode): MediaRef {
  if (n.type === 'text' || n.type === 'richtext') return { nodeId: n.id, type: 'text', text: (n as TextNode).data.content };
  const m = n as MediaNode;
  return { nodeId: n.id, type: m.type, url: m.data.url, remoteUrl: m.data.remoteUrl };
}

export interface PreparedGeneration {
  request: GenerateRequest;
  missing: string[];
}

export function prepareGeneration(nodeId: string): PreparedGeneration | { error: string } {
  const p = getProject();
  const node = p?.nodes[nodeId] as MediaNode | undefined;
  if (!p || !node) return { error: 'nó não encontrado' };
  const gs = node.data.generationSettings;
  if (!gs) return { error: 'este nó não tem configurações de geração' };
  const action = ACTIONS[gs.actionType];
  const { model: savedModel, prompt: rawPrompt = '', ...settings } = gs.inputs as Record<string, unknown> & { model?: string; prompt?: string };
  // the model the panel shows: the saved one, else the action's default
  const models = st().models;
  const modelInfo = findModel(models, savedModel) ?? findModel(models, defaultModelId(models, gs.actionType));
  const model = findModel(models, savedModel) ? savedModel! : modelInfo?.id ?? savedModel ?? 'auto';
  // settings left untouched in the panel still go out with the value it shows
  for (const s of modelSettings(modelInfo, gs.actionType)) if (settings[s.id] === undefined && s.defaultValue !== undefined) settings[s.id] = s.defaultValue;

  const mediaInputs: Record<string, MediaRef[]> = {};
  const textParts: string[] = [];
  for (const e of p.edges.filter((x) => x.target === nodeId)) {
    const src = p.nodes[e.source];
    if (!src) continue;
    if (src.type === 'text' || src.type === 'richtext') {
      textParts.push((src as TextNode).data.content);
      continue;
    }
    const ref = refOf(src);
    if (!ref.url) continue;
    (mediaInputs[e.data.mediaInputId] ??= []).push(ref);
  }

  // @mentions of media nodes become references too
  let prompt = String(rawPrompt);
  const firstRefInput = action.mediaInputs.find((m) => m.pattern === 'reference-collection' && m.accepted.includes('image'));
  for (const m of prompt.matchAll(MENTION)) {
    const src = p.nodes[m[2]];
    if (!src) continue;
    if (src.type === 'text') textParts.push((src as TextNode).data.content);
    else if (src.type === 'image' && firstRefInput) {
      const list = (mediaInputs[firstRefInput.id] ??= []);
      if (!list.some((r) => r.nodeId === src.id) && list.length < firstRefInput.max) list.push(refOf(src));
    }
  }
  prompt = prompt.replace(MENTION, (_, title) => title);
  if (textParts.length) prompt = [prompt, ...textParts].filter(Boolean).join('\n\n');

  // style: node style overrides project style; style lock appends project memory
  // undefined = follow the project style, null = explicitly no style
  const style = findStyle(gs.styleId === undefined ? p.projectSettings.styleId : gs.styleId, p.customStyles);
  const styleBits = [style?.prompt];
  if (p.projectSettings.styleLock && p.story.memory.trim() && action.output !== 'audio') styleBits.push(p.story.memory.trim());
  const stylePrompt = styleBits.filter(Boolean).join('\n') || undefined;
  if (style?.referenceUrls?.length && action.output === 'image') {
    const refInput = action.mediaInputs.find((m) => m.id === 'referenceImages');
    if (refInput) {
      const list = (mediaInputs[refInput.id] ??= []);
      style.referenceUrls.slice(0, Math.max(0, refInput.max - list.length)).forEach((url, i) => list.push({ nodeId: `style-${i}`, type: 'image', url }));
    }
  }

  const missing = action.mediaInputs.filter((m) => m.required && !mediaInputs[m.id]?.length).map((m) => m.label);
  const promptDef = action.common.find((c) => c.id === 'prompt');
  if (promptDef?.required && !prompt.trim() && !textParts.length) missing.push('Prompt');

  return {
    missing,
    request: {
      projectId: p.projectId,
      nodeId,
      actionType: gs.actionType,
      model: String(model),
      prompt: prompt.trim(),
      settings,
      mediaInputs,
      stylePrompt,
    },
  };
}

const waiters = new Map<string, ((j: JobState) => void)[]>();

export async function runGeneration(nodeId: string): Promise<JobState> {
  const prep = prepareGeneration(nodeId);
  if ('error' in prep) throw new Error(prep.error);
  if (prep.missing.length) throw new Error(`Falta: ${prep.missing.join(', ')}`);
  st().update(
    (d) => {
      const n = d.nodes[nodeId] as MediaNode;
      n.data.status = 'queued';
      n.data.progress = 0;
      n.data.error = undefined;
      if (!n.data.user_input_title && !n.data.auto_generated_title) n.data.auto_generated_title = titleFromPrompt(prep.request.prompt) || undefined;
    },
    { record: false },
  );
  try {
    const job = await api.generate(prep.request);
    st().upsertJob(job);
    st().update(
      (d) => {
        const n = d.nodes[nodeId] as MediaNode | undefined;
        if (n) n.data.jobId = job.id;
      },
      { record: false },
    );
    return job;
  } catch (err) {
    st().update(
      (d) => {
        const n = d.nodes[nodeId] as MediaNode | undefined;
        if (n) Object.assign(n.data, { status: 'failed', error: String((err as Error).message) });
      },
      { record: false },
    );
    throw err;
  }
}

export function waitForJob(jobId: string, timeoutMs = 10 * 60_000): Promise<JobState> {
  const existing = st().jobs[jobId];
  if (existing && (existing.status === 'completed' || existing.status === 'failed')) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const list = waiters.get(jobId) ?? [];
    list.push(resolve);
    waiters.set(jobId, list);
    setTimeout(() => {
      const cur = st().jobs[jobId];
      if (cur && cur.status !== 'completed' && cur.status !== 'failed') resolve(cur);
    }, timeoutMs);
  });
}

/** Apply a server job event to the canvas. */
export function applyJob(job: JobState) {
  st().upsertJob(job);
  if (job.kind === 'generate') {
    const p = getProject();
    const node = p?.nodes[job.nodeId] as MediaNode | undefined;
    if (node && (node.data.jobId === job.id || !node.data.jobId)) {
      st().update(
        (d) => {
          const n = d.nodes[job.nodeId] as MediaNode;
          if (job.status === 'processing' || job.status === 'queued') {
            n.data.status = job.status;
            n.data.progress = job.progress;
          } else if (job.status === 'failed') {
            n.data.status = 'failed';
            n.data.error = job.error;
            n.data.progress = 0;
          } else if (job.status === 'completed' && job.outputs[0]) {
            const o = job.outputs[0];
            const already = n.data.versions?.some((v) => v.url === o.url);
            const versions = n.data.versions ?? (n.data.versions = []);
            if (!already) versions.push({ url: o.url, remoteUrl: o.remoteUrl, width: o.width, height: o.height, duration: o.duration, createdAt: job.updatedAt, settings: n.data.generationSettings ? JSON.parse(JSON.stringify(n.data.generationSettings)) : undefined });
            Object.assign(n.data, {
              url: o.url,
              remoteUrl: o.remoteUrl,
              width: o.width,
              height: o.height,
              duration: o.duration,
              status: 'completed',
              progress: 100,
              error: undefined,
              activeVersion: versions.findIndex((v) => v.url === o.url),
            });
            for (const extra of job.createdNodes ?? []) if (!d.nodes[extra.id]) d.nodes[extra.id] = extra;
          }
        },
        { record: false },
      );
    }
    if (job.status === 'failed' && job.error) {
      const needsAuth = job.error.includes('[auth]');
      toast(job.error.replace(' [auth]', ''), 'error', needsAuth ? { label: 'Conectar', run: () => useUi.getState().setSettingsOpen(true) } : undefined);
    }
  }
  if (job.status === 'completed' || job.status === 'failed') {
    const list = waiters.get(job.id);
    waiters.delete(job.id);
    list?.forEach((r) => r(job));
  }
}

export async function cancelGeneration(nodeId: string) {
  const n = getProject()?.nodes[nodeId] as MediaNode | undefined;
  if (n?.data.jobId) await api.cancelJob(n.data.jobId).catch(() => undefined);
}

/** Generate, then resolve when finished (used by the agent). */
export async function generateAndWait(nodeId: string, timeoutMs = 5 * 60_000): Promise<JobState> {
  const job = await runGeneration(nodeId);
  return waitForJob(job.id, timeoutMs);
}
