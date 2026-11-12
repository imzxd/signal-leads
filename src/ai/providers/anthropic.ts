import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AgentType } from "@/types/domain";
import { routeFor, supportsServerFallback } from "./models";
import {
  ModelOutputError,
  type AIProvider,
  type MessageRequest,
  type MessageResult,
  type StructuredRequest,
  type StructuredResult,
  type Usage,
} from "./types";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Claude via the official Anthropic SDK.
 * - Structured output: `client.beta.messages.parse` + Zod (validated again by the agent runtime).
 * - Refusals: Sonnet/Opus routes opt into the server-side fallback; any remaining
 *   refusal surfaces as a ModelOutputError so the agent falls back deterministically.
 */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly live = true;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  private common(task: AgentType) {
    const route = routeFor(task);
    const fallback = supportsServerFallback(route.model);
    return {
      route,
      params: {
        model: route.model,
        max_tokens: route.maxTokens,
        output_config: { effort: route.effort },
        ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      },
      options: { timeout: route.timeoutMs },
    };
  }

  async generateStructuredObject<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const { params, options } = this.common(req.task);
    const response = await this.client.beta.messages.parse(
      {
        ...params,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: { ...params.output_config, format: betaZodOutputFormat(req.schema as never) },
      },
      options,
    );
    if (response.stop_reason === "refusal") {
      throw new ModelOutputError(`Model declined the request (${response.stop_details?.category ?? "unspecified"})`, false);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelOutputError("Model output was truncated (max_tokens)", true);
    }
    if (response.parsed_output == null) {
      throw new ModelOutputError("Model returned no parseable structured output", true);
    }
    return { output: response.parsed_output as T, model: response.model, usage: usageOf(response.usage) };
  }

  async generateMessage(req: MessageRequest): Promise<MessageResult> {
    const { params, options } = this.common(req.task);
    const response = await this.client.beta.messages.create(
      { ...params, system: req.system, messages: [{ role: "user", content: req.prompt }] },
      options,
    );
    if (response.stop_reason === "refusal") {
      throw new ModelOutputError("Model declined the request", false);
    }
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text) throw new ModelOutputError("Model returned an empty message", true);
    return { text, model: response.model, usage: usageOf(response.usage) };
  }

  summarize(req: { task: AgentType; text: string; instructions?: string }): Promise<MessageResult> {
    return this.generateMessage({
      task: req.task,
      system:
        req.instructions ??
        "Summarize the conversation for a busy business owner in two short sentences. State facts only; do not speculate.",
      prompt: req.text,
    });
  }
}

function usageOf(u: { input_tokens?: number | null; output_tokens?: number | null } | undefined): Usage {
  return { inputTokens: u?.input_tokens ?? null, outputTokens: u?.output_tokens ?? null };
}
