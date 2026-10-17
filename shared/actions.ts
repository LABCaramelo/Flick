import type { ActionType, MediaKind, ModelInfo, ModelSetting, NodeType } from './types';

// Action catalog. Ids, input slots, accepted node types and patterns follow
// the definitions recovered from flick.art's bundle; labels are pt-BR.

export type InputPattern = 'reference-collection' | 'temporal-sequence' | 'motion-control' | 'primary-source' | 'single';

export interface MediaInputDef {
  id: string;
  label: string;
  required: boolean;
  accepted: NodeType[];
  pattern: InputPattern;
  max: number;
}

export interface CommonInputDef {
  id: 'prompt' | 'duration' | 'resolution' | 'style' | 'dialog';
  label: string;
  required?: boolean;
  placeholder?: string;
}

export interface ActionDef {
  id: ActionType;
  name: string;
  description: string;
  category: MediaKind;
  purpose: 'generate' | 'edit';
  output: MediaKind;
  mediaInputs: MediaInputDef[];
  common: CommonInputDef[];
  /** shown in the add-node menu */
  menu?: boolean;
}

const prompt = (placeholder: string, required = true): CommonInputDef => ({ id: 'prompt', label: 'Prompt', required, placeholder });
const duration: CommonInputDef = { id: 'duration', label: 'Duração' };
const resolution: CommonInputDef = { id: 'resolution', label: 'Resolução' };
const style: CommonInputDef = { id: 'style', label: 'Estilo' };

const img = (id: string, label: string, required: boolean, max = 1, pattern: InputPattern = 'single'): MediaInputDef => ({
  id,
  label,
  required,
  accepted: ['image'],
  pattern,
  max,
});

