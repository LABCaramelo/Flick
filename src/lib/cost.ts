import { useEffect, useMemo, useState } from 'react';
import type { CostEstimate } from '../../shared/types';
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
