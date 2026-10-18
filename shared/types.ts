// Project schema shared by client and server. Mirrors the shape observed in
// flick.art's bundle (project v6: nodes map, edges list, timelines with
// tracks/clips, jobs, projectSettings) with a few local additions
// (sections, story, stage, styles).

export const PROJECT_VERSION = 6;

export type NodeType =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'richtext'
  | 'placeholder'
  | 'stage_scene';

export type MediaKind = 'image' | 'video' | 'audio';

export type ActionType =
  | 'Image'
  | 'TextToImage'
  | 'EditImage'
  | 'ImageStyleTransfer'
  | 'ImageUpscale'
  | 'ImageRemoveBackground'
  | 'ImageInpaint'
  | 'ChangeAngle'
  | 'CharacterReference'
  | 'ImageToVideo'
  | 'MotionToVideo'
  | 'VideoExtension'
  | 'VideoUpscale'
  | 'VideoEdit'
  | 'VideoToAudio'
  | 'AudioToVideo'
  | 'ReferenceToVideo'
  | 'OmniReference'
  | 'TextToDialog'
  | 'TextToMusic';

export type NoteColor = 'yellow' | 'blue' | 'pink' | 'white' | 'green' | 'orange';

export type GenerationStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface GenerationSettings {
  actionType: ActionType;
  /** model id + prompt + per-model settings (aspect_ratio, duration, resolution...) */
  inputs: Record<string, unknown> & { model?: string; prompt?: string };
  /** mediaInputId -> source node ids, derived from edges at generation time */
  connectedMediaInputs?: Record<string, string[]>;
  styleId?: string | null;
}

export interface MediaVersion {
  url: string;
  remoteUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
  settings?: GenerationSettings;
}

export interface MediaNodeData {
  url?: string;
  /** provider-hosted URL, reused when the media is sent back to the provider */
  remoteUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  status: GenerationStatus;
  progress?: number;
  error?: string;
  jobId?: string;
  user_input_title?: string;
  auto_generated_title?: string;
  generationSettings?: GenerationSettings;
  versions?: MediaVersion[];
  activeVersion?: number;
  favorite?: boolean;
  /** visual width on canvas; height derives from aspect ratio */
  displayWidth?: number;
  mask?: string;
}

export interface TextNodeData {
  color: NoteColor;
  content: string;
  dimensions: Size;
  user_input_title?: string;
}

export interface StageSceneNodeData {
  sceneId: string;
  user_input_title?: string;
}

export interface CanvasNodeBase<T extends NodeType, D> {
  id: string;
  type: T;
  label?: string;
  position: Vec2;
  sectionId?: string | null;
  data: D;
}

export type MediaNode = CanvasNodeBase<'image' | 'video' | 'audio', MediaNodeData>;
export type TextNode = CanvasNodeBase<'text' | 'richtext', TextNodeData>;
export type StageNode = CanvasNodeBase<'stage_scene', StageSceneNodeData>;
export type CanvasNode = MediaNode | TextNode | StageNode;

export interface Edge {
  id: string;
  source: string;
  target: string;
  data: { mediaInputId: string };
}

export interface Section {
  id: string;
  label: string;
  position: Vec2;
  dimensions: Size;
  collapsed?: boolean;
  color?: string;
}

// ---------- timeline ----------

export type TrackType = 'main' | 'video' | 'audio';

export interface Track {
  id: string;
  type: TrackType;
  name?: string;
  visible: boolean;
  volume: number;
  muted: boolean;
}

export type TransitionType = 'none' | 'fade' | 'dissolve' | 'fadeblack' | 'wipeleft' | 'slideleft';

export interface Clip {
  id: string;
  trackId: string;
  nodeId?: string;
  mediaType: MediaKind | 'text';
  url?: string;
  label?: string;
  /** seconds on the timeline */
  start: number;
  /** seconds on the timeline (after speed) */
  duration: number;
  /** seconds into the source media */
  in: number;
  sourceDuration?: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  transitionIn?: { type: TransitionType; duration: number };
  text?: { content: string; size: number; color: string; y: number };
}

export interface Timeline {
  id: string;
  name?: string;
  magnetEnabled: boolean;
  tracks: Track[];
  clips: Record<string, Clip>;
}

// ---------- 3D stage ----------

export type StageObjectKind = 'person' | 'prop' | 'light';

export type CameraMove =
  | 'static'
  | 'dolly_in'
  | 'dolly_out'
  | 'pan_left'
  | 'pan_right'
  | 'pan_sweep'
  | 'crane_up'
  | 'crane_down'
  | 'orbit_left'
  | 'orbit_right'
  | 'dolly_zoom'
  | 'truck_left'
  | 'truck_right'
  | 'custom';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface StageObject {
  id: string;
  kind: StageObjectKind;
  name: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  color: string;
  imageUrl?: string;
}

export interface StageShot {
  id: string;
  name: string;
  move: CameraMove;
  duration: number;
  start: CameraPose;
  end: CameraPose;
  prompt?: string;
}

export interface StageScene {
  id: string;
  name: string;
  backdropUrl?: string;
  backdropNodeId?: string;
  objects: StageObject[];
  shots: StageShot[];
  activeShotId?: string;
}

