import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Quote, Sparkles, Wand2 } from 'lucide-react';
import { useProject } from '../../store/project';
import { askAgent } from '../../lib/events';
import './story.css';

interface Heading {
  level: number;
  text: string;
  pos: number;
}

export function StoryView() {
  const doc = useProject((s) => s.project?.story.doc);
  const memory = useProject((s) => s.project?.story.memory ?? '');
  const update = useProject((s) => s.update);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [mem, setMem] = useState(memory);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const internal = useRef(false);

  useEffect(() => setMem(memory), [memory]);

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: 'Escreva a história, o roteiro ou a decupagem… Use # para cenas e ## para planos.' })],
    content: (doc as object) ?? '',
    onUpdate: ({ editor: ed }) => {
      collectHeadings(ed.state.doc);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        internal.current = true;
        update(
          (d) => {
            d.story.doc = ed.getJSON() as never;
          },
          { record: false },
        );
      }, 400);
    },
    onCreate: ({ editor: ed }) => collectHeadings(ed.state.doc),
  });

  function collectHeadings(pm: { descendants: (fn: (n: { type: { name: string }; attrs: { level?: number }; textContent: string }, pos: number) => void) => void }) {
    const out: Heading[] = [];
    pm.descendants((n, pos) => {
      if (n.type.name === 'heading') out.push({ level: n.attrs.level ?? 1, text: n.textContent, pos });
    });
    setHeadings(out);
  }

  // content written by the agent (or undo) arrives through the store
  useEffect(() => {
    if (!editor) return;
    if (internal.current) {
      internal.current = false;
      return;
    }
    const current = JSON.stringify(editor.getJSON());
    if (doc && JSON.stringify(doc) !== current) {
      editor.commands.setContent(doc as object, false);
      collectHeadings(editor.state.doc);
    }
  }, [doc, editor]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const commitMemory = () => {
    if (mem !== memory)
      update((d) => {
        d.story.memory = mem;
      });
  };

  const tools = useMemo(
    () =>
      editor
        ? [
            { icon: Heading1, title: 'Cena (H1)', on: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
            { icon: Heading2, title: 'Plano (H2)', on: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
            { icon: Heading3, title: 'Subtítulo (H3)', on: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
            { icon: Bold, title: 'Negrito', on: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
            { icon: Italic, title: 'Itálico', on: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
            { icon: List, title: 'Lista', on: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
            { icon: ListOrdered, title: 'Lista numerada', on: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
            { icon: Quote, title: 'Citação / diálogo', on: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
          ]
        : [],
    [editor, editor?.state],
  );

  return (
    <div className="story">
      <aside className="story-outline">
        <div className="label" style={{ padding: '0 10px 8px' }}>
          Sumário
        </div>
        {headings.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '0 10px' }}>Os títulos aparecem aqui.</div>}
        {headings.map((h, i) => (
          <button
            key={i}
            className={`outline-item lvl-${h.level}`}
            onClick={() => {
              editor?.chain().focus().setTextSelection(h.pos + 1).run();
              const dom = editor?.view.domAtPos(h.pos + 1).node as HTMLElement | undefined;
              (dom?.nodeType === 1 ? dom : dom?.parentElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            {h.text || '(sem título)'}
          </button>
        ))}
      </aside>

      <div className="story-scroll">
        <div className="story-col">
          <section className="memory-card">
            <div className="memory-head">
              <span className="label">Memória do projeto</span>
              <span className="muted" style={{ fontSize: 11 }}>Regras de estilo, personagens e decisões. Entra em toda geração quando a consistência visual está travada (cadeado no topo).</span>
            </div>
            <textarea value={mem} onChange={(e) => setMem(e.target.value)} onBlur={commitMemory} placeholder="Ex.: VISUAL STYLE LOCK — animação pintada 2D/3D, luz quente de fim de tarde, sombras violeta…" />
          </section>

          <div className="story-toolbar">
            {tools.map(({ icon: Icon, title, on, active }) => (
              <button key={title} className={`icon-btn ${active ? 'active' : ''}`} title={title} onClick={on}>
                <Icon size={15} />
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => askAgent('Leia a História e escreva/refine o roteiro com cenas (#) e planos (##), mantendo o tom.')}>
              <Wand2 size={12} /> Refinar roteiro
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => askAgent('Transforme a História em decupagem no canvas: uma seção por cena, uma nota com os planos e os quadros-chave de cada plano.')}>
              <Sparkles size={12} /> Levar para a Tela
            </button>
          </div>

          <EditorContent editor={editor} className="story-editor" />
        </div>
      </div>
    </div>
  );
}
