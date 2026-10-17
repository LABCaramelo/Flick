import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { GenerateRequest, Project } from '../shared/types';
import { agentConfigured, cancelRun, deleteThread, deliverToolResult, getThread, listThreads, runAgent } from './agent/agent';
import { DIST_DIR, HIGGSFIELD_MCP_URL, IS_PROD, MEDIA_DIR, OPENAI_MODEL, PORT } from './config';
import { subscribe } from './events';
import { startExport } from './export';
import { cancelJob, getJob, listJobs, startGeneration } from './jobs';
import { downloadToProject, kindFromName, saveBuffer } from './media';
import { activeModels, activeProviderId, allProviders, higgsfield, initProviders, setActiveProvider } from './providers';
import { CALLBACK_PATH } from './providers/higgsfield';
import { createProject, deleteProject, duplicateProject, ensureDirs, getProject, listProjects, patchProject, saveProject } from './storage';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '60mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------------- projects ----------------

app.get('/api/projects', h(async (_req, res) => res.json(await listProjects())));

app.post('/api/projects', h(async (req, res) => res.json(await createProject(req.body?.name))));

app.get('/api/projects/:id', h(async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'projeto não encontrado' });
  res.json(p);
}));

app.put('/api/projects/:id', h(async (req, res) => {
  const body = req.body as Project;
  if (!body || body.projectId !== req.params.id) return res.status(400).json({ error: 'projectId não confere' });
  const saved = await saveProject(body);
  res.json({ lastSaved: saved.lastSaved, thumbnail: saved.thumbnail });
}));

app.patch('/api/projects/:id', h(async (req, res) => {
  const p = await patchProject(req.params.id, (proj) => {
    if (typeof req.body?.name === 'string') proj.name = req.body.name.slice(0, 120) || proj.name;
  });
  if (!p) return res.status(404).json({ error: 'projeto não encontrado' });
  res.json({ ok: true });
}));

app.delete('/api/projects/:id', h(async (req, res) => {
  await deleteProject(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/projects/:id/duplicate', h(async (req, res) => {
  const p = await duplicateProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'projeto não encontrado' });
  res.json(p);
}));

app.post('/api/projects/:id/upload', upload.array('files', 50), h(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const out = [];
  for (const f of files) {
    const kind = kindFromName(f.originalname, f.mimetype);
    if (!kind) continue;
    const ext = f.originalname.split('.').pop()?.toLowerCase();
    const saved = await saveBuffer(req.params.id, f.buffer, { ext, mime: f.mimetype, sub: 'uploads' });
    out.push({ ...saved, file: undefined, name: f.originalname });
  }
  res.json(out);
}));

app.post('/api/projects/:id/upload-dataurl', h(async (req, res) => {
  const { dataUrl, url } = req.body ?? {};
  const saved = await downloadToProject(req.params.id, String(dataUrl ?? url), 'uploads');
  res.json({ ...saved, file: undefined });
}));

// ---------------- events & jobs ----------------

app.get('/api/events', (req, res) => {
  const projectId = String(req.query.projectId ?? '');
  const off = subscribe(projectId, res);
  req.on('close', off);
});

app.post('/api/generate', h(async (req, res) => {
  const body = req.body as GenerateRequest;
  if (!body?.projectId || !body.nodeId || !body.actionType) return res.status(400).json({ error: 'requisição incompleta' });
  const job = startGeneration(body);
  const { request, ...pub } = job;
  res.json(pub);
}));

app.get('/api/jobs', (req, res) => {
  res.json(listJobs(String(req.query.projectId ?? '')).map(({ request, ...j }) => j));
});

app.get('/api/jobs/:id', (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'job não encontrado' });
  const { request, ...pub } = j;
  res.json(pub);
});

app.post('/api/jobs/:id/cancel', (req, res) => res.json({ ok: cancelJob(req.params.id) }));

app.post('/api/export', h(async (req, res) => {
  const job = await startExport(req.body ?? {});
  res.json(job);
}));

// ---------------- providers ----------------