// ---------- styles ----------

export interface StylePreset {
  id: string;
  name: string;
  prompt: string;
  thumbnail?: string;
  referenceUrls?: string[];
  custom?: boolean;
}

// ---------- project ----------

export interface ProjectSettings {
  aspectRatio: string;
  styleId?: string | null;
  styleLock?: boolean;
}

export interface StoryState {
  memory: string;
  /** TipTap / ProseMirror JSON document */
  doc: unknown;
}

export interface Project {
  version: number;
  projectId: string;
  name: string;
  createdAt: string;
  lastSaved: string;
  thumbnail?: string;
  nodes: Record<string, CanvasNode>;
  edges: Edge[];
  sections: Record<string, Section>;
  timelines: Record<string, Timeline>;
  activeTimelineId: string;
  stage: { scenes: Record<string, StageScene>; activeSceneId?: string };
  story: StoryState;
  customStyles: StylePreset[];
  projectSettings: ProjectSettings;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  createdAt: string;
  lastSaved: string;
  thumbnail?: string;
  nodeCount: number;
}

// ---------- generation jobs ----------

export interface MediaRef {
  nodeId: string;
  type: MediaKind | 'text';
  url?: string;
  remoteUrl?: string;
  text?: string;
}

export interface GenerateRequest {
  projectId: string;
  nodeId: string;
  actionType: ActionType;
  model: string;
  prompt: string;
  settings: Record<string, unknown>;
  mediaInputs: Record<string, MediaRef[]>;
  stylePrompt?: string;
  count?: number;
}

export interface JobOutput {
  url: string;
  remoteUrl?: string;
  type: MediaKind;
  width?: number;
  height?: number;
  duration?: number;
}

export interface JobState {
  id: string;
  projectId: string;
  nodeId: string;
  kind: 'generate' | 'export';
  actionType?: ActionType;
  status: Exclude<GenerationStatus, 'idle'>;
  progress: number;
  message?: string;
  outputs: JobOutput[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  request?: GenerateRequest;
  /** sibling nodes created for extra outputs, already persisted server-side */
  createdNodes?: CanvasNode[];
}

// ---------- provider catalog ----------

export interface ModelSetting {
  id: string;
  label: string;
  type: 'select' | 'number' | 'checkbox' | 'text';
  options?: { value: string; label: string }[];
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  actions: ActionType[];
  estimatedTime?: string;
  labels?: string[];
  aspectRatios?: string[];
  settings?: ModelSetting[];
  /** per-action settings, when one model runs on several endpoints with different options */
  settingsByAction?: Partial<Record<ActionType, ModelSetting[]>>;
  /** other ids that resolve to this model (e.g. raw provider endpoints saved by older projects) */
  aliases?: string[];
  /** raw id understood by the provider, when different from id */
  providerModel?: string;
}

export interface CostEstimate {
  /** expected charge in USD, after the account discount when known; null when unknown */
  usd: number | null;
  /** quote: provider's estimate endpoint · formula: provider's published rate · free: nothing is charged */
  source: 'quote' | 'formula' | 'free' | 'unknown';
  /** price before the discount */
  listUsd?: number;
  discountPct?: number;
  /** short explanation shown on hover (pt-BR) */
  note?: string;
  /** provider endpoint that will run */
  endpoint?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  connected: boolean;
  needsAuth?: boolean;
  error?: string;
  tools?: { name: string; description?: string }[];
  detail?: string;
}

// ---------- agent / chat ----------

export type ChatRole = 'user' | 'assistant';

/** Expected charge of the generations an agent tool call starts. */
export interface ToolCost {
  /** sum of the estimates in USD; null when a generation has none */
  usd: number | null;
  /** generations priced */
  count: number;
  /** estimated total of the agent's response so far, this call included */
  responseUsd?: number;
  /** card label (pt-BR), e.g. "≈ US$ 0,36" */
  label: string;
  /** hover text */
  title?: string;
  /** why the Auto mode stopped for approval */
  reason?: string;
}

export interface ToolCardState {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: 'pending_approval' | 'running' | 'done' | 'failed' | 'rejected';
  summary?: string;
  error?: string;
  nodeIds?: string[];
  cost?: ToolCost;
  /** client only: the cost is still being asked for */
  estimating?: boolean;
}

export interface ChatMessageView {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: { nodeId: string; url?: string; type: string; title?: string }[];
  tools?: ToolCardState[];
  suggestions?: string[];
  choices?: { question: string; options: string[] };
  createdAt: string;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatThread extends ChatThreadSummary {
  messages: ChatMessageView[];
}

export type AgentStreamEvent =
  | { type: 'run'; runId: string; threadId: string; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown>; needsApproval: boolean }
  | { type: 'tool_result'; callId: string; ok: boolean; rejected?: boolean; summary?: string; error?: string; nodeIds?: string[]; cost?: ToolCost }
  | { type: 'suggestions'; suggestions: string[] }
  | { type: 'choices'; question: string; options: string[] }
  | { type: 'error'; message: string }
  | { type: 'done'; threadId: string; title?: string };
