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

const IMAGE_GEN: ActionType[] = ['Image', 'TextToImage'];
const IMAGE_EDIT: ActionType[] = ['Image', 'EditImage', 'CharacterReference', 'ImageStyleTransfer', 'ChangeAngle', 'ImageInpaint'];
const I2V: ActionType[] = ['ImageToVideo', 'ReferenceToVideo', 'OmniReference'];

/**
 * Fallback catalog used until the provider reports its own model list
 * (Higgsfield's `list_models`). Ids are what we send as `model`.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'auto', name: 'Auto', description: 'Escolhe o melhor modelo para a tarefa', actions: [...new Set([...IMAGE_GEN, ...IMAGE_EDIT, ...I2V, 'TextToDialog', 'TextToMusic'] as ActionType[])], labels: ['auto'], settings: [aspect] },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro', description: 'Alta qualidade, 1K–4K, ótima consistência de personagem', actions: [...IMAGE_GEN, ...IMAGE_EDIT], estimatedTime: '~35s', settings: [aspect, imageRes, count] },
  { id: 'nano-banana', name: 'Nano Banana', description: 'Edição rápida e consistente com linguagem natural', actions: [...IMAGE_GEN, ...IMAGE_EDIT], estimatedTime: '~15s', settings: [aspect, count] },
  { id: 'seedream-4.5', name: 'Seedream 4.5', description: 'Texto em imagem, layouts e composição multi-imagem', actions: [...IMAGE_GEN, 'EditImage', 'CharacterReference'], estimatedTime: '~30s', settings: [aspect, imageRes, count] },
  { id: 'soul', name: 'Soul', description: 'Fotorrealismo com estética de moda/cinema', actions: IMAGE_GEN, estimatedTime: '~20s', settings: [aspect, count] },
  { id: 'gpt-image', name: 'GPT Image', description: 'Forte em texto dentro da imagem e aderência ao prompt', actions: [...IMAGE_GEN, 'EditImage'], estimatedTime: '~60s', settings: [aspect, count] },
  { id: 'flux-2-pro', name: 'FLUX.2 Pro', description: 'Rápido e versátil', actions: IMAGE_GEN, estimatedTime: '~10s', settings: [aspect, count] },
  { id: 'upscale', name: 'Upscale', description: 'Aumento de resolução com recuperação de detalhes', actions: ['ImageUpscale'], settings: [imageRes] },
  { id: 'remove-background', name: 'Remover fundo', actions: ['ImageRemoveBackground'] },
  { id: 'kling-3.0', name: 'Kling 3.0', description: 'Movimento cinematográfico fluido com áudio nativo', actions: [...I2V, 'MotionToVideo'], estimatedTime: '~2m', labels: ['with-audio'], settings: [videoDur([5, 10], 5), videoRes, aspect] },
  { id: 'veo-3.1', name: 'Veo 3.1', description: 'Física e realismo superiores, quadro inicial e final', actions: I2V, estimatedTime: '~2m', labels: ['with-audio'], settings: [videoDur([4, 6, 8], 8), videoRes, aspect] },
  { id: 'seedance-2.0', name: 'Seedance 2.0', description: 'Áudio nativo com lip-sync, até 15s', actions: I2V, estimatedTime: '~2m', labels: ['with-audio'], settings: [videoDur([5, 10, 15], 5), videoRes, aspect] },
  { id: 'wan-2.6', name: 'Wan 2.6', description: 'Vídeo multi-plano com segmentação de cenas', actions: [...I2V, 'VideoExtension'], estimatedTime: '~90s', settings: [videoDur([5, 10, 15], 5), videoRes, aspect] },
  { id: 'minimax-hailuo', name: 'MiniMax Hailuo', description: 'Rápido, com controle de quadro inicial/final', actions: I2V, estimatedTime: '~60s', settings: [videoDur([6, 10], 6), videoRes] },
  { id: 'sora-2', name: 'Sora 2', description: 'Cenas longas e coerentes com som', actions: ['ImageToVideo', 'ReferenceToVideo'], estimatedTime: '~3m', labels: ['with-audio'], settings: [videoDur([4, 8, 12], 8), aspect] },
  { id: 'video-upscale', name: 'Upscale de vídeo', actions: ['VideoUpscale'], settings: [videoRes] },
  { id: 'video-edit', name: 'Edição de vídeo', actions: ['VideoEdit', 'VideoExtension'] },
  { id: 'sfx', name: 'Efeitos sonoros', actions: ['VideoToAudio'] },
  { id: 'lipsync', name: 'Lip-sync / Avatar', actions: ['AudioToVideo'] },
  { id: 'elevenlabs-v3', name: 'Eleven v3', description: 'Diálogo multi-voz com tags de áudio', actions: ['TextToDialog'], estimatedTime: '~6s' },
  { id: 'elevenlabs-music', name: 'Eleven Music', description: 'Música em qualidade de estúdio', actions: ['TextToMusic'], settings: [musicDur] },
];

export function modelsForAction(models: ModelInfo[], action: ActionType): ModelInfo[] {
  const list = models.filter((m) => m.actions.includes(action));
  return list.length ? list : models.filter((m) => m.id === 'auto');
}

export const DEFAULT_MODEL_BY_ACTION: Partial<Record<ActionType, string>> = {
  Image: 'nano-banana-pro',
  TextToImage: 'nano-banana-pro',
  EditImage: 'nano-banana-pro',
  CharacterReference: 'nano-banana-pro',
  ImageStyleTransfer: 'nano-banana',
  ChangeAngle: 'nano-banana',
  ImageInpaint: 'nano-banana',
  ImageUpscale: 'upscale',
  ImageRemoveBackground: 'remove-background',
  ImageToVideo: 'kling-3.0',
  ReferenceToVideo: 'seedance-2.0',
  OmniReference: 'kling-3.0',
  MotionToVideo: 'kling-3.0',
  VideoExtension: 'wan-2.6',
  VideoUpscale: 'video-upscale',
  VideoEdit: 'video-edit',
  VideoToAudio: 'sfx',
  AudioToVideo: 'lipsync',
  TextToDialog: 'elevenlabs-v3',
  TextToMusic: 'elevenlabs-music',
};
