import type { z } from "zod";
import type { AgentType } from "@/types/domain";

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface StructuredRequest<T> {
  task: AgentType;
  system: string;
  prompt: string;
  /** Schema the model must satisfy. Keep it simple: objects, strings, numbers, enums, nullables, arrays. */
  schema: z.ZodType<T>;
}

export interface StructuredResult<T> {
  output: T;
  model: string;
  usage: Usage;
}

export interface MessageRequest {
  task: AgentType;
  system: string;
  prompt: string;
}

export interface MessageResult {
  text: string;
  model: string;
  usage: Usage;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
}

/**
 * Provider abstraction. Agents never import an SDK directly.
 * `live === false` marks a development provider: agents then use their
 * deterministic heuristics and every run is labelled as such.
 */
export interface AIProvider {
  readonly id: string;
  readonly live: boolean;
  generateStructuredObject<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  generateMessage(req: MessageRequest): Promise<MessageResult>;
  summarize(req: { task: AgentType; text: string; instructions?: string }): Promise<MessageResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly live: boolean;
  embed(texts: string[], purpose: "document" | "query"): Promise<EmbeddingResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(message = "AI provider is running in development mode") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ModelOutputError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ModelOutputError";
  }
}