export const ACTIONS: Record<ActionType, ActionDef> = {
  Image: {
    id: 'Image',
    name: 'Imagem',
    description: 'Gere ou edite uma imagem a partir de um prompt e referências opcionais',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [img('referenceImages', 'Imagem(ns) de Referência', false, 10, 'reference-collection')],
    common: [prompt('Descreva a imagem que você quer gerar... (ou conecte uma nota de texto)'), style],
    menu: true,
  },
  TextToImage: {
    id: 'TextToImage',
    name: 'Texto para Imagem',
    description: 'Gere uma imagem a partir de um prompt de texto',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [],
    common: [prompt('Descreva a imagem que você quer gerar...'), style],
  },
  EditImage: {
    id: 'EditImage',
    name: 'Editar e Combinar',
    description: 'Edite ou combine imagens com referências e um prompt',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [img('referenceImages', 'Imagem(ns) de Referência', true, 10, 'reference-collection')],
    common: [prompt('Descreva como transformar a imagem...')],
  },
  ImageStyleTransfer: {
    id: 'ImageStyleTransfer',
    name: 'Transferir Estilo',
    description: 'Aplique um estilo a uma imagem usando referências de estilo',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [img('sourceImage', 'Imagem de origem', true)],
    common: [style, prompt('Detalhes opcionais do estilo...', false)],
  },
  ImageRemoveBackground: {
    id: 'ImageRemoveBackground',
    name: 'Remover Fundo',
    description: 'Remova o fundo de uma imagem',
    category: 'image',
    purpose: 'edit',
    output: 'image',
    mediaInputs: [img('sourceImage', 'Imagem de origem', true)],
    common: [],
  },
  ImageInpaint: {
    id: 'ImageInpaint',
    name: 'Inpaint',
    description: 'Pinte uma máscara para editar regiões específicas com IA',
    category: 'image',
    purpose: 'edit',
    output: 'image',
    mediaInputs: [img('sourceImage', 'Imagem de origem', true), img('referenceImages', 'Referências', false, 5, 'reference-collection')],
    common: [prompt('O que deve aparecer na área pintada...')],
  },
  ChangeAngle: {
    id: 'ChangeAngle',
    name: 'Mudar Ângulo',
    description: 'Mude o ângulo ou a perspectiva da câmera de uma imagem',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [img('sourceImage', 'Imagem de origem', true)],
    common: [prompt('Ex.: câmera baixa, olhando de cima, close-up lateral...', false)],
  },
  CharacterReference: {
    id: 'CharacterReference',
    name: 'Referência de Personagem',
    description: 'Coloque um personagem em uma nova cena mantendo a identidade',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [
      img('character', 'Personagem', true, 5, 'reference-collection'),
      img('referenceScene', 'Cena de referência', false, 5, 'reference-collection'),
    ],
    common: [prompt('Descreva a cena e a ação do personagem...')],
  },
  ImageUpscale: {
    id: 'ImageUpscale',
    name: 'Aumentar Resolução',
    description: 'Aumente a resolução de uma imagem',
    category: 'image',
    purpose: 'generate',
    output: 'image',
    mediaInputs: [img('sourceImage', 'Imagem de origem', true)],
    common: [resolution],
  },
  ImageToVideo: {
    id: 'ImageToVideo',
    name: 'Quadro para Vídeo',
    description: 'Gere um vídeo a partir de um quadro inicial (e final opcional)',
    category: 'video',
    purpose: 'generate',
    output: 'video',
    mediaInputs: [
      img('startFrame', 'Quadro inicial', true, 1, 'temporal-sequence'),
      img('endFrame', 'Quadro final', false, 1, 'temporal-sequence'),
    ],
    common: [prompt('Descreva o movimento, a câmera e a ação...'), duration, resolution],
    menu: true,
  },
  MotionToVideo: {
    id: 'MotionToVideo',
    name: 'Referência de Movimento',
    description: 'Transfira o movimento de um vídeo de referência para sua imagem',
    category: 'video',
    purpose: 'generate',
    output: 'video',
    mediaInputs: [
      img('referenceImage', 'Imagem', true, 1, 'motion-control'),
      { id: 'motionReference', label: 'Vídeo de movimento', required: true, accepted: ['video'], pattern: 'motion-control', max: 1 },
    ],
    common: [prompt('Detalhes opcionais...', false), duration, resolution],
  },
  VideoExtension: {
    id: 'VideoExtension',
    name: 'Estender Vídeo',
    description: 'Estenda um vídeo existente',
    category: 'video',
    purpose: 'generate',
    output: 'video',
    mediaInputs: [{ id: 'sourceVideo', label: 'Vídeo de origem', required: true, accepted: ['video'], pattern: 'single', max: 1 }],
    common: [prompt('O que acontece em seguida...'), duration, resolution],
  },
  VideoUpscale: {
    id: 'VideoUpscale',
    name: 'Aumentar Resolução do Vídeo',
    description: 'Aumente e melhore a resolução de um vídeo',
    category: 'video',
    purpose: 'edit',
    output: 'video',
    mediaInputs: [{ id: 'sourceVideo', label: 'Vídeo de origem', required: true, accepted: ['video'], pattern: 'single', max: 1 }],
    common: [resolution],
  },
  VideoEdit: {
    id: 'VideoEdit',
    name: 'Editar Vídeo',
    description: 'Edite e transforme vídeos com prompts de texto',
    category: 'video',
    purpose: 'edit',
    output: 'video',
    mediaInputs: [{ id: 'sourceVideo', label: 'Vídeo de origem', required: true, accepted: ['video'], pattern: 'single', max: 1 }],
    common: [prompt('Descreva a edição...')],
  },
  VideoToAudio: {
    id: 'VideoToAudio',
    name: 'Gerar Efeitos Sonoros',
    description: 'Adicione foley, ambiência e efeitos sincronizados a um vídeo',
    category: 'video',
    purpose: 'edit',
    output: 'video',
    mediaInputs: [{ id: 'sourceVideo', label: 'Vídeo de origem', required: true, accepted: ['video'], pattern: 'single', max: 1 }],
    common: [prompt('Ex.: passos na chuva, trânsito distante...', false)],
  },
  AudioToVideo: {
    id: 'AudioToVideo',
    name: 'Diálogo de Personagem',
    description: 'Anime um personagem falando a partir de uma imagem e um áudio',
    category: 'video',
    purpose: 'generate',
    output: 'video',
    mediaInputs: [
      img('imageSource', 'Personagem', true, 1, 'primary-source'),
      { id: 'audioSource', label: 'Áudio', required: true, accepted: ['audio'], pattern: 'primary-source', max: 1 },
    ],
    common: [prompt('Expressão, gestos...', false)],
  },
  ReferenceToVideo: {
    id: 'ReferenceToVideo',
    name: 'Omni Reference',
    description: 'Gere vídeo guiado por imagens, vídeos e áudios de referência',
    category: 'video',
    purpose: 'generate',
    output: 'video',
    mediaInputs: [
      img('referenceImages', 'Imagens de referência', false, 9, 'reference-collection'),
      { id: 'referenceVideos', label: 'Vídeos de referência', required: false, accepted: ['video'], pattern: 'reference-collection', max: 3 },
      { id: 'referenceAudio', label: 'Áudio de referência', required: false, accepted: ['audio'], pattern: 'reference-collection', max: 3 },
    ],
    common: [prompt('Cite as referências como @Imagem1, @Imagem2...'), duration, resolution],
    menu: true,
  },
  OmniReference: {
    id: 'OmniReference',
    name: 'Elementos Consistentes',
    description: 'Vídeo com consistência de personagens/objetos usando elementos de referência',
    category: 'video',
    purpose: 'generate',
    output: 'video',
    mediaInputs: [
      img('startFrame', 'Quadro inicial', false, 1, 'temporal-sequence'),
      img('endFrame', 'Quadro final', false, 1, 'temporal-sequence'),
      { id: 'element1', label: '@Elemento1', required: false, accepted: ['image', 'video'], pattern: 'reference-collection', max: 5 },
      { id: 'element2', label: '@Elemento2', required: false, accepted: ['image', 'video'], pattern: 'reference-collection', max: 5 },
    ],
    common: [prompt('Use @Elemento1, @Elemento2 no prompt...'), duration],
  },
  TextToDialog: {
    id: 'TextToDialog',
    name: 'Texto para Voz',
    description: 'Gere falas, diálogos com vários personagens ou áudio de cena',
    category: 'audio',
    purpose: 'generate',
    output: 'audio',
    mediaInputs: [
      { id: 'referenceAudios', label: 'Vozes de referência', required: false, accepted: ['audio'], pattern: 'reference-collection', max: 3 },
    ],
    common: [prompt('Texto a ser falado. Use [sussurrando], [rindo]... para direção de voz')],
    menu: true,
  },
  TextToMusic: {
    id: 'TextToMusic',
    name: 'Texto para Música',
    description: 'Gere música original: gênero, clima, duração e letra',
    category: 'audio',
    purpose: 'generate',
    output: 'audio',
    mediaInputs: [],
    common: [prompt('Gênero, clima, instrumentos, letra...'), duration],
    menu: true,
  },
};

