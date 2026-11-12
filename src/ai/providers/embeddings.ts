import type { EmbeddingProvider, EmbeddingResult } from "./types";

export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Voyage AI embeddings (Anthropic's recommended embedding partner).
 * Uses output_dimension=1024 to match the knowledge_chunks.embedding column.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = "voyage";
  readonly live = true;
  constructor(private apiKey: string, readonly model = "voyage-3.5") {}

  async embed(texts: string[], purpose: "document" | "query"): Promise<EmbeddingResult> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: this.model, input_type: purpose, output_dimension: EMBEDDING_DIMENSIONS }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Voyage embeddings failed: HTTP ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    const vectors = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { vectors, model: `voyage:${this.model}` };
  }
}

/**
 * DEVELOPMENT EMBEDDINGS — deterministic feature hashing (word unigrams + bigrams +
 * character trigrams). No semantic understanding, but stable and good enough for
 * keyword-ish retrieval in demos. Retrieval also blends Postgres full-text rank.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly id = "dev-hashing";
  readonly model = "dev-hashing-1024";
  readonly live = false;

  async embed(texts: string[]): Promise<EmbeddingResult> {
    return { vectors: texts.map((t) => hashEmbed(t)), model: this.model };
  }
}

const STOPWORDS = new Set("a an the and or but if of to in on for with at by from is are was were be been do does did i you we they it this that my our your me us can could would should will what how when where which who".split(" "));

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, "");
}

export function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
  const bump = (token: string, weight: number) => {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBEDDING_DIMENSIONS;
    v[idx] += (h & 1 ? 1 : -1) * weight;
  };
  words.forEach((w, i) => {
    bump(`w:${w}`, 1);
    if (i > 0) bump(`b:${words[i - 1]}_${w}`, 0.6);
    for (let j = 0; j + 3 <= w.length; j++) bump(`c:${w.slice(j, j + 3)}`, 0.25);
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
