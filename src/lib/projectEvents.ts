import { labAuthorization } from './labAccess';

/** Fetch supports Bearer headers without putting credentials into an EventSource URL. */
export function subscribeProjectEvents(projectId: string, receive: (event: string, data: unknown) => void): () => void {
  const controller = new AbortController();
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    try {
      const headers = await labAuthorization();
      if (controller.signal.aborted) return;
      const response = await fetch(`/api/events?projectId=${encodeURIComponent(projectId)}`, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok || !response.body) throw new Error('Não foi possível abrir os eventos do projeto.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done || controller.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        // Refuse malformed/unbounded streams instead of retaining another document.
        if (buffer.length > 2_000_000) throw new Error('Evento muito grande.');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message';
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (data && !controller.signal.aborted) receive(event, JSON.parse(data));
        }
      }
    } catch { /* A disconnected stream can resume after the server/network returns. */ }
    if (!controller.signal.aborted) retry = setTimeout(() => void connect(), 3000);
  };
  void connect();
  return () => { controller.abort(); clearTimeout(retry); };
}
