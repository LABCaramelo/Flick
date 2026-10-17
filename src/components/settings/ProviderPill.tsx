import { useEffect } from 'react';
import { useProviders } from '../../store/providers';
import { useUi } from '../../store/ui';

const LABELS: Record<string, [string, string]> = {
  'higgsfield-api': ['Higgsfield API', 'Configurar Higgsfield API'],
  higgsfield: ['Higgsfield MCP', 'Conectar Higgsfield MCP'],
  mock: ['Offline (simulado)', 'Offline (simulado)'],
};

export function ProviderPill() {
  const info = useProviders((s) => s.info);
  const refresh = useProviders((s) => s.refresh);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 45_000);
    return () => clearInterval(t);
  }, [refresh]);

  const active = info?.providers.find((p) => p.id === info.active);
  const ok = !!active?.connected;
  const [on, off] = LABELS[info?.active ?? ''] ?? ['Provedor', 'Configurar provedor'];
  const label = !info ? 'Servidor offline' : ok ? on : off;
  return (
    <button className="status-pill" onClick={() => useUi.getState().setSettingsOpen(true)} title={active?.error ?? active?.detail ?? ''}>
      <span className={`dot ${ok ? 'ok' : 'off'}`} />
      {label}
    </button>
  );
}
