import type { Metadata } from "next";
import { requireOrgContext } from "@/lib/auth/session";
import { listDocuments } from "@/server/repositories/knowledge";
import { getEmbeddingProvider } from "@/ai/providers";
import { PageHeader } from "@/components/ui/primitives";
import { KnowledgeClient } from "@/components/knowledge/knowledge-client";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage() {
  const { session, ctx } = await requireOrgContext();
  const docs = await listDocuments(ctx);
  const embedder = getEmbeddingProvider();
  return (
    <div>
      <PageHeader eyebrow="Knowledge" title="Business knowledge" description="Signal answers customer questions only from what's written here — never from guesswork." />
      <KnowledgeClient
        canEdit={session.role !== "member"}
        embeddingLabel={embedder.live ? embedder.model : "development hashing (add VOYAGE_API_KEY for semantic search)"}
        docs={docs.map((d) => ({ id: d.id, title: d.title, type: d.type, status: d.status, content: d.content, chunkCount: d.chunkCount, lastIndexedAt: d.lastIndexedAt?.toISOString() ?? null, error: d.error }))}
      />
    </div>
  );
}
