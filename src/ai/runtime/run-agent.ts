import type { z } from "zod";
import type { AgentType } from "@/types/domain";
import type { Database } from "@/server/db/client";
import { agentRuns } from "@/server/db/schema";
import { getAIProvider } from "@/ai/providers";
import { estimateCostUsd } from "@/ai/providers/models";
import { ModelOutputError, ProviderUnavailableError, type Usage } from "@/ai/providers/types";
import { logger } from "@/lib/observability/logger";

/**
 * Every agent is a typed, single-responsibility function:
 *   typed input → prompt → Claude structured output → Zod validation → business normalization
 * with a deterministic heuristic that produces the same typed output when the model is
 * unavailable, slow, refuses, or returns something invalid. Agents never touch the
 * database or send messages — the orchestrator executes their decisions through tools.
 */
export interface AgentDefinition<I, O> {
  type: AgentType;
  /** Schema the model must satisfy; also used to validate heuristic output. */
  schema: z.ZodType<O>;
  system: (input: I) => string;
  prompt: (input: I) => string;
  heuristic: (input: I) => O;
  /** Enforce business constraints the schema can't express (whitelists, clamping). */
  normalize?: (output: O, input: I) => O;
  confidence?: (output: O) => number | null;
  /** Compact, log-safe view of the input for agent_runs. */
  describeInput?: (input: I) => unknown;
}

export interface AgentContext {
  db?: Database;
  organizationId?: string;
  leadId?: string | null;
}

export interface AgentOutcome<O> {
  output: O;
  runId: string | null;
  status: "succeeded" | "fallback";
  provider: string;
  model: string;
  /** True when the deterministic heuristic produced the output (always true on the dev provider). */
  heuristic: boolean;
  /** True only when a live model failed and the heuristic stepped in. */
  fellBack: boolean;
  error?: string;
  latencyMs: number;
}

const MAX_ATTEMPTS = 2;

export async function runAgent<I, O>(def: AgentDefinition<I, O>, input: I, ctx: AgentContext = {}): Promise<AgentOutcome<O>> {
  const provider = await getAIProvider();
  const started = Date.now();
  let output: O | null = null;
  let model = "heuristic";
  let usage: Usage = { inputTokens: null, outputTokens: null };
  let error: string | undefined;
  let attempts = 0;

  if (provider.live) {
    for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
      try {
        const res = await provider.generateStructuredObject({
          task: def.type,
          system: def.system(input),
          prompt: def.prompt(input),
          schema: def.schema,
        });
        // Never trust raw model JSON — validate again even though the SDK parsed it.
        const parsed = def.schema.safeParse(res.output);
        if (!parsed.success) throw new ModelOutputError(`Schema validation failed: ${parsed.error.issues[0]?.message ?? "invalid"}`, true);
        output = def.normalize ? def.normalize(parsed.data, input) : parsed.data;
        model = res.model;
        usage = res.usage;
        error = undefined;
        break;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        const retryable = e instanceof ModelOutputError && e.retryable;
        logger.warn("agent.model_attempt_failed", { agent: def.type, attempt: attempts, error });
        if (!retryable || e instanceof ProviderUnavailableError) break;
      }
    }
  }

  let usedHeuristic = false;
  if (output === null) {
    usedHeuristic = true;
    const raw = def.heuristic(input);
    const checked = def.schema.safeParse(raw);
    if (!checked.success) {
      // A broken heuristic is a programming error — surface loudly.
      throw new Error(`[${def.type}] heuristic produced invalid output: ${checked.error.issues[0]?.message}`);
    }
    output = def.normalize ? def.normalize(checked.data, input) : checked.data;
    model = provider.live ? "heuristic-fallback" : "dev-heuristic";
  }

  const latencyMs = Date.now() - started;
  const status: AgentOutcome<O>["status"] = provider.live && usedHeuristic ? "fallback" : "succeeded";
  const confidence = def.confidence?.(output) ?? null;

  let runId: string | null = null;
  if (ctx.db && ctx.organizationId) {
    try {
      const [row] = await ctx.db
        .insert(agentRuns)
        .values({
          organizationId: ctx.organizationId,
          leadId: ctx.leadId ?? null,
          agent: def.type,
          provider: usedHeuristic ? (provider.live ? "anthropic→heuristic" : provider.id) : provider.id,
          model,
          status,
          input: compact(def.describeInput ? def.describeInput(input) : input),
          output: compact(output),
          confidence: confidence === null ? null : round3(confidence),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCostUsd: usage.inputTokens != null && usage.outputTokens != null ? estimateCostUsd(model, usage.inputTokens, usage.outputTokens) : null,
          latencyMs,
          attempts: Math.max(1, attempts),
          error: error ?? null,
        })
        .returning({ id: agentRuns.id });
      runId = row.id;
    } catch (e) {
      logger.error("agent.run_log_failed", { agent: def.type, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { output, runId, status, provider: provider.id, model, heuristic: usedHeuristic, fellBack: status === "fallback", error, latencyMs };
}

const round3 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;

/** Truncate long strings so agent_runs stays small and log-friendly. */
function compact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return value ?? null;
  if (typeof value === "string") return value.length > 1500 ? `${value.slice(0, 1500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 25).map((v) => compact(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, compact(v, depth + 1)]));
  }
  return value;
}
