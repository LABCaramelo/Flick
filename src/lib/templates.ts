import { uid } from '../../shared/project';
import type { MediaNode, Project, TextNode } from '../../shared/types';

// Quick-start entries on the home screen. Prompted ones hand the text to the
// agent; template ones seed the canvas (like the onboarding workflows found
// in the original bundle: "Generate your first image", "Examples", ...).

export const TEMPLATES = [
  { id: 'script', label: 'Do roteiro ao filme', name: 'Do roteiro ao filme', prompt: 'Quero transformar um roteiro em filme. Me ajude a estruturar: peça o roteiro (ou proponha um curto), faça a decupagem em cenas e planos e prepare o storyboard.' },
  { id: 'prompt', label: 'Do prompt ao filme', name: 'Do prompt ao filme', prompt: 'Quero ir de uma ideia curta a um filme de 30 segundos. Proponha 3 conceitos diferentes e me deixe escolher.' },
  { id: 'chars', label: 'Criar personagens', name: 'Personagens', prompt: 'Vamos criar os personagens do meu filme. Faça perguntas rápidas sobre o tom e gere fichas de personagem (model sheets) consistentes.' },
  { id: 'style', label: 'Começar a partir de um estilo', name: 'Exploração de estilo', prompt: 'Quero começar definindo o visual do filme. Gere 4 frames de teste em estilos bem diferentes para o mesmo momento e me deixe escolher um para travar como estilo do projeto.' },
  { id: 'blank', label: 'Tela em branco', name: 'Sem título', prompt: '' },
  { id: 'tour', label: 'Tour guiado', name: 'Tour guiado', prompt: '', template: 'tour' },
] as { id: string; label: string; name: string; prompt: string; template?: string }[];

function note(content: string, x: number, y: number, color: TextNode['data']['color'] = 'yellow'): TextNode {
  return { id: uid(), type: 'text', position: { x, y }, data: { color, content, dimensions: { width: 300, height: 200 } } };
}

export function applyTemplate(id: string, p: Project) {
  if (id !== 'tour') return;
  const n1 = note('# 1. Gere uma imagem\n\n- Clique no nó ao lado\n- Escreva um prompt\n- Aperte **Gerar**', 0, 0);
  const img: MediaNode = {
    id: uid(),
    type: 'image',
    position: { x: 360, y: 0 },
    data: {
      status: 'idle',
      user_input_title: 'Primeira imagem',
      generationSettings: { actionType: 'Image', inputs: { model: 'nano-banana-pro', prompt: 'A lone figure on an empty night train platform, wet concrete reflecting sodium lights, wide shot, 35mm, cinematic noir', aspect_ratio: '16:9' } },
    },
  };
  const n2 = note('# 2. Anime em vídeo\n\n- Selecione a imagem pronta\n- Clique em **Vídeo** no menu lateral\n- Descreva o movimento de câmera', 0, 300, 'blue');
  const vid: MediaNode = {
    id: uid(),
    type: 'video',
    position: { x: 820, y: 0 },
    data: { status: 'idle', user_input_title: 'Primeiro plano', generationSettings: { actionType: 'ImageToVideo', inputs: { model: 'kling-3.0', prompt: 'Slow dolly in toward the figure, light rain begins to fall, distant train horn', duration: '5' } } },
  };
  const n3 = note('# 3. Monte e exporte\n\n- Selecione o vídeo → **Adicionar à Linha do Tempo**\n- Abra o **Editor de Vídeo** e exporte\n\nOu peça tudo ao agente no painel à direita.', 0, 560, 'green');
  for (const n of [n1, img, n2, vid, n3]) p.nodes[n.id] = n;
  p.edges.push({ id: uid(), source: img.id, target: vid.id, data: { mediaInputId: 'startFrame' } });
}
