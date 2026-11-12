import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { BrandLogo, KimeLogo } from "@/components/brand/brand-logo";
import { BRAND } from "@/components/brand/brand-config";
import { features } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { enterDemoWorkspace } from "../actions";
import { SubmitButton } from "@/components/shared/submit-button";
import { SupabaseSignIn } from "./supabase-sign-in";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const POINTS = [
  "Replies to every new lead in seconds — with your rules, your voice",
  "Qualifies, scores and books appointments from real availability",
  "Follows up until they answer, stops the moment they do",
  "Hands off to you with a 10-second summary when it matters",
];

export default async function SignInPage() {
  if (await getSession()) redirect("/overview");
  const demo = features.demoMode();
  const supabase = features.supabaseAuth();

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border px-12 py-10 lg:flex">
        <div aria-hidden className="pointer-events-none absolute -left-40 top-1/3 size-[520px] rounded-full bg-primary/10 blur-[120px]" />
        <BrandLogo size="lg" />
        <div className="relative max-w-lg">
          <p className="eyebrow mb-4">Autonomous lead operations</p>
          <h1 className="font-display text-5xl leading-[1.05] text-foreground">{BRAND.tagline}</h1>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-foreground-muted">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-end justify-between">
          <KimeLogo size="md" tagline />
          <p className="text-xs text-foreground-subtle">Signal Leads is a product by Kime.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandLogo size="md" endorsement />
          </div>
          <h2 className="font-display text-3xl text-foreground">Welcome back</h2>
          <p className="mt-1 text-sm text-foreground-muted">Sign in to see what Signal handled while you were away.</p>

          {demo && (
            <form action={enterDemoWorkspace} className="mt-8">
              <div className="card p-4">
                <p className="eyebrow mb-1">Demo workspace</p>
                <p className="text-sm text-foreground">Evergreen Roofing</p>
                <p className="mt-0.5 text-xs text-foreground-muted">28 live leads, conversations, bookings and analytics.</p>
                <SubmitButton variant="primary" className="mt-4 w-full" pendingLabel="Opening workspace…">
                  Enter demo workspace <ArrowRight />
                </SubmitButton>
              </div>
            </form>
          )}

          {supabase && (
            <div className="mt-6">
              {demo && (
                <div className="mb-6 flex items-center gap-3 text-xs text-foreground-subtle">
                  <span className="h-px flex-1 bg-border" /> or sign in with email <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <SupabaseSignIn />
            </div>
          )}

          {!demo && !supabase && (
            <p className="mt-8 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              Authentication isn&apos;t configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or DEMO_MODE=true.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
