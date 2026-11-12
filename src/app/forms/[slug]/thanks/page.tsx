import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CheckCircle2, Clock, MessageSquare } from "lucide-react";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { getSettings } from "@/server/repositories/settings";
import { KimeEndorsement } from "@/components/brand/brand-logo";
import { SignalMark } from "@/components/brand/marks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Request received", robots: { index: false } };

export default async function ThanksPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ channel?: string; embed?: string }> }) {
  const { slug } = await params;
  const { channel, embed } = await searchParams;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) notFound();
  const db = await getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org) notFound();
  const s = await getSettings(systemContext(db, org.id));
  const via = channel === "sms" ? "a text message" : "an email";

  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-16">
      <div className="w-full max-w-md text-center animate-slide-up">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
          <CheckCircle2 className="size-7 text-accent" aria-hidden />
        </span>
        <p className="eyebrow mt-6">{s.businessName}</p>
        <h1 className="mt-2 font-display text-4xl">Request received</h1>
        <p className="mt-3 text-sm text-foreground-muted">{s.form.successMessage}</p>
        <ul className="card mt-8 space-y-3 p-5 text-left text-sm">
          <li className="flex gap-3">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span className="text-foreground-muted">You&apos;ll get {via} shortly with any questions we need answered.</span>
          </li>
          <li className="flex gap-3">
            <Clock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span className="text-foreground-muted">Once we have the details, we&apos;ll offer the next available appointment times.</span>
          </li>
        </ul>
        {!embed && s.website && (
          <Link href={s.website} className="mt-6 inline-block text-xs text-foreground-muted hover:text-foreground">
            Back to {s.businessName}
          </Link>
        )}
        <p className="mt-10 inline-flex items-center gap-2 text-[11px] text-foreground-subtle">
          <SignalMark className="size-4" /> Powered by Signal Leads · <KimeEndorsement />
        </p>
      </div>
    </main>
  );
}