app.get('/api/providers', h(async (_req, res) => {
  const statuses = await Promise.all(allProviders().map((p) => p.status()));
  res.json({ active: activeProviderId(), providers: statuses, agent: { configured: agentConfigured(), model: OPENAI_MODEL } });
}));

app.put('/api/providers/active', h(async (req, res) => {
  await setActiveProvider(String(req.body?.id));
  res.json({ ok: true, active: activeProviderId() });
}));

app.get('/api/models', h(async (_req, res) => res.json(await activeModels())));

app.post('/api/providers/higgsfield/connect', h(async (_req, res) => {
  try {
    res.json(await higgsfield.beginAuth());
  } catch (err) {
    res.status(502).json({ error: String((err as Error)?.message ?? err) });
  }
}));

app.get(CALLBACK_PATH, h(async (req, res) => {
  const page = (title: string, msg: string) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="background:#121212;color:#d2d2d2;font-family:Jost,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="font-weight:400">${title}</h2><p>${msg}</p></div><script>try{window.opener&&window.opener.postMessage({type:'higgsfield-auth'},'*')}catch(e){};setTimeout(()=>window.close(),1500)</script></body>`;
  if (req.query.error) return res.status(400).send(page('Conexão recusada', String(req.query.error_description ?? req.query.error)));
  const code = String(req.query.code ?? '');
  if (!code) return res.status(400).send(page('Código ausente', 'Tente conectar novamente.'));
  try {
    await higgsfield.finishAuth(code);
    res.send(page('Higgsfield conectado', 'Você já pode fechar esta janela e voltar ao Claquete.'));
  } catch (err) {
    res.status(500).send(page('Falha na conexão', String((err as Error)?.message ?? err)));
  }
}));

app.post('/api/providers/higgsfield/disconnect', h(async (_req, res) => {
  await higgsfield.disconnect(true);
  res.json({ ok: true });
}));

app.get('/api/providers/higgsfield/tools', h(async (_req, res) => {
  await higgsfield.status();
  res.json({ url: HIGGSFIELD_MCP_URL, tools: higgsfield.getTools(), mapping: higgsfield.getMapping(), inferred: higgsfield.inferredMappings() });
}));

app.put('/api/providers/higgsfield/mapping', h(async (req, res) => {
  await higgsfield.setMapping(req.body ?? {});
  res.json({ ok: true, inferred: higgsfield.inferredMappings() });
}));

app.post('/api/providers/higgsfield/test-tool', h(async (req, res) => {
  const { name, args } = req.body ?? {};
  const result = await higgsfield.callTool(String(name), args ?? {}, { timeoutMs: 120_000 });
  res.json(result);
}));

// ---------------- agent ----------------

app.post('/api/agent/chat', h(async (req, res) => runAgent(req.body, res)));

app.post('/api/agent/tool-result', (req, res) => {
  const { runId, callId, result } = req.body ?? {};
  res.json({ ok: deliverToolResult(String(runId), String(callId), result ?? { ok: false, error: 'sem resultado' }) });
});

app.post('/api/agent/cancel', (req, res) => res.json({ ok: cancelRun(String(req.body?.runId)) }));

app.get('/api/agent/threads', h(async (req, res) => res.json(await listThreads(String(req.query.projectId)))));

app.get('/api/agent/threads/:threadId', h(async (req, res) => {
  const t = await getThread(String(req.query.projectId), req.params.threadId);
  if (!t) return res.status(404).json({ error: 'conversa não encontrada' });
  res.json(t);
}));

app.delete('/api/agent/threads/:threadId', h(async (req, res) => {
  await deleteThread(String(req.query.projectId), req.params.threadId);
  res.json({ ok: true });
}));

// ---------------- static ----------------

app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', fallthrough: false }));

if (IS_PROD && fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[api]', err);
  if (!res.headersSent) res.status(status).json({ error: err.message ?? 'erro interno' });
});

await ensureDirs();
await initProviders();
app.listen(PORT, () => {
  console.log(`Claquete API em http://localhost:${PORT} · provedor de geração: ${activeProviderId()} · agente: ${agentConfigured() ? OPENAI_MODEL : 'sem OPENAI_API_KEY'}`);
});
