"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BookOpen, FileText, Pencil, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { deleteDocumentAction, reindexDocumentAction, saveDocumentAction, testKnowledgeAction } from "@/server/actions/knowledge";
import { KNOWLEDGE_TYPES, type KnowledgeType } from "@/types/domain";
import { relativeTime } from "@/lib/utils";

export interface DocRow {
  id: string;
  title: string;
  type: KnowledgeType;
  status: string;
  content: string;
  chunkCount: number;
  lastIndexedAt: string | null;
  error: string | null;
}

const TYPE_LABEL: Record<KnowledgeType, string> = { faq: "FAQ", service: "Service", policy: "Policy", business_info: "Business info", document: "Document" };

export function KnowledgeClient({ docs, canEdit, embeddingLabel }: { docs: DocRow[]; canEdit: boolean; embeddingLabel: string }) {
  const [editing, setEditing] = useState<DocRow | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocRow | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-foreground-muted">
            {docs.length} documents · {docs.reduce((s, d) => s + d.chunkCount, 0)} chunks · embeddings: {embeddingLabel}
          </p>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
              <Plus /> Add knowledge
            </Button>
          )}
        </div>
        {docs.length === 0 ? (
          <Card>
            <EmptyState icon={<BookOpen />} title="No knowledge yet" description="Add your services, FAQs, policies and service area. Signal only answers from what's here." />
          </Card>
        ) : (
          docs.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="size-4 text-foreground-subtle" aria-hidden />
                    <h2 className="text-sm font-medium">{d.title}</h2>
                    <Badge>{TYPE_LABEL[d.type]}</Badge>
                    <Badge tone={d.status === "indexed" ? "lime" : d.status === "failed" ? "danger" : "warning"}>{d.status}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-foreground-subtle">
                    {d.chunkCount} chunks · last indexed {relativeTime(d.lastIndexedAt)}
                    {d.error && <span className="text-danger"> · {d.error}</span>}
                  </p>
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs text-foreground-muted">{d.content}</p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Re-index ${d.title}`} disabled={pending} onClick={() => start(async () => notify(await reindexDocumentAction(d.id)))}>
                      <RefreshCcw />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${d.title}`} onClick={() => setEditing(d)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.title}`} onClick={() => setConfirmDelete(d)}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <TestPanel />

      <DocDialog doc={editing} onClose={() => setEditing(null)} />
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent title={`Delete “${confirmDelete?.title}”?`} description="Signal will no longer use this information. This can't be undone.">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  if (confirmDelete) notify(await deleteDocumentAction(confirmDelete.id));
                  setConfirmDelete(null);
                })
              }
            >
              <Trash2 /> Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function notify(r: { ok: boolean; message?: string; error?: string }) {
  if (r.ok) toast.success(r.message ?? "Done");
  else toast.error(r.error);
}

function DocDialog({ doc, onClose }: { doc: DocRow | "new" | null; onClose: () => void }) {
  const existing = doc && doc !== "new" ? doc : null;
  const [pending, start] = useTransition();
  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={existing ? "Edit knowledge" : "Add knowledge"} description="Write it the way you'd explain it to a new employee. For FAQs, use “Q:” and “A:” lines." className="max-w-2xl">
        <form
          key={existing?.id ?? "new"}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await saveDocumentAction(existing?.id ?? null, { title: f.get("title"), type: f.get("type"), content: f.get("content") });
              notify(r);
              if (r.ok) onClose();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Title" htmlFor="kd-title">
              <Input id="kd-title" name="title" defaultValue={existing?.title} required maxLength={200} />
            </Field>
            <Field label="Type" htmlFor="kd-type">
              <Select id="kd-type" name="type" defaultValue={existing?.type ?? "faq"}>
                {KNOWLEDGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Content" htmlFor="kd-content">
            <Textarea id="kd-content" name="content" rows={12} defaultValue={existing?.content} required className="font-mono text-xs" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Save &amp; index
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TestPanel() {
  const [q, setQ] = useState("Do you offer financing?");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<null | { answer: string | null; confidence: number; sources: string[]; retrieved: { title: string; score: number; preview: string }[] }>(null);
  return (
    <Card className="h-fit p-4 xl:sticky xl:top-4">
      <h2 className="text-sm font-medium">Test a question</h2>
      <p className="mt-0.5 text-xs text-foreground-muted">See exactly what Signal would answer — and when it refuses to guess.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await testKnowledgeAction(q);
            if (r.ok && r.data) setResult(r.data);
            else if (!r.ok) toast.error(r.error);
          });
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" />
        <Button type="submit" variant="secondary" size="icon" loading={pending} aria-label="Ask">
          {!pending && <Search />}
        </Button>
      </form>
      {result && (
        <div className="mt-4 space-y-3 animate-fade-in">
          {result.answer ? (
            <div className="rounded-md border border-accent/30 bg-accent/[0.06] p-3">
              <p className="text-[10px] uppercase tracking-wider text-kime">Signal would answer</p>
              <p className="mt-1 text-sm">{result.answer}</p>
              <p className="mt-2 text-[11px] text-foreground-subtle">
                Confidence {Math.round(result.confidence * 100)}% · {result.sources.join(", ")}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning/[0.06] p-3">
              <p className="text-[10px] uppercase tracking-wider text-warning">No grounded answer</p>
              <p className="mt-1 text-sm text-foreground-muted">Signal won&apos;t guess. It tells the customer the team will confirm, and flags the question for you.</p>
            </div>
          )}
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-foreground-subtle">Retrieved chunks</p>
            <ul className="space-y-1.5">
              {result.retrieved.map((r, i) => (
                <li key={i} className="rounded border border-border p-2 text-[11px]">
                  <span className="text-foreground">{r.title}</span> <span className="text-foreground-subtle">· relevance {r.score}</span>
                  <p className="mt-0.5 line-clamp-2 text-foreground-muted">{r.preview}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
