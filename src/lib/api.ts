import type {
  AgentStreamEvent,
  ChatThread,
  ChatThreadSummary,
  GenerateRequest,
  JobState,
  ModelInfo,
  Project,
  ProjectSummary,
  ProviderStatus,
} from '../../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface UploadedMedia {
  url: string;
  kind: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
  duration?: number;
  name?: string;
}

export interface ProvidersInfo {
  active: string;
  providers: ProviderStatus[];
  agent: { configured: boolean; model: string };
}

export interface HiggsfieldTools {
  url: string;
  tools: { name: string; description?: string; inputSchema: unknown }[];
  mapping: Record<string, unknown>;
  inferred: Record<string, { tool: string; args: Record<string, unknown> } | null>;
}

export const api = {
  listProjects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (name?: string) => req<Project>('POST', '/api/projects', { name }),
  getProject: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  saveProject: (p: Project) => req<{ lastSaved: string; thumbnail?: string }>('PUT', `/api/projects/${p.projectId}`, p),
  renameProject: (id: string, name: string) => req('PATCH', `/api/projects/${id}`, { name }),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),
  duplicateProject: (id: string) => req<Project>('POST', `/api/projects/${id}/duplicate`),

  async upload(projectId: string, files: File[]): Promise<UploadedMedia[]> {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    const res = await fetch(`/api/projects/${projectId}/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? 'falha no upload');
    return data;
  },
  uploadDataUrl: (projectId: string, dataUrl: string) => req<UploadedMedia>('POST', `/api/projects/${projectId}/upload-dataurl`, { dataUrl }),

  generate: (r: GenerateRequest) => req<JobState>('POST', '/api/generate', r),
  cancelJob: (id: string) => req('POST', `/api/jobs/${id}/cancel`),
  listJobs: (projectId: string) => req<JobState[]>('GET', `/api/jobs?projectId=${projectId}`),
  exportTimeline: (projectId: string, timelineId: string, height: number, fps: number) =>
    req<JobState>('POST', '/api/export', { projectId, timelineId, height, fps }),

  providers: () => req<ProvidersInfo>('GET', '/api/providers'),
  setProvider: (id: string) => req('PUT', '/api/providers/active', { id }),
  models: () => req<ModelInfo[]>('GET', '/api/models'),
  higgsfieldConnect: () => req<{ authUrl?: string; connected: boolean }>('POST', '/api/providers/higgsfield/connect'),
  higgsfieldDisconnect: () => req('POST', '/api/providers/higgsfield/disconnect'),
  higgsfieldTools: () => req<HiggsfieldTools>('GET', '/api/providers/higgsfield/tools'),
  higgsfieldSetMapping: (m: unknown) => req('PUT', '/api/providers/higgsfield/mapping', m),
  higgsfieldTestTool: (name: string, args: unknown) => req<unknown>('POST', '/api/providers/higgsfield/test-tool', { name, args }),

  threads: (projectId: string) => req<ChatThreadSummary[]>('GET', `/api/agent/threads?projectId=${projectId}`),
  thread: (projectId: string, id: string) => req<ChatThread>('GET', `/api/agent/threads/${id}?projectId=${projectId}`),
  deleteThread: (projectId: string, id: string) => req('DELETE', `/api/agent/threads/${id}?projectId=${projectId}`),
  toolResult: (runId: string, callId: string, result: unknown) => req('POST', '/api/agent/tool-result', { runId, callId, result }),
  cancelRun: (runId: string) => req('POST', '/api/agent/cancel', { runId }),
};

/** POST that streams `data:` SSE frames back. */
export async function streamAgent(body: unknown, onEvent: (e: AgentStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`agente indisponível (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data));
    }
  }
}
