"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgContext, requireRole } from "@/lib/auth/session";
import { createDocument, deleteDocument, getDocument, indexDocument, searchKnowledge, updateDocument } from "@/server/repositories/knowledge";
import { audit } from "@/server/repositories/audit";
import { getSettings } from "@/server/repositories/settings";
import { runAgent } from "@/ai/runtime/run-agent";
import { knowledgeAgent, KNOWLEDGE_MIN_CONFIDENCE } from "@/ai/agents/knowledge/agent";
import { KNOWLEDGE_TYPES } from "@/types/domain";
import { act, UserError } from "./result";

const docSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  type: z.enum(KNOWLEDGE_TYPES),
  content: z.string().trim().min(10, "Add some content").max(50_000, "Keep documents under 50,000 characters"),
});

export async function saveDocumentAction(id: string | null, input: unknown) {
  return act("saveDocument", async () => {
    const { session, ctx } = await requireOrgContext();
    requireRole(session, ["owner", "admin"]);
    const data = docSchema.parse(input);
    const doc = id ? await updateDocument(ctx, z.string().uuid().parse(id), data) : await createDocument(ctx, data, session.userId);
    await audit(ctx, id ? "knowledge.updated" : "knowledge.created", "knowledge_document", doc.id, { title: doc.title });
    revalidatePath("/knowledge");
    if (doc.status === "failed") throw new UserError(`Saved, but indexing failed: ${doc.error}`);
  }, id ? "Document updated and re-indexed." : "Document added and indexed.");
}

export async function deleteDocumentAction(id: string) {
  return act("deleteDocument", async () => {
    const { session, ctx } = await requireOrgContext();
    requireRole(session, ["owner", "admin"]);
    const doc = await getDocument(ctx, z.string().uuid().parse(id));
    await deleteDocument(ctx, doc.id);
    await audit(ctx, "knowledge.deleted", "knowledge_document", doc.id, { title: doc.title });
    revalidatePath("/knowledge");
  }, "Document deleted.");
}

export async function reindexDocumentAction(id: string) {
  return act("reindexDocument", async () => {
    const { ctx } = await requireOrgContext();
    const doc = await indexDocument(ctx, z.string().uuid().parse(id));
    revalidatePath("/knowledge");
    if (doc.status === "failed") throw new UserError(`Indexing failed: ${doc.error}`);
  }, "Re-indexed.");
}

/** Ask the knowledge base a question exactly as Signal would during a conversation. */
export async function testKnowledgeAction(question: string) {
  return act("testKnowledge", async () => {
    const { ctx } = await requireOrgContext();
    const q = z.string().trim().min(3, "Ask a question").max(500).parse(question);
    const settings = await getSettings(ctx);
    const chunks = await searchKnowledge(ctx, q, 4);
    const out = await runAgent(knowledgeAgent, { businessName: settings.businessName, question: q, chunks }, { db: ctx.db, organizationId: ctx.organizationId });
    const used = out.output.answerable && out.output.confidence >= KNOWLEDGE_MIN_CONFIDENCE;
    return {
      answer: used ? out.output.answer : null,
      confidence: out.output.confidence,
      sources: chunks.filter((c) => out.output.sourceIds.includes(c.id)).map((c) => c.title),
      retrieved: chunks.map((c) => ({ title: c.title, score: Math.round(c.score * 100) / 100, preview: c.content.slice(0, 160) })),
    };
  });
}
