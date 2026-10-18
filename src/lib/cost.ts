import { useEffect, useMemo, useState } from 'react';
import type { CostEstimate, ToolCost } from '../../shared/types';
import { useProject } from '../store/project';
import { useProviders } from '../store/providers';
import { api } from './api';
import { prepareGeneration } from './generation';

export interface CostState {
  loading: boolean;
  estimate?: CostEstimate;
}

/**
 * Expected charge of generating `nodeId` with its current settings. Asks the
 * server again only when something that changes the price changes (model,
 * settings, connected media, provider), not on every keystroke in the prompt.
 */
export function useCostEstimate(nodeId: string): CostState {
  const node = useProject((s) => s.project?.nodes[nodeId]);
  const edges = useProject((s) => s.project?.edges);
  const models = useProject((s) => s.models);
  const provider = useProviders((s) => s.info?.active);
  const [state, setState] = useState<CostState>({ loading: false });

  const key = useMemo(() => {
    const prep = prepareGeneration(nodeId);
    if ('error' in prep) return null;
    const { prompt: _prompt, stylePrompt: _style, ...priced } = prep.request;
    return JSON.stringify({ provider, ...priced });
    // node/edges/models are the inputs prepareGeneration reads from the store
  }, [nodeId, node, edges, models, provider]);

  useEffect(() => {
    if (!key) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      const prep = prepareGeneration(nodeId);
      if ('error' in prep) return;
      try {
        const estimate = await api.estimate(prep.request);
        if (alive) setState({ loading: false, estimate });
      } catch (err) {
        if (alive) setState({ loading: false, estimate: { usd: null, source: 'unknown', note: String((err as Error).message) } });
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, nodeId]);

  return state;
}

export function formatUsd(v: number): string {
  // sub-cent prices (cheap images) keep a third decimal so they don't read as zero
  const digits = v > 0 && v < 0.1 ? 3 : 2;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** One-line label and hover text for a cost estimate. */
export function describeCost(state: CostState): { label: string; title: string } {
  const e = state.estimate;
  if (!e) return { label: state.loading ? 'Calculando custo…' : '', title: '' };
  if (e.source === 'free') return { label: 'Grátis', title: e.note ?? '' };
  if (e.usd === null) return { label: 'Custo: sem estimativa', title: e.note ?? '' };
  const lines = [e.note];
  if (e.discountPct && e.listUsd !== undefined) lines.push(`Preço de tabela ${formatUsd(e.listUsd)} − ${e.discountPct}% de desconto da conta.`);
  if (e.endpoint) lines.push(`Endpoint: ${e.endpoint}`);
  return { label: `≈ ${formatUsd(e.usd)}`, title: lines.filter(Boolean).join('\n') };
}

/** Cost as it reads inside a sentence for the agent: "custo ≈ US$ 0,36", "grátis". */
export function costPhrase(c: { usd: number | null }): string {
  if (c.usd === null) return 'sem estimativa de custo';
  return c.usd === 0 ? 'grátis' : `custo ≈ ${formatUsd(c.usd)}`;
}

/** Drops float noise from summed prices (0.1 + 0.2). */
export const roundUsd = (v: number) => Math.round(v * 1e4) / 1e4;

/** Card label and total for a set of generations; null usd when any of them has no estimate. */
export function sumEstimates(list: CostEstimate[]): ToolCost {
  const usd = list.some((e) => e.usd === null) ? null : roundUsd(list.reduce((s, e) => s + (e.usd ?? 0), 0));
  if (list.length === 1) return { usd, count: 1, ...describeCost({ loading: false, estimate: list[0] }) };
  const merged: CostEstimate = { usd, source: list.every((e) => e.source === 'free') ? 'free' : usd === null ? 'unknown' : 'quote' };
  const { label } = describeCost({ loading: false, estimate: merged });
  const title = list.map((e, i) => `${i + 1}. ${describeCost({ loading: false, estimate: e }).label}${e.note ? ` — ${e.note}` : ''}`).join('\n');
  return { usd, count: list.length, label: `${label} · ${list.length} gerações`, title };
}

/**
 * Prices the generations of `nodeIds` as they would be submitted now. Nodes
 * that runGeneration would refuse (missing inputs) are left out: nothing is
 * charged for them.
 */
export async function estimateGenerations(nodeIds: string[]): Promise<Record<string, CostEstimate>> {
  const priced = await Promise.all(
    nodeIds.map(async (id): Promise<[string, CostEstimate] | null> => {
      const prep = prepareGeneration(id);
      if ('error' in prep || prep.missing.length) return null;
      try {
        return [id, await api.estimate(prep.request)];
      } catch (err) {
        return [id, { usd: null, source: 'unknown', note: String((err as Error).message) }];
      }
    }),
  );
  return Object.fromEntries(priced.filter((e) => e !== null));
}

const BUDGET_KEY = 'claquete.agentBudgetUsd';
export const DEFAULT_AGENT_BUDGET_USD = 1;

/** Auto mode: what one agent response may spend before it stops for approval. */
export function getAgentBudget(): number {
  const raw = localStorage.getItem(BUDGET_KEY);
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_AGENT_BUDGET_USD;
}

export function setAgentBudget(usd: number) {
  localStorage.setItem(BUDGET_KEY, String(usd));
}

/** Why the Auto mode must ask before this generation, or undefined when it may go ahead. */
export function overBudgetReason(cost: ToolCost, spentUsd: number, limitUsd: number): string | undefined {
  if (cost.usd === null) return 'Sem estimativa de custo: confirme antes de gerar.';
  // free generations add nothing, even once the response is past the limit
  if (cost.usd > 0 && roundUsd(spentUsd + cost.usd) > limitUsd) return `Passa do limite de ${formatUsd(limitUsd)} por resposta (total ≈ ${formatUsd(spentUsd + cost.usd)}).`;
  return undefined;
}
