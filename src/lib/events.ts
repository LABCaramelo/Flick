// Tiny app-wide event helpers.

export function askAgent(text: string) {
  window.dispatchEvent(new CustomEvent('claquete:agent-send', { detail: { text } }));
}

export function onAskAgent(fn: (text: string) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<{ text: string }>).detail.text);
  window.addEventListener('claquete:agent-send', h);
  return () => window.removeEventListener('claquete:agent-send', h);
}
