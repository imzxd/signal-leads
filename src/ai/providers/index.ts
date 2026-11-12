import { env, features } from "@/lib/env";
import { DevHeuristicProvider } from "./dev";
import { HashingEmbeddingProvider, VoyageEmbeddingProvider } from "./embeddings";
import type { AIProvider, EmbeddingProvider } from "./types";

let aiOverride: AIProvider | null = null;
let ai: AIProvider | null = null;
let embeddings: EmbeddingProvider | null = null;

export async function getAIProvider(): Promise<AIProvider> {
  if (aiOverride) return aiOverride;
  if (ai) return ai;
  if (features.liveAI()) {
    const { AnthropicProvider } = await import("./anthropic");
    ai = new AnthropicProvider(env().ANTHROPIC_API_KEY!);
  } else {
    ai = new DevHeuristicProvider();
  }
  return ai;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddings) return embeddings;
  embeddings = features.voyageEmbeddings()
    ? new VoyageEmbeddingProvider(env().VOYAGE_API_KEY!)
    : new HashingEmbeddingProvider();
  return embeddings;
}

/** Test hook: inject a fake provider (e.g. one that returns malformed output). */
export function setAIProviderForTesting(provider: AIProvider | null) {
  aiOverride = provider;
}

export function describeAIMode(): { live: boolean; label: string; detail: string } {
  return features.liveAI()
    ? { live: true, label: "Claude", detail: "Agents run on Anthropic Claude with deterministic fallbacks." }
    : {
        live: false,
        label: "Development provider",
        detail: "No ANTHROPIC_API_KEY set — agents use built-in deterministic heuristics. Add a key to enable Claude.",
      };
}

export type { AIProvider, EmbeddingProvider } from "./types";
