import type { GenerateRequest, MediaKind, MediaRef, ModelInfo, ProviderStatus } from '../../shared/types';

export interface RawOutput {
  /** remote URL or data URI */
  url: string;
  type?: MediaKind;
}

export interface ProviderContext {
  projectId: string;
  signal: AbortSignal;
  progress(value: number, message?: string): void;
  /** turn a canvas media reference into something the provider can fetch */
  resolveMedia(ref: MediaRef): Promise<string>;
  /** absolute local path of a /media URL, when it is local */
  localFile(ref: MediaRef): string | undefined;
}

export interface GenerationProvider {
  id: string;
  name: string;
  status(): Promise<ProviderStatus>;
  models(): Promise<ModelInfo[]>;
  generate(req: GenerateRequest, ctx: ProviderContext): Promise<RawOutput[]>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly needsAuth = false) {
    super(message);
  }
}
