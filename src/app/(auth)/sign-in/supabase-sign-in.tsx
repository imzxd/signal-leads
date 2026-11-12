"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SupabaseSignIn() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return toast.error("Supabase isn't configured");
    setLoading(true);
    const { error } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/overview` } });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (mode === "sign-up") toast.success("Check your email to confirm your account.");
    router.push("/overview");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required />
      </Field>
      <Button type="submit" variant="secondary" className="w-full" loading={loading}>
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
      <button type="button" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} className="w-full text-center text-xs text-foreground-muted hover:text-foreground">
        {mode === "sign-in" ? "New to Signal Leads? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
