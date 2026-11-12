import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { knowledgeChunks, knowledgeDocuments, type KnowledgeDocument } from "@/server/db/schema";
import { NotFoundError, type OrgContext } from "@/server/context";
import { queryRows } from "@/server/db/client";
import { getEmbeddingProvider } from "@/ai/providers";
import { chunkDocument } from "@/features/knowledge/chunker";
import type { KnowledgeChunkRef } from "@/ai/agents/knowledge/agent";
import type { KnowledgeType } from "@/types/domain";
import { logger } from "@/lib/observability/logger";

export async function listDocuments(ctx: OrgContext): Promise<KnowledgeDocument[]> {
  return ctx.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, ctx.organizationId)).orderBy(desc(knowledgeDocuments.updatedAt));
}

export async function getDocument(ctx: OrgContext, id: string): Promise<KnowledgeDocument> {
  const [doc] = await ctx.db
    .select()
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, ctx.organizationId)))
    .limit(1);
  if (!doc) throw new NotFoundError("Knowledge document");
  return doc;
}

export async function createDocument(ctx: OrgContext, input: { title: string; type: KnowledgeType; content: string }, createdBy: string | null) {
  const [doc] = await ctx.db
    .insert(knowledgeDocuments)
    .values({ organizationId: ctx.organizationId, title: input.title, type: input.type, content: input.content, createdBy, status: "pending" })
    .returning();
  return indexDocument(ctx, doc.id);
}

export async function updateDocument(ctx: OrgContext, id: string, input: { title: string; type: KnowledgeType; content: string }) {
  await getDocument(ctx, id);
  await ctx.db
    .update(knowledgeDocuments)
    .set({ ...input, status: "pending" })
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, ctx.organizationId)));
  return indexDocument(ctx, id);
}

export async function deleteDocument(ctx: OrgContext, id: string) {
  await ctx.db.delete(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, ctx.organizationId)));
}

/** document → clean → chunk → embed → knowledge_chunks. Failures are recorded on the document. */
export async function indexDocument(ctx: OrgContext, id: string): Promise<KnowledgeDocument> {
  const doc = await getDocument(ctx, id);
  await ctx.db.update(knowledgeDocuments).set({ status: "indexing", error: null }).where(eq(knowledgeDocuments.id, id));
  try {
    const chunks = chunkDocument(doc.title, doc.content);
    const embedder = getEmbeddingProvider();
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += 64) {
      const batch = await embedder.embed(chunks.slice(i, i + 64).map((c) => c.content), "document");
      vectors.push(...batch.vectors);
    }
    await ctx.db.transaction(async (tx) => {
      await tx.delete(knowledgeChunks).where(and(eq(knowledgeChunks.documentId, id), eq(knowledgeChunks.organizationId, ctx.organizationId)));
      if (chunks.length) {
        await tx.insert(knowledgeChunks).values(
          chunks.map((c, i) => ({
            organizationId: ctx.organizationId,
            documentId: id,
            chunkIndex: c.index,
            content: c.content,
            embedding: vectors[i],
            embeddingModel: embedder.model,
            tokenEstimate: c.tokenEstimate,
            metadata: { type: doc.type, title: doc.title },
          })),
        );
      }
    });
    const [updated] = await ctx.db
      .update(knowledgeDocuments)
      .set({ status: "indexed", chunkCount: chunks.length, lastIndexedAt: new Date(), error: null })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    return updated;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("knowledge.index_failed", { documentId: id, error });
    const [failed] = await ctx.db.update(knowledgeDocuments).set({ status: "failed", error }).where(eq(knowledgeDocuments.id, id)).returning();
    return failed;
  }
}

/**
 * Hybrid retrieval: cosine similarity (pgvector) blended with Postgres full-text rank.
 * Only the top-k relevant chunks are ever sent to a model — never the whole knowledge base.
 */
export async function searchKnowledge(ctx: OrgContext, query: string, k = 4): Promise<KnowledgeChunkRef[]> {
  const embedder = getEmbeddingProvider();
  const [vector] = (await embedder.embed([query], "query")).vectors;
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 12);
  const tsQuery = terms.length ? terms.join(" | ") : "zzzz";
  const vec = `[${vector.map((x) => x.toFixed(6)).join(",")}]`;
  const rows = await queryRows<{ id: string; content: string; title: string; similarity: number; rank: number }>(
    ctx.db,
    sql`
      select c.id, c.content, d.title,
             1 - (c.embedding <=> ${vec}::vector) as similarity,
             ts_rank(c.fts, to_tsquery('english', ${tsQuery})) as rank
      from knowledge_chunks c
      join knowledge_documents d on d.id = c.document_id
      where c.organization_id = ${ctx.organizationId}
        and d.status = 'indexed'
        and c.embedding_model = ${embedder.model}
      order by (0.6 * (1 - (c.embedding <=> ${vec}::vector)) + 0.4 * least(1, ts_rank(c.fts, to_tsquery('english', ${tsQuery})) * 4)) desc
      limit ${k}
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    score: Math.max(0, 0.6 * Number(r.similarity) + 0.4 * Math.min(1, Number(r.rank) * 4)),
  }));
}

export async function chunkTitles(ctx: OrgContext, chunkIds: string[]): Promise<string[]> {
  if (!chunkIds.length) return [];
  const rows = await ctx.db
    .select({ title: knowledgeDocuments.title })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
    .where(and(eq(knowledgeChunks.organizationId, ctx.organizationId), inArray(knowledgeChunks.id, chunkIds)));
  return [...new Set(rows.map((r) => r.title))];
}
