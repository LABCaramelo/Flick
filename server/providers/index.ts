import { ACTIONS } from '../../shared/actions';
import type { ActionType, CostEstimate, GenerateRequest, ModelInfo } from '../../shared/types';
import { GENERATION_PROVIDER } from '../config';
import { readSettings, writeSettings } from '../storage';
import { HiggsfieldMcpProvider } from './higgsfield';
import { HiggsfieldApiProvider, higgsfieldApiSupports } from './higgsfieldApi';
import { MockProvider } from './mock';
import { ProviderError, type EstimateOptions, type GenerationProvider } from './types';

export const higgsfieldApi = new HiggsfieldApiProvider();
export const higgsfield = new HiggsfieldMcpProvider();
export const mock = new MockProvider();

const providers: Record<string, GenerationProvider> = { 'higgsfield-api': higgsfieldApi, higgsfield, mock };

interface Settings {
  provider?: string;
}

let settings: Settings = {};

export async function initProviders(): Promise<void> {
  settings = (await readSettings<Settings>()) ?? {};
  await higgsfield.init();
}

export function activeProviderId(): string {
  const id = settings.provider ?? GENERATION_PROVIDER;
  return providers[id] ? id : 'higgsfield-api';
}

export function activeProvider(): GenerationProvider {
  return providers[activeProviderId()];
}

/**
 * Provider that will actually run `action`. The Higgsfield API has no audio,
 * upscale or background-removal models; those go to the Higgsfield MCP when
 * it is connected.
 */
export async function providerFor(action: ActionType): Promise<GenerationProvider> {
  const p = activeProvider();
  if (p !== higgsfieldApi || higgsfieldApiSupports(action)) return p;
  if ((await higgsfield.status()).connected) return higgsfield;
  throw new ProviderError(`"${ACTIONS[action].name}" não existe na API do Higgsfield. Conecte o Higgsfield MCP em Configurações (ele inclui ferramentas de voz/áudio) ou use o modo offline.`);
}

/** Expected charge of a generation, before it is submitted. */
export async function estimateCost(r: GenerateRequest, opts: EstimateOptions): Promise<CostEstimate> {
  let p: GenerationProvider;
  try {
    p = await providerFor(r.actionType);
  } catch (err) {
    return { usd: null, source: 'unknown', note: (err as Error).message };
  }
  if (p.estimate) return p.estimate(r, opts);
  return { usd: null, source: 'unknown', note: `${p.name} não informa o custo antes de gerar.` };
}

/** Model catalog for the UI, including MCP models for actions the API lacks. */
export async function activeModels(): Promise<ModelInfo[]> {
  const p = activeProvider();
  const list = await p.models();
  if (p !== higgsfieldApi || !(await higgsfield.status()).connected) return list;
  const missing = (Object.keys(ACTIONS) as ActionType[]).filter((a) => !higgsfieldApiSupports(a));
  const extra = (await higgsfield.models()).filter((m) => m.actions.some((a) => missing.includes(a))).map((m) => ({ ...m, actions: m.actions.filter((a) => missing.includes(a)) }));
  return [...list, ...extra];
}

export async function setActiveProvider(id: string): Promise<void> {
  if (!providers[id]) throw Object.assign(new Error('provedor desconhecido'), { status: 400 });
  settings.provider = id;
  await writeSettings(settings);
}

export function allProviders(): GenerationProvider[] {
  return Object.values(providers);
}
