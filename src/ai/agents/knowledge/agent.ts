import type { AgentDefinition } from "@/ai/runtime/run-agent";
import { clamp01 } from "../shared/context";
import { knowledgeSystemPrompt, knowledgeUserPrompt } from "./prompt";
import { knowledgeOutputSchema, type KnowledgeOutput } from "./schema";

export interface KnowledgeChunkRef {
  id: string;
  title: string;
  content: string;
  /** Retrieval score from hybrid search (0..1-ish). */
  score: number;
}

export interface KnowledgeInput {
  businessName: string;
  question: string;
  chunks: KnowledgeChunkRef[];
}

/** Below this confidence the orchestrator escalates instead of answering. */
export const KNOWLEDGE_MIN_CONFIDENCE = 0.55;

/** Function words and question filler that carry no topic meaning. */
const STOP = new Set(
  "a an the and or of to in on for with is are be do does did you your we our us i my me it its can could would should will what how much many when where which who there any have has had get got offer offers provide provides option options available please about like know tell just also some kind type".split(" "),
);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ies|es|s)$/, ""));

function overlap(question: string, text: string): number {
  const q = new Set(tokens(question));
  if (q.size === 0) return 0;
  const t = new Set(tokens(text));
  let hits = 0;
  q.forEach((w) => t.has(w) && hits++);
  return hits / q.size;
}

/** Split a chunk into FAQ pairs or sentences and return the best-matching span. */
function bestSpan(question: string, content: string): { text: string; score: number } {
  const faq = [...content.matchAll(/Q:\s*([\s\S]+?)\s*A:\s*([\s\S]+?)(?=\n\s*Q:|$)/g)];
  if (faq.length) {
    return faq
      .map((m) => ({ text: m[2].trim(), score: overlap(question, m[1]) * 0.8 + overlap(question, m[2]) * 0.2 }))
      .sort((a, b) => b.score - a.score)[0];
  }
  const sentences = content.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 15);
  const scored = sentences.map((s, i) => ({ i, score: overlap(question, s) })).sort((a, b) => b.score - a.score);
  if (!scored.length) return { text: content.slice(0, 300), score: 0 };
  const top = scored[0];
  const text = [sentences[top.i], sentences[top.i + 1]].filter(Boolean).join(" ");
  return { text, score: top.score };
}

export function knowledgeHeuristic(input: KnowledgeInput): KnowledgeOutput {
  const candidates = input.chunks
    .map((c) => ({ c, span: bestSpan(input.question, c.content) }))
    .map((x) => ({ ...x, combined: x.span.score * 0.75 + Math.min(1, x.c.score) * 0.25 }))
    .sort((a, b) => b.combined - a.combined);
  const best = candidates[0];
  if (!best || best.span.score < 0.34) {
    return { answerable: false, answer: null, sourceIds: [], confidence: 0.3 };
  }
  return {
    answerable: true,
    answer: best.span.text.length > 420 ? `${best.span.text.slice(0, 417)}…` : best.span.text,
    sourceIds: [best.c.id],
    confidence: clamp01(0.45 + best.combined * 0.5),
  };
}

export function normalizeKnowledge(o: KnowledgeOutput, input: KnowledgeInput): KnowledgeOutput {
  const valid = new Set(input.chunks.map((c) => c.id));
  const sourceIds = o.sourceIds.filter((id) => valid.has(id));
  // Grounding requirement: an answer without a valid source is treated as unanswerable.
  const answerable = o.answerable && Boolean(o.answer?.trim()) && sourceIds.length > 0;
  return {
    answerable,
    answer: answerable ? o.answer!.trim() : null,
    sourceIds: answerable ? sourceIds : [],
    confidence: answerable ? clamp01(o.confidence) : Math.min(clamp01(o.confidence), 0.4),
  };
}

export const knowledgeAgent: AgentDefinition<KnowledgeInput, KnowledgeOutput> = {
  type: "knowledge",
  schema: knowledgeOutputSchema,
  system: knowledgeSystemPrompt,
  prompt: knowledgeUserPrompt,
  heuristic: knowledgeHeuristic,
  normalize: normalizeKnowledge,
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ question: i.question, chunkIds: i.chunks.map((c) => c.id) }),
};