export const ACTION_LIST: ActionDef[] = Object.values(ACTIONS);

export function actionsForOutput(kind: MediaKind): ActionDef[] {
  return ACTION_LIST.filter((a) => a.output === kind);
}

export function defaultActionFor(kind: MediaKind, hasSource: boolean): ActionType {
  if (kind === 'image') return 'Image';
  if (kind === 'video') return hasSource ? 'ImageToVideo' : 'ReferenceToVideo';
  return 'TextToDialog';
}

/** first media input of `action` that accepts a node of type `t` and still has room */
export function pickInputFor(action: ActionDef, t: NodeType, used: Record<string, number>): MediaInputDef | undefined {
  return action.mediaInputs.find((m) => m.accepted.includes(t) && (used[m.id] ?? 0) < m.max);
}

// ---------- settings shared by many models ----------

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3'];

const aspect: ModelSetting = {
  id: 'aspect_ratio',
  label: 'Proporção',
  type: 'select',
  options: ASPECT_RATIOS.map((v) => ({ value: v, label: v })),
  defaultValue: '16:9',
};
const imageRes: ModelSetting = {
  id: 'resolution',
  label: 'Resolução',
  type: 'select',
  options: ['1K', '2K', '4K'].map((v) => ({ value: v, label: v })),
  defaultValue: '1K',
};
const videoRes: ModelSetting = {
  id: 'resolution',
  label: 'Resolução',
  type: 'select',
  options: ['480p', '720p', '1080p'].map((v) => ({ value: v, label: v })),
  defaultValue: '720p',
};
const videoDur = (values: number[], def: number): ModelSetting => ({
  id: 'duration',
  label: 'Duração',
  type: 'select',
  options: values.map((v) => ({ value: String(v), label: `${v}s` })),
  defaultValue: String(def),
});
const count: ModelSetting = {
  id: 'num_images',
  label: 'Quantidade',
  type: 'select',
  options: ['1', '2', '3', '4'].map((v) => ({ value: v, label: v })),
  defaultValue: '1',
};
const musicDur: ModelSetting = {
  id: 'duration',
  label: 'Duração',
  type: 'select',
  options: ['15', '30', '60', '120'].map((v) => ({ value: v, label: `${v}s` })),
  defaultValue: '30',
};
/** native audio costs extra on most video models, so it starts off */
export const AUDIO_SETTING: ModelSetting = { id: 'audio', label: 'Áudio', type: 'checkbox', defaultValue: false };

const IMAGE_GEN: ActionType[] = ['Image', 'TextToImage'];
const IMAGE_EDIT: ActionType[] = ['Image', 'EditImage', 'CharacterReference', 'ImageStyleTransfer', 'ChangeAngle', 'ImageInpaint'];
const I2V: ActionType[] = ['ImageToVideo', 'ReferenceToVideo', 'OmniReference'];
const videoSettings = (values: number[], def: number) => [videoDur(values, def), videoRes, aspect, AUDIO_SETTING];

