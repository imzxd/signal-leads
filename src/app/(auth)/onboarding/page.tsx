import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { currentUserId, getSession } from "@/lib/auth/session";
import { createDemoWorkspaceForUser } from "../actions";
import { SubmitButton } from "@/components/shared/submit-button";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (await getSession()) redirect("/overview");
  if (!(await currentUserId())) redirect("/sign-in");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <BrandLogo endorsement />
        <h1 className="mt-8 font-display text-3xl">Set up your workspace</h1>
        <p className="mt-1 text-sm text-foreground-muted">Tell us about your business. You can configure services, service area and qualification questions next.</p>
        <div className="card mt-6 p-5">
          <OnboardingForm />
        </div>
        <form action={createDemoWorkspaceForUser} className="mt-4 text-center">
          <SubmitButton variant="ghost" size="sm" pendingLabel="Building demo workspace…">
            Or explore with a demo workspace (Evergreen Roofing)
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
