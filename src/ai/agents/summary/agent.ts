import { z } from "zod";
import type { AgentDefinition } from "@/ai/runtime/run-agent";
import { GUARDRAILS } from "../shared/context";
import { truncate } from "../shared/text-signals";

export const summaryOutputSchema = z.object({ summary: z.string() });
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

export interface SummaryInput {
  businessName: string;
  leadName: string | null;
  facts: Record<string, string | null>;
  transcript: string;
}

export function summaryHeuristic(i: SummaryInput): SummaryOutput {
  const f = i.facts;
  const who = i.leadName ?? "Lead";
  const svc = f.service ? `needs ${f.service.toLowerCase()}` : "made an inquiry";
  const where = f.location ? ` in ${f.location}` : "";
  const when = f.timeline ? `, timeline: ${f.timeline}` : "";
  const status = f.status ? ` ${f.status}` : "";
  return { summary: `${who} ${svc}${where}${when}.${status}`.trim() };
}

/** Owner-facing summary. Cached per conversation by message count — never re-run on unchanged threads. */
export const summaryAgent: AgentDefinition<SummaryInput, SummaryOutput> = {
  type: "summary",
  schema: summaryOutputSchema,
  system: (i) => `Summarise this lead for the owner of ${i.businessName} in at most two short sentences: what they need, key facts (location, timeline, budget), and where things stand. Facts only.
${GUARDRAILS}`,
  prompt: (i) => `Known facts: ${Object.entries(i.facts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")}

<conversation>
${i.transcript}
</conversation>`,
  heuristic: summaryHeuristic,
  normalize: (o) => ({ summary: truncate(o.summary.trim(), 320) }),
  describeInput: (i) => ({ facts: i.facts }),
};
