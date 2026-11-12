import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Phone, ShieldCheck } from "lucide-react";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { getSettings } from "@/server/repositories/settings";
import { KimeEndorsement } from "@/components/brand/brand-logo";
import { SignalMark } from "@/components/brand/marks";
import { LeadForm } from "./lead-form";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  const db = await getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org || org.status !== "active") return null;
  return getSettings(systemContext(db, org.id));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = await load((await params).slug);
  return { title: s ? `${s.form.headline} — ${s.businessName}` : "Form not found", robots: { index: false } };
}

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { slug } = await params;
  const embed = (await searchParams).embed === "1";
  const s = await load(slug);
  if (!s) notFound();
  const services = s.services.filter((x) => x.enabled).map((x) => ({ key: x.key, name: x.name }));

  return (
    <main className={embed ? "px-4 py-6" : "flex min-h-screen items-start justify-center px-4 py-10 sm:py-16"}>
      <div className="w-full max-w-xl">
        {!embed && (
          <header className="mb-8 text-center">
            <p className="eyebrow">{s.businessName}</p>
            <h1 className="mt-2 font-display text-4xl leading-tight">{s.form.headline}</h1>
            <p className="mt-2 text-sm text-foreground-muted">{s.form.subheadline}</p>
            {s.phone && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-foreground-subtle">
                <Phone className="size-3.5" aria-hidden /> Prefer to call? {s.phone}
              </p>
            )}
          </header>
        )}
        <div className="card p-5 sm:p-6">
          <LeadForm slug={slug} embed={embed} services={services} askCompany={s.form.askCompany} consentText={s.form.consentText} successMessage={s.form.successMessage} businessName={s.businessName} />
        </div>
        <footer className="mt-5 flex flex-col items-center gap-2 text-[11px] text-foreground-subtle">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden /> Your details are only used to respond to this request.
          </span>
          <span className="inline-flex items-center gap-2">
            <SignalMark className="size-4" /> Powered by Signal Leads · <KimeEndorsement />
          </span>
        </footer>
      </div>
    </main>
  );
}