/**
 * Model catalog, aligned with flick.art's: ids follow flick's, and only the
 * flick models that also exist on the Higgsfield API are listed (plus SOUL V2,
 * Higgsfield's own model, standing in for flick's in-house one). The Higgsfield
 * API provider maps each id to its endpoints; the offline provider and the MCP
 * fallback use this list as is. Audio, upscale and background removal have no
 * Higgsfield API endpoint and run on the Higgsfield MCP.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'auto', name: 'Auto', description: 'Escolhe o melhor modelo para a tarefa', actions: [...new Set([...IMAGE_GEN, ...IMAGE_EDIT, ...I2V, 'TextToDialog', 'TextToMusic'] as ActionType[])], labels: ['auto'], settings: [aspect] },
  // images
  { id: 'soul-v2', name: 'Soul V2', description: 'Modelo próprio da Higgsfield: retratos e fotos editoriais; o mais barato', actions: IMAGE_GEN, estimatedTime: '~20s', settings: [aspect, count] },
  { id: 'gpt-image-2.5', name: 'GPT Image 2.5', description: 'OpenAI: edição precisa e boa aderência ao prompt, até 4K', actions: [...IMAGE_GEN, 'EditImage', 'CharacterReference', 'ImageStyleTransfer'], estimatedTime: '~60s', settings: [aspect, imageRes] },
  { id: 'gpt-image-2', name: 'GPT Image 2', description: 'OpenAI: texto dentro da imagem e cores neutras', actions: [...IMAGE_GEN, 'EditImage', 'CharacterReference'], estimatedTime: '~60s', settings: [aspect, imageRes] },
  { id: 'grok-imagine', name: 'Grok Imagine', description: 'xAI: visual estético para cinema, anime e fotorrealismo; gera e edita', actions: [...IMAGE_GEN, 'EditImage', 'CharacterReference'], estimatedTime: '~20s', settings: [aspect] },
  { id: 'recraft', name: 'Recraft V4.1', description: 'Controle de estilo e textos longos (no flick: Recraft V3)', actions: IMAGE_GEN, estimatedTime: '~20s', settings: [aspect] },
  { id: 'z-image-turbo', name: 'Z-Image Turbo', description: 'Fotorrealista ultrarrápido, bom com texto', actions: IMAGE_GEN, estimatedTime: '~5s', settings: [aspect] },
  { id: 'qwen-image-3', name: 'Qwen Image 3', description: 'Edição barata de 1 a 3 imagens, inclusive mudar o ângulo (no flick: Qwen Camera Control)', actions: ['TextToImage', 'EditImage', 'CharacterReference', 'ImageStyleTransfer', 'ChangeAngle', 'ImageInpaint'], estimatedTime: '~30s', settings: [aspect] },
  { id: 'upscale', name: 'Upscale', description: 'Aumento de resolução com recuperação de detalhes', actions: ['ImageUpscale'], settings: [imageRes] },
  { id: 'remove-background', name: 'Remover fundo', actions: ['ImageRemoveBackground'] },
  // video
  { id: 'kling-3.0-standard', name: 'Kling 3.0', description: 'Movimento cinematográfico fluido, quadro inicial e final; o Kling 3.0 mais barato', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'kling-3.0', name: 'Kling 3.0 Pro', description: 'Versão Pro do Kling 3.0, com mais detalhe', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'kling-3.0-4k', name: 'Kling 3.0 4K', description: 'Saída nativa em 4K; caro', actions: I2V, estimatedTime: '~3m', labels: ['expensive'], settings: videoSettings([5, 10], 5) },
  { id: 'kling-o3-standard', name: 'Kling O3', description: 'Consistência de personagens e objetos por referência, 1080p', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'kling-o3', name: 'Kling O3 Pro', description: 'Versão Pro do O3; também edita vídeos', actions: [...I2V, 'VideoEdit'], estimatedTime: '~3m', settings: videoSettings([5, 10], 5) },
  { id: 'kling-2.6', name: 'Kling 2.6 Pro', description: 'Movimento cinematográfico e animação de personagens', actions: ['ImageToVideo', 'ReferenceToVideo'], estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'kling-2.6-motion', name: 'Kling 2.6 · Movimento', description: 'Transfere o movimento de um vídeo de referência para a imagem', actions: ['MotionToVideo'], estimatedTime: '~2m' },
  { id: 'kling-2.6-motion-pro', name: 'Kling 2.6 Pro · Movimento', description: 'Mais qualidade para danças e gestos complexos', actions: ['MotionToVideo'], estimatedTime: '~3m' },
  { id: 'seedance-2.5', name: 'Seedance 2.5', description: 'ByteDance: até 30s, quadro inicial e final, edita e estende vídeos; caro em 720p e 1080p', actions: [...I2V, 'VideoEdit', 'VideoExtension'], estimatedTime: '~3m', labels: ['expensive'], settings: videoSettings([5, 10, 15], 5) },
  { id: 'seedance-2.0', name: 'Seedance 2.0', description: 'ByteDance: até 15s, com áudio e lip-sync', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10, 15], 5) },
  { id: 'minimax-h3', name: 'MiniMax H3', description: 'Hailuo 3: vídeo nativo em 2K, quadro inicial e final', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'wan3.0', name: 'Wan 3.0', description: 'Alibaba: até 30s em 480p/720p/1080p', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10, 15], 5) },
  { id: 'wan2.6', name: 'Wan 2.6', description: 'Vídeo multi-plano com segmentação de cenas', actions: I2V, estimatedTime: '~90s', settings: videoSettings([5, 10, 15], 5) },
  { id: 'happy-horse-1.1', name: 'Happy Horse 1.1', description: 'Alibaba: anima o primeiro quadro guiado pelo prompt, 720p/1080p', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'grok-imagine-video', name: 'Grok Imagine 1.5', description: 'xAI: bom movimento; combina até 7 imagens de referência', actions: I2V, estimatedTime: '~2m', settings: videoSettings([5, 10], 5) },
  { id: 'video-upscale', name: 'Upscale de vídeo', actions: ['VideoUpscale'], settings: [videoRes] },
  // audio
  { id: 'sfx', name: 'Efeitos sonoros', actions: ['VideoToAudio'] },
  { id: 'lipsync', name: 'Lip-sync / Avatar', actions: ['AudioToVideo'] },
  { id: 'elevenlabs-v3', name: 'Eleven v3', description: 'Diálogo multi-voz com tags de áudio', actions: ['TextToDialog'], estimatedTime: '~6s' },
  { id: 'elevenlabs-music', name: 'Eleven Music', description: 'Música em qualidade de estúdio', actions: ['TextToMusic'], settings: [musicDur] },
];

export function modelsForAction(models: ModelInfo[], action: ActionType): ModelInfo[] {
  const list = models.filter((m) => m.actions.includes(action));
  return list.length ? list : models.filter((m) => m.id === 'auto');
}

/** Model by id, also matching aliases (e.g. a raw endpoint saved by an older project). */
export function findModel(models: ModelInfo[], id: unknown): ModelInfo | undefined {
  if (typeof id !== 'string' || !id) return undefined;
  return models.find((m) => m.id === id) ?? models.find((m) => m.aliases?.includes(id));
}

