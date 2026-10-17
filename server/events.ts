import type { Response } from 'express';

// Server-sent events hub: one stream per open project tab.

type Client = { res: Response; projectId: string };

const clients = new Set<Client>();

export function subscribe(projectId: string, res: Response): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: {}\n\n`);
  const client = { res, projectId };
  clients.add(client);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  return () => {
    clearInterval(ping);
    clients.delete(client);
  };
}

export function broadcast(projectId: string | '*', event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (projectId === '*' || c.projectId === projectId) c.res.write(payload);
  }
}
