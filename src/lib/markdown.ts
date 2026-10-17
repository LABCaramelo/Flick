// Minimal markdown <-> ProseMirror (TipTap StarterKit schema) conversion for
// the Story document: headings, paragraphs, bullet/ordered lists, quotes,
// rules, bold/italic/code marks.

type Mark = { type: 'bold' | 'italic' | 'code' };
type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: Mark[] };

function inline(text: string): PMNode[] {
  const out: PMNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[2] || m[3]) out.push({ type: 'text', text: m[2] ?? m[3], marks: [{ type: 'bold' }] });
    else if (m[4] || m[5]) out.push({ type: 'text', text: m[4] ?? m[5], marks: [{ type: 'italic' }] });
    else if (m[6]) out.push({ type: 'text', text: m[6], marks: [{ type: 'code' }] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((n) => n.text);
}

const para = (text: string): PMNode => {
  const c = inline(text);
  return c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' };
};

export function markdownToDoc(md: string): PMNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const content: PMNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      content.push({ type: 'heading', attrs: { level: Math.min(3, h[1].length) }, content: inline(h[2]) });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      content.push({ type: 'blockquote', content: buf.map(para) });
      continue;
    }
    const ul = /^\s*[-*+]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: PMNode[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push({ type: 'listItem', content: [para(lines[i].replace(re, ''))] });
        i++;
      }
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|-{3,})/.test(lines[i])) buf.push(lines[i++]);
    content.push(para(buf.join(' ')));
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function inlineToMd(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '\n';
      let t = n.text ?? '';
      for (const m of n.marks ?? []) t = m.type === 'bold' ? `**${t}**` : m.type === 'italic' ? `*${t}*` : m.type === 'code' ? `\`${t}\`` : t;
      return t;
    })
    .join('');
}

export function docToMarkdown(doc: unknown): string {
  const d = doc as PMNode | null;
  if (!d?.content) return '';
  const out: string[] = [];
  for (const b of d.content) {
    if (b.type === 'heading') out.push(`${'#'.repeat(Number(b.attrs?.level ?? 1))} ${inlineToMd(b.content)}`);
    else if (b.type === 'paragraph') out.push(inlineToMd(b.content));
    else if (b.type === 'bulletList' || b.type === 'orderedList')
      out.push((b.content ?? []).map((li, i) => `${b.type === 'orderedList' ? `${i + 1}.` : '-'} ${(li.content ?? []).map((p) => inlineToMd(p.content)).join(' ')}`).join('\n'));
    else if (b.type === 'blockquote') out.push((b.content ?? []).map((p) => `> ${inlineToMd(p.content)}`).join('\n'));
    else if (b.type === 'horizontalRule') out.push('---');
    else if (b.type === 'codeBlock') out.push('```\n' + inlineToMd(b.content) + '\n```');
  }
  return out.join('\n\n');
}

export function appendMarkdown(doc: unknown, md: string): PMNode {
  const base = (doc as PMNode | null)?.content ?? [];
  const add = markdownToDoc(md).content ?? [];
  const cleaned = base.filter((n, i) => !(i === base.length - 1 && n.type === 'paragraph' && !n.content?.length));
  return { type: 'doc', content: [...cleaned, ...add] };
}
