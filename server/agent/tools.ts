import type OpenAI from 'openai';
import { ACTIONS } from '../../shared/actions';

// Function-calling surface of the agent. Names follow the tool names found
// in flick.art's client (generate_images, image_edit, image_to_video,
// create_section, organize_nodes, get_canvas_state, timeline_*, ...).

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

const str = (description: string) => ({ type: 'string', description });
const strArr = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const GENERATION_TOOLS = new Set(['generate_images', 'image_edit', 'image_to_video', 'run_action', 'generate_dialog', 'generate_music']);
/** handled by the server itself, never sent to the client */
export const SERVER_TOOLS = new Set(['suggest_next_steps', 'let_user_choose']);

export const AGENT_TOOLS: Tool[] = [
  fn('get_canvas_state', 'Lê o estado atual do canvas: nós (id, tipo, título, prompt, status), seções, conexões, linha do tempo e memória do projeto.', {}),
  fn(
    'create_text_node',
    'Cria uma nota de texto no canvas (roteiro, sinopse, lista de planos, notas de direção). Aceita markdown.',
    { content: str('Conteúdo em markdown'), title: str('Título curto'), color: { type: 'string', enum: ['yellow', 'blue', 'pink', 'white', 'green', 'orange'] }, section_id: str('Seção onde colocar (opcional)') },
    ['content'],
  ),
  fn('edit_text_node', 'Substitui o conteúdo de uma nota de texto existente.', { node_id: str('id da nota'), content: str('Novo conteúdo em markdown') }, ['node_id', 'content']),
  fn('create_section', 'Cria uma seção (ex.: uma cena "S01 - Abertura") e opcionalmente move nós para dentro dela.', { label: str('Nome da seção'), node_ids: strArr('Nós a agrupar') }, ['label']),
  fn(
    'generate_images',
    'Cria nós de imagem e gera cada um. Use para storyboards, personagens, cenários e quadros-chave. Um item por imagem distinta.',
    {
      images: {
        type: 'array',
        description: 'Imagens a gerar',
        items: {
          type: 'object',
          properties: {
            prompt: str('Prompt visual detalhado em inglês: sujeito, ação, enquadramento, lente, luz, cor'),
            title: str('Título curto em português'),
            reference_node_ids: strArr('Imagens do canvas usadas como referência (consistência de personagem/cenário)'),
          },
          required: ['prompt'],
          additionalProperties: false,
        },
      },
      model: str('id do modelo (opcional; padrão do sistema)'),
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
      section_id: str('Seção destino (opcional)'),
    },
    ['images'],
  ),
  fn(
    'image_edit',
    'Edita ou combina imagens existentes com um prompt (troca de roupa, expressão, iluminação, combinar personagem e cenário).',
    { source_node_ids: strArr('Imagens de entrada'), prompt: str('Instrução de edição em inglês'), title: str('Título'), model: str('Modelo opcional') },
    ['source_node_ids', 'prompt'],
  ),
  fn(
    'image_to_video',
    'Anima um quadro em vídeo. Opcionalmente com quadro final para controlar o movimento.',
    {
      start_frame_node_id: str('Imagem do quadro inicial'),
      end_frame_node_id: str('Imagem do quadro final (opcional)'),
      prompt: str('Movimento de câmera, ação e som, em inglês'),
      duration: { type: 'string', enum: ['4', '5', '6', '8', '10', '15'] },
      title: str('Título'),
      model: str('Modelo opcional'),
    },
    ['start_frame_node_id', 'prompt'],
  ),
  fn(
    'run_action',
    `Executa qualquer ação de geração do canvas. Tipos: ${Object.values(ACTIONS)
      .map((a) => `${a.id} (${a.description}; entradas: ${a.mediaInputs.map((m) => m.id).join(', ') || 'nenhuma'})`)
      .join('; ')}.`,
    {
      action_type: { type: 'string', enum: Object.keys(ACTIONS) },
      prompt: str('Prompt (quando a ação usa)'),
      inputs: { type: 'object', description: 'mapa entradaId -> lista de ids de nós', additionalProperties: { type: 'array', items: { type: 'string' } } },
      model: str('Modelo opcional'),
      settings: { type: 'object', description: 'Configurações extras (aspect_ratio, duration, resolution...)', additionalProperties: true },
      title: str('Título'),
    },
    ['action_type'],
  ),
  fn('generate_dialog', 'Gera uma fala/narração em áudio.', { text: str('Texto falado; pode incluir direções como [sussurrando]'), title: str('Título') }, ['text']),
  fn('generate_music', 'Gera uma trilha musical.', { prompt: str('Gênero, clima, instrumentos'), duration: { type: 'string', enum: ['15', '30', '60', '120'] }, title: str('Título') }, ['prompt']),
  fn('organize_nodes', 'Reorganiza o canvas em uma grade limpa por seção.', {}),
  fn(
    'update_story',
    'Escreve no documento de História (roteiro/decupagem). Use markdown com títulos (# Cena, ## Plano).',
    { mode: { type: 'string', enum: ['append', 'replace'] }, markdown: str('Conteúdo em markdown') },
    ['mode', 'markdown'],
  ),
  fn('set_project_memory', 'Atualiza a memória do projeto: regras de estilo, personagens aprovados e decisões que devem valer em todas as gerações.', { memory: str('Texto completo da memória') }, ['memory']),
  fn('timeline_read', 'Lê a linha do tempo do editor de vídeo.', {}),
  fn('timeline_add_clips', 'Adiciona mídias do canvas ao fim da linha do tempo, na ordem dada.', { node_ids: strArr('Vídeos/imagens/áudios em ordem'), image_duration: { type: 'number', description: 'Duração para imagens (s)' } }, ['node_ids']),
  fn('inspect_media', 'Olha uma imagem do canvas para descrevê-la ou avaliá-la.', { node_id: str('id do nó de imagem') }, ['node_id']),
  fn('suggest_next_steps', 'Mostra ao usuário 2–4 próximos passos curtos como botões. Chame ao final de cada resposta.', { suggestions: strArr('Sugestões curtas no imperativo, em português') }, ['suggestions']),
  fn('let_user_choose', 'Faz uma pergunta com opções quando uma decisão criativa é do usuário. Encerra a vez do agente.', { question: str('Pergunta'), options: strArr('2–5 opções') }, ['question', 'options']),
];