/** Settings the model offers for `action`. */
export function modelSettings(model: ModelInfo | undefined, action: ActionType): ModelSetting[] {
  return model?.settingsByAction?.[action] ?? model?.settings ?? [];
}

/** Defaults favour the cheapest model that does the job well. */
export const DEFAULT_MODEL_BY_ACTION: Partial<Record<ActionType, string>> = {
  Image: 'soul-v2',
  TextToImage: 'soul-v2',
  EditImage: 'qwen-image-3',
  CharacterReference: 'qwen-image-3',
  ImageStyleTransfer: 'qwen-image-3',
  ChangeAngle: 'qwen-image-3',
  ImageInpaint: 'qwen-image-3',
  ImageUpscale: 'upscale',
  ImageRemoveBackground: 'remove-background',
  ImageToVideo: 'kling-3.0-standard',
  ReferenceToVideo: 'kling-o3-standard',
  OmniReference: 'kling-o3-standard',
  MotionToVideo: 'kling-2.6-motion',
  VideoExtension: 'seedance-2.5',
  VideoUpscale: 'video-upscale',
  VideoEdit: 'kling-o3',
  VideoToAudio: 'sfx',
  AudioToVideo: 'lipsync',
  TextToDialog: 'elevenlabs-v3',
  TextToMusic: 'elevenlabs-music',
};

/** Default model id for `action` within `models`. */
export function defaultModelId(models: ModelInfo[], action: ActionType): string {
  const list = modelsForAction(models, action);
  const preferred = DEFAULT_MODEL_BY_ACTION[action];
  if (preferred && list.some((m) => m.id === preferred)) return preferred;
  return (list.find((m) => m.id !== 'auto') ?? list[0])?.id ?? 'auto';
}
