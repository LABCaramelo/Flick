import { useEffect, useState } from 'react';
import { CircleAlert, Plug, PlugZap, RefreshCw, X } from 'lucide-react';
import { ACTIONS } from '../../../shared/actions';
import type { ActionType } from '../../../shared/types';
import { api, type HiggsfieldTools } from '../../lib/api';
import { useProviders } from '../../store/providers';
import { toast, useUi } from '../../store/ui';
import './settings.css';

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen);
  const close = () => useUi.getState().setSettingsOpen(false);
  const info = useProviders((s) => s.info);
  const refresh = useProviders((s) => s.refresh);
  const [hf, setHf] = useState<HiggsfieldTools | null>(null);
  const [busy, setBusy] = useState(false);
  const [mappingText, setMappingText] = useState('');
  const [testTool, setTestTool] = useState('');
  const [testArgs, setTestArgs] = useState('{}');
  const [testOut, setTestOut] = useState('');

  const loadHf = async () => {
    try {
      const t = await api.higgsfieldTools();
      setHf(t);
      setMappingText(JSON.stringify(t.mapping ?? {}, null, 2));
    } catch {
      setHf(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    loadHf();
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'higgsfield-auth') {
        refresh();
        loadHf();
        toast('Higgsfield conectado.');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open]);

  if (!open) return null;
  const higgs = info?.providers.find((p) => p.id === 'higgsfield');

  async function connect() {
    setBusy(true);
    try {
      const r = await api.higgsfieldConnect();
      if (r.connected) {
        toast('Higgsfield conectado.');
        await refresh();
        await loadHf();
      } else if (r.authUrl) {
        window.open(r.authUrl, 'higgsfield-auth', 'width=520,height=720');
        toast('Conclua o login do Higgsfield na janela aberta.');
      }
    } catch (e) {
      toast(String((e as Error).message), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setOverride(action: ActionType, tool: string) {
    const current = (() => {
      try {
        return JSON.parse(mappingText || '{}');
      } catch {
        return {};
      }
    })();
    current.actions ??= {};
    if (!tool) delete current.actions[action];
    else current.actions[action] = { tool, args: hf?.inferred[action]?.tool === tool ? hf.inferred[action]!.args : {} };
    setMappingText(JSON.stringify(current, null, 2));
    await api.higgsfieldSetMapping(current);
    await loadHf();
  }

  async function saveMapping() {
    try {
      const parsed = JSON.parse(mappingText || '{}');
      await api.higgsfieldSetMapping(parsed);
      await loadHf();
      toast('Mapeamento salvo.');
    } catch (e) {
      toast(`JSON inválido: ${(e as Error).message}`, 'error');
    }
  }

  async function runTest() {
    try {
      setTestOut('…');
      const out = await api.higgsfieldTestTool(testTool, JSON.parse(testArgs || '{}'));
      setTestOut(JSON.stringify(out, null, 2));
    } catch (e) {
      setTestOut(String((e as Error).message));
    }
  }

  return (
    <div className="modal-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings">
        <div className="modal-head">
          <h2>Configurações</h2>
          <button className="icon-btn" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <h3 className="settings-h">Geração de mídia</h3>
          <div className="provider-choice">
            {info?.providers.map((p) => (
              <label key={p.id} className={`provider-card ${info.active === p.id ? 'on' : ''}`}>
                <input
                  type="radio"
                  name="provider"
                  checked={info.active === p.id}
                  onChange={async () => {
                    await api.setProvider(p.id);
                    await refresh();
                  }}
                />
                <div>
                  <div className="provider-name">
                    {p.name} <span className={`dot ${p.connected ? 'ok' : 'off'}`} style={{ background: p.connected ? 'var(--success)' : 'var(--warning)' }} />
                  </div>
                  <small className="muted">{p.id === 'higgsfield' ? (p.connected ? `Conectado · ${p.tools?.length ?? 0} ferramentas` : 'Desconectado') : p.detail}</small>
                </div>
              </label>
            ))}
          </div>

          <div className="hf-box">
            <div className="hf-row">
              <div>
                <div className="provider-name">Higgsfield MCP</div>
                <small className="muted mono">{hf?.url ?? higgs?.detail}</small>
                {higgs?.error && !higgs.connected && (
                  <div className="warn">
                    <CircleAlert size={13} /> {higgs.error}
                  </div>
                )}
              </div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => (refresh(), loadHf())} title="Atualizar">
                  <RefreshCw size={12} />
                </button>
                {higgs?.connected ? (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      await api.higgsfieldDisconnect();
                      await refresh();
                      await loadHf();
                    }}
                  >
                    <Plug size={12} /> Desconectar
                  </button>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={connect}>
                    <PlugZap size={12} /> Conectar conta
                  </button>
                )}
              </div>
            </div>

            {higgs?.connected && hf && (
              <>
                <h4 className="label" style={{ marginTop: 16 }}>
                  Ação → ferramenta do MCP
                </h4>
                <table className="map-table">
                  <tbody>
                    {(Object.keys(ACTIONS) as ActionType[]).map((a) => {
                      const override = (hf.mapping as { actions?: Record<string, { tool: string }> }).actions?.[a]?.tool ?? '';
                      const inferred = hf.inferred[a];
                      return (
                        <tr key={a}>
                          <td>{ACTIONS[a].name}</td>
                          <td>
                            <select className="select" value={override} onChange={(e) => setOverride(a, e.target.value)}>
                              <option value="">Automático{inferred ? ` (${inferred.tool})` : ' (nenhuma)'}</option>
                              {hf.tools.map((t) => (
                                <option key={t.name} value={t.name}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <details style={{ marginTop: 14 }}>
                  <summary className="label">Ferramentas disponíveis ({hf.tools.length})</summary>
                  <div className="tool-list">
                    {hf.tools.map((t) => (
                      <div key={t.name} className="tool-item">
                        <b className="mono">{t.name}</b>
                        <p className="muted">{t.description}</p>
                        <pre>{JSON.stringify(t.inputSchema, null, 1).slice(0, 1600)}</pre>
                      </div>
                    ))}
                  </div>
                </details>

                <details style={{ marginTop: 10 }}>
                  <summary className="label">Mapeamento avançado (JSON)</summary>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Modelos de argumentos: <code>{'{{prompt}}'}</code>, <code>{'{{model}}'}</code>, <code>{'{{aspect_ratio}}'}</code>, <code>{'{{duration}}'}</code>, entradas como <code>{'{{startFrame}}'}</code> ou listas <code>{'{{referenceImages[]}}'}</code>. Também aceita <code>statusTool</code>, <code>uploadTool</code> e <code>modelsTool</code>.
                  </p>
                  <textarea className="textarea mono" rows={10} value={mappingText} onChange={(e) => setMappingText(e.target.value)} />
                  <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={saveMapping}>
                    Salvar mapeamento
                  </button>
                  <h4 className="label" style={{ marginTop: 14 }}>
                    Mapeamento em uso
                  </h4>
                  <pre className="mono small-pre">{JSON.stringify(hf.inferred, null, 1)}</pre>
                </details>

                <details style={{ marginTop: 10 }}>
                  <summary className="label">Testar ferramenta</summary>
                  <div className="row" style={{ marginTop: 8 }}>
                    <select className="select" value={testTool} onChange={(e) => setTestTool(e.target.value)}>
                      <option value="">Escolha…</option>
                      {hf.tools.map((t) => (
                        <option key={t.name}>{t.name}</option>
                      ))}
                    </select>
                    <button className="btn btn-sm" disabled={!testTool} onClick={runTest}>
                      Executar
                    </button>
                  </div>
                  <textarea className="textarea mono" rows={4} value={testArgs} onChange={(e) => setTestArgs(e.target.value)} style={{ marginTop: 6 }} />
                  {testOut && <pre className="mono small-pre">{testOut}</pre>}
                  <p className="muted" style={{ fontSize: 11 }}>
                    Atenção: ferramentas de geração consomem créditos da sua conta Higgsfield.
                  </p>
                </details>
              </>
            )}
          </div>

          <h3 className="settings-h">Agente (OpenAI)</h3>
          <div className="hf-box">
            {info?.agent.configured ? (
              <div>
                <span className="dot" style={{ background: 'var(--success)' }} /> Configurado · modelo <span className="mono">{info.agent.model}</span>
              </div>
            ) : (
              <div className="warn">
                <CircleAlert size={13} /> Defina <span className="mono">OPENAI_API_KEY</span> (e opcionalmente <span className="mono">OPENAI_MODEL</span>) no arquivo <span className="mono">.env</span> e reinicie o servidor.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
