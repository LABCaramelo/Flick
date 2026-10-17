import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Lock, Redo2, Settings, Undo2, Unlock } from 'lucide-react';
import { STYLE_PRESETS } from '../../shared/styles';
import { ASPECT_RATIOS } from '../../shared/actions';
import { useProject, type View } from '../store/project';
import { useUi } from '../store/ui';
import { api } from '../lib/api';
import { Brand } from './ui/Brand';
import { Dropdown } from './ui/Menu';
import { ProviderPill } from './settings/ProviderPill';

const TABS: { id: View; label: string }[] = [
  { id: 'story', label: 'História' },
  { id: 'canvas', label: 'Tela' },
  { id: 'stage', label: 'Set 3D' },
  { id: 'editor', label: 'Editor de Vídeo' },
];

export function TopBar({ view }: { view: View }) {
  const [, setParams] = useSearchParams();
  const name = useProject((s) => s.project?.name ?? '');
  const projectId = useProject((s) => s.project?.projectId ?? '');
  const saveState = useProject((s) => s.saveState);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const settings = useProject((s) => s.project?.projectSettings);
  const customStyles = useProject((s) => s.project?.customStyles ?? []);
  const update = useProject((s) => s.update);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  const commitName = () => {
    const n = draft.trim();
    if (!n || n === name) return setDraft(name);
    update((d) => {
      d.name = n;
    });
    api.renameProject(projectId, n).catch(() => undefined);
    document.title = `${n} — Claquete`;
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Brand compact />
        <input className="project-name" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} title="Nome do projeto" />
        <span className="muted hide-narrow" style={{ fontSize: 11 }}>
          {saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? 'Salvo' : saveState === 'error' ? 'Erro ao salvar' : ''}
        </span>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${view === t.id ? 'active' : ''}`} onClick={() => setParams(t.id === 'canvas' ? {} : { view: t.id })}>
            {t.label} {view === t.id && <span className="dot" />}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <button className="icon-btn" disabled={!canUndo} onClick={() => useProject.getState().undo()} title="Desfazer (Ctrl+Z)">
          <Undo2 size={15} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => useProject.getState().redo()} title="Refazer (Ctrl+Shift+Z)">
          <Redo2 size={15} />
        </button>
        {settings && (
          <span className="hide-narrow row">
            <Dropdown
              value={settings.aspectRatio}
              title="Proporção do projeto"
              options={ASPECT_RATIOS.map((a) => ({ value: a, label: a }))}
              onChange={(v) =>
                update((d) => {
                  d.projectSettings.aspectRatio = v;
                })
              }
              width={160}
            />
            <Dropdown
              value={settings.styleId ?? ''}
              title="Estilo do projeto"
              options={[
                { value: '', label: 'Sem estilo' },
                ...customStyles.map((s) => ({ value: s.id, label: `${s.name} (salvo)`, description: s.prompt.slice(0, 80) })),
                ...STYLE_PRESETS.map((s) => ({ value: s.id, label: s.name, description: s.prompt.slice(0, 80) + '…' })),
              ]}
              renderLabel={(v) => (v ? (customStyles.find((s) => s.id === v) ?? STYLE_PRESETS.find((s) => s.id === v))?.name ?? 'Estilo' : 'SEM ESTILO')}
              onChange={(v) =>
                update((d) => {
                  d.projectSettings.styleId = v || null;
                })
              }
              width={300}
            />
            <button
              className={`icon-btn ${settings.styleLock ? 'active' : ''}`}
              title={settings.styleLock ? 'Consistência visual travada: a memória do projeto entra em toda geração' : 'Mantenha sua consistência visual (aplica a memória do projeto em toda geração)'}
              onClick={() =>
                update((d) => {
                  d.projectSettings.styleLock = !d.projectSettings.styleLock;
                })
              }
            >
              {settings.styleLock ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          </span>
        )}
        <ProviderPill />
        <button className="icon-btn" title="Configurações" onClick={() => useUi.getState().setSettingsOpen(true)}>
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
