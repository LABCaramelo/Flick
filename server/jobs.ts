import { ACTIONS } from '../shared/actions';
import { titleFromPrompt, uid } from '../shared/project';
import type { CanvasNode, GenerateRequest, JobOutput, JobState, MediaNode, MediaRef } from '../shared/types';
import { broadcast } from './events';
import { downloadToProject, fileToDataUri, publicUrlFor, resolveMediaUrl } from './media';
import { providerFor } from './providers';
import { ProviderError, type ProviderContext } from './providers/types';
import { patchProject } from './storage';

const jobs = new Map<string, JobState>();
const controllers = new Map<string, AbortController>();

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function listJobs(projectId: string): JobState[] {
  return [...jobs.values()].filter((j) => j.projectId === projectId);
}

export function emitJob(job: JobState): void {
  job.updatedAt = new Date().toISOString();
  const { request, ...pub } = job;
  broadcast(job.projectId, 'job', pub);
}

export function createJob(kind: JobState['kind'], projectId: string, nodeId: string, extra: Partial<JobState> = {}): JobState {
  const now = new Date().toISOString();
  const job: JobState = { id: uid(), kind, projectId, nodeId, status: 'queued', progress: 0, outputs: [], createdAt: now, updatedAt: now, ...extra };
  jobs.set(job.id, job);
  // keep memory bounded
  if (jobs.size > 500) {
    const old = [...jobs.values()].filter((j) => j.status === 'completed' || j.status === 'failed').slice(0, 100);
    old.forEach((j) => jobs.delete(j.id));
  }
  return job;
}

export function cancelJob(id: string): boolean {
  const c = controllers.get(id);
  if (!c) return false;
  c.abort();
  return true;
}

async function resolveMedia(ref: MediaRef): Promise<string> {
  if (ref.remoteUrl) return ref.remoteUrl;
  if (!ref.url) throw new Error(`mídia sem URL (${ref.nodeId})`);
  if (/^https?:\/\//.test(ref.url) || ref.url.startsWith('data:')) return ref.url;
  const pub = publicUrlFor(ref.url);
  if (pub) return pub;
  const file = resolveMediaUrl(ref.url);
  if (!file) throw new Error(`mídia inválida: ${ref.url}`);
  return fileToDataUri(file);
}

export function startGeneration(req: GenerateRequest): JobState {
  const job = createJob('generate', req.projectId, req.nodeId, { actionType: req.actionType, request: req });
  const controller = new AbortController();
  controllers.set(job.id, controller);

  const ctx: ProviderContext = {
    projectId: req.projectId,
    signal: controller.signal,
    progress(value, message) {
      job.status = 'processing';
      job.progress = Math.max(job.progress, Math.min(99, Math.round(value)));
      if (message) job.message = message;
      emitJob(job);
    },
    resolveMedia,
    localFile: (ref) => (ref.url ? resolveMediaUrl(ref.url) : undefined),
  };

  (async () => {
    job.status = 'processing';
    emitJob(job);
    try {
      const provider = await providerFor(req.actionType);
      job.message = `Gerando com ${provider.name}…`;
      emitJob(job);
      const raw = await provider.generate(req, ctx);
      if (!raw.length) throw new Error('o provedor não retornou mídia');
      ctx.progress(96, 'Baixando resultado…');
      const outputs: JobOutput[] = [];
      for (const r of raw) {
        const saved = await downloadToProject(req.projectId, r.url);
        outputs.push({
          url: saved.url,
          remoteUrl: /^https?:\/\//.test(r.url) ? r.url : undefined,
          type: r.type ?? saved.kind,
          width: saved.width,
          height: saved.height,
          duration: saved.duration,
        });
      }
      job.outputs = outputs;
      job.createdNodes = await persistResult(req, outputs).catch((e) => {
        console.warn('[jobs] falha ao salvar resultado no projeto', e);
        return [];
      });
      job.status = 'completed';
      job.progress = 100;
      job.message = undefined;
      emitJob(job);
    } catch (err) {
      job.status = 'failed';
      job.error = controller.signal.aborted ? 'Cancelado' : String((err as Error)?.message ?? err);
      if (err instanceof ProviderError && err.needsAuth) job.error = `${job.error} [auth]`;
      emitJob(job);
      await patchProject(req.projectId, (p) => {
        const n = p.nodes[req.nodeId] as MediaNode | undefined;
        if (n && n.data && n.data.jobId === job.id) Object.assign(n.data, { status: 'failed', error: job.error, progress: 0 });
      }).catch(() => undefined);
    } finally {
      controllers.delete(job.id);
    }
  })();

  return job;
}

/**
 * Write the result into project.json so it survives even when no tab is
 * open. The client applies the same change from the SSE event; when both
 * happen the data is identical.
 */
async function persistResult(req: GenerateRequest, outputs: JobOutput[]): Promise<CanvasNode[]> {
  const created: CanvasNode[] = [];
  await patchProject(req.projectId, (p) => {
    const node = p.nodes[req.nodeId] as MediaNode | undefined;
    if (!node) return;
    const first = outputs[0];
    const now = new Date().toISOString();
    const settings = node.data.generationSettings;
    const versions = node.data.versions ?? [];
    versions.push({ url: first.url, remoteUrl: first.remoteUrl, width: first.width, height: first.height, duration: first.duration, createdAt: now, settings });
    Object.assign(node.data, {
      url: first.url,
      remoteUrl: first.remoteUrl,
      width: first.width,
      height: first.height,
      duration: first.duration,
      status: 'completed',
      progress: 100,
      error: undefined,
      versions,
      activeVersion: versions.length - 1,
      auto_generated_title: node.data.auto_generated_title || titleFromPrompt(req.prompt) || ACTIONS[req.actionType].name,
    });
    // extra outputs (e.g. num_images > 1) become sibling nodes
    outputs.slice(1).forEach((o, i) => {
      const id = uid();
      const w = node.data.displayWidth ?? 360;
      p.nodes[id] = {
        id,
        type: o.type,
        position: { x: node.position.x + (i + 1) * (w + 40), y: node.position.y },
        sectionId: node.sectionId,
        data: {
          url: o.url,
          remoteUrl: o.remoteUrl,
          width: o.width,
          height: o.height,
          duration: o.duration,
          status: 'completed',
          generationSettings: settings,
          auto_generated_title: `${node.data.auto_generated_title || titleFromPrompt(req.prompt)} ${i + 2}`,
          versions: [{ url: o.url, remoteUrl: o.remoteUrl, width: o.width, height: o.height, duration: o.duration, createdAt: now, settings }],
          activeVersion: 0,
        },
      } as MediaNode;
      created.push(p.nodes[id]);
    });
  });
  return created;
}
