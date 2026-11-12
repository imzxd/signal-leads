/**
 * The ONLY place model IDs live.
 *
 * Routing follows the Kime playbook: Haiku for high-volume extraction/classification,
 * Sonnet for customer-facing writing and judgement calls, Opus reserved for hard
 * reasoning (not needed by any agent today). Override any route with an env var,
 * e.g. SIGNAL_MODEL_DRAFTING=claude-opus-5-5.
 */
import type { AgentType } from "@/types/domain";

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelRoute {
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Request timeout in ms — agents fall back to deterministic logic when exceeded. */
  timeoutMs: number;
}

const ROUTES: Record<AgentType, ModelRoute> = {
  intake: { model: MODELS.haiku, effort: "low", maxTokens: 6000, timeoutMs: 30_000 },
  reply_parser: { model: MODELS.haiku, effort: "low", maxTokens: 6000, timeoutMs: 30_000 },
  qualification: { model: MODELS.haiku, effort: "low", maxTokens: 4000, timeoutMs: 30_000 },
  scoring: { model: MODELS.haiku, effort: "low", maxTokens: 4000, timeoutMs: 30_000 },
  summary: { model: MODELS.haiku, effort: "low", maxTokens: 4000, timeoutMs: 30_000 },
  booking: { model: MODELS.haiku, effort: "low", maxTokens: 4000, timeoutMs: 30_000 },
  knowledge: { model: MODELS.sonnet, effort: "low", maxTokens: 6000, timeoutMs: 45_000 },
  drafting: { model: MODELS.sonnet, effort: "low", maxTokens: 6000, timeoutMs: 45_000 },
  follow_up: { model: MODELS.sonnet, effort: "low", maxTokens: 6000, timeoutMs: 45_000 },
  handoff: { model: MODELS.sonnet, effort: "medium", maxTokens: 8000, timeoutMs: 60_000 },
};

export function routeFor(agent: AgentType): ModelRoute {
  const route = ROUTES[agent];
  const override = process.env[`SIGNAL_MODEL_${agent.toUpperCase()}`];
  return override ? { ...route, model: override } : route;
}

/** USD per million tokens (input, output). Used for per-organization cost tracking. */
const PRICING: Record<string, { input: number; output: number }> = {
  [MODELS.haiku]: { input: 0.1, output: 0.5 },
  [MODELS.sonnet]: { input: 2, output: 10 },
  [MODELS.opus]: { input: 4, output: 20 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICING[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Models that support the server-side refusal fallback (`fallbacks: "default"`). */
export function supportsServerFallback(model: string): boolean {
  return model === MODELS.sonnet || model === MODELS.opus || model.startsWith("claude-fable-5");
}
