import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Copy, Ellipsis, Mic, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import type { ProjectSummary } from '../../shared/types';
import { STYLE_PRESETS } from '../../shared/styles';
import { ASPECT_RATIOS } from '../../shared/actions';
import { api } from '../lib/api';
import { Brand } from '../components/ui/Brand';
import { Dropdown, Popover, anchorBelow, type Anchor } from '../components/ui/Menu';
import { ProviderPill } from '../components/settings/ProviderPill';
import { useUi, toast } from '../store/ui';
import { useSpeech } from '../lib/speech';
import { TEMPLATES, applyTemplate } from '../lib/templates';
import './home.css';

const PLACEHOLDERS = [
  'Um curta-metragem sobre um soldado que volta para casa…',
  'Um trailer de terror numa estação de trem abandonada…',
  'Um videoclipe em animação pintada sobre o verão…',
  'Uma propaganda de 30s para um café artesanal…',
  'Uma fábula em massinha sobre uma raposa curiosa…',
];

export const PENDING_PROMPT_KEY = 'claquete.pendingHomePrompt';

function relDate(iso: string) {
  const d = new Date(iso);
  return `Editado ${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function Home() {
  const nav = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [ph, setPh] = useState(0);
  const [style, setStyle] = useState<string>('');
  const [aspect, setAspect] = useState('16:9');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ anchor: Anchor; p: ProjectSummary } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech((text) => setPrompt((p) => (p ? `${p} ${text}` : text)));

  const load = () => api.listProjects().then(setProjects).catch((e) => toast(String(e.message), 'error'));
  useEffect(() => {
    load();
    const t = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 3500);
    return () => clearInterval(t);
  }, []);

  async function start(text: string, name?: string, template?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const p = await api.createProject(name ?? (text ? text.slice(0, 40) : 'Sem título'));
      p.projectSettings.aspectRatio = aspect;
      p.projectSettings.styleId = style || null;
      if (template) applyTemplate(template, p);
      await api.saveProject(p);
      if (text) sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ projectId: p.projectId, text }));
      nav(`/canvas/${p.projectId}`);
    } catch (e) {
      toast(String((e as Error).message), 'error');
      setBusy(false);
    }
  }

  const list = projects ?? [];
  const shown = showAll ? list : list.slice(0, 8);

  return (
    <div className="home">
      <header className="topbar">
        <div className="topbar-left">
          <Brand />
        </div>
        <nav className="tabs">
          <button className={`tab ${!showAll ? 'active' : ''}`} onClick={() => setShowAll(false)}>
            Início {!showAll && <span className="dot" />}
          </button>
          <button className={`tab ${showAll ? 'active' : ''}`} onClick={() => setShowAll(true)}>
            Área de trabalho
          </button>
        </nav>
        <div className="topbar-right">
          <ProviderPill />
          <button className="icon-btn" title="Configurações" onClick={() => useUi.getState().setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => start('', 'Sem título')}>
            <Plus size={13} /> Criar
          </button>
        </div>
      </header>

      <main className="home-main">
        {!showAll && (
          <section className="hero">
            <h1>Que história você quer criar hoje?</h1>
            <p className="muted">Peça ao agente qualquer coisa.</p>
            <div className="hero-box">
              <textarea
                ref={taRef}
                value={prompt}
                placeholder={PLACEHOLDERS[ph]}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim()) start(prompt.trim());
                  }
                }}
              />
              <div className="hero-box-bar">
                <div className="row">
                  <Dropdown
                    value={style}
                    title="Estilo"
                    options={[{ value: '', label: 'Sem estilo' }, ...STYLE_PRESETS.map((s) => ({ value: s.id, label: s.name, description: s.prompt.slice(0, 70) + '…' }))]}
                    onChange={setStyle}
                    renderLabel={(v) => (v ? STYLE_PRESETS.find((s) => s.id === v)?.name : 'SEM ESTILO')}
                  />
                  <Dropdown value={aspect} title="Proporção" options={ASPECT_RATIOS.map((a) => ({ value: a, label: a }))} onChange={setAspect} />
                </div>
                <div className="row">
                  {speech.supported && (
                    <button className={`icon-btn ${speech.listening ? 'active' : ''}`} title="Falar" onClick={speech.toggle}>
                      <Mic size={15} />
                    </button>
                  )}
                  <button className="send-btn" disabled={!prompt.trim() || busy} onClick={() => start(prompt.trim())} title="Começar">
                    <ArrowUp size={16} />
                  </button>
                </div>
              </div>
            </div>
            <div className="quick">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="chip chip-round" onClick={() => start(t.prompt, t.name, t.template)} disabled={busy}>
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="projects">
          <div className="projects-head">
            <span>{showAll ? 'Todos os projetos' : 'Projetos recentes'}</span>
            {!showAll && list.length > 8 && (
              <button className="link" onClick={() => setShowAll(true)}>
                Todos os projetos →
              </button>
            )}
          </div>
          {projects === null ? (
            <div className="muted" style={{ padding: 20 }}>
              Carregando…
            </div>
          ) : !list.length ? (
            <div className="muted" style={{ padding: 20 }}>
              Nenhum projeto ainda. Descreva uma ideia acima ou comece com uma tela em branco.
            </div>
          ) : (
            <div className="project-grid">
              {shown.map((p) => (
                <article key={p.projectId} className="project-card" onClick={() => nav(`/canvas/${p.projectId}`)}>
                  <div className="thumb">
                    {p.thumbnail ? (
                      /\.(mp4|webm|mov)$/i.test(p.thumbnail) ? <video src={p.thumbnail} muted /> : <img src={p.thumbnail} alt={p.name} loading="lazy" />
                    ) : (
                      <div className="thumb-empty" />
                    )}
                  </div>
                  <div className="meta">
                    <div>
                      <h3>{p.name}</h3>
                      <small>{relDate(p.lastSaved)}</small>
                    </div>
                    <button
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ anchor: anchorBelow(e.currentTarget, 'end'), p });
                      }}
                    >
                      <Ellipsis size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)}>
          <button
            className="menu-item"
            onClick={async () => {
              const name = window.prompt('Novo nome', menu.p.name);
              setMenu(null);
              if (name) {
                await api.renameProject(menu.p.projectId, name);
                load();
              }
            }}
          >
            <Pencil size={14} /> Renomear
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              setMenu(null);
              await api.duplicateProject(menu.p.projectId);
              load();
            }}
          >
            <Copy size={14} /> Duplicar
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item btn-danger"
            onClick={async () => {
              const p = menu.p;
              setMenu(null);
              if (!window.confirm(`Excluir "${p.name}" e todas as suas mídias?`)) return;
              await api.deleteProject(p.projectId);
              load();
            }}
          >
            <Trash2 size={14} /> Excluir
          </button>
        </Popover>
      )}
    </div>
  );
}
