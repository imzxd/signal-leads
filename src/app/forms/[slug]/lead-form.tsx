"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { leadSubmissionSchema, type LeadSubmission, type LeadSubmissionInput } from "@/features/leads/intake-schema";
import { submitLeadForm } from "@/server/actions/public-form";

export function LeadForm({
  slug,
  embed,
  services,
  askCompany,
  consentText,
  successMessage,
  businessName,
}: {
  slug: string;
  embed: boolean;
  services: { key: string; name: string }[];
  askCompany: boolean;
  consentText: string;
  successMessage: string;
  businessName: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<LeadSubmissionInput, unknown, LeadSubmission>({
    resolver: zodResolver(leadSubmissionSchema),
    defaultValues: { name: "", email: "", phone: "", company: "", service: "", message: "", preferredChannel: "email", consent: false, website: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const channel = useWatch({ control: form.control, name: "preferredChannel" });

  async function onSubmit(values: LeadSubmission) {
    setServerError(null);
    const res = await submitLeadForm(slug, values, embed);
    if (res?.ok) {
      setDone(true);
      router.push(`/forms/${slug}/thanks?channel=${values.preferredChannel}${embed ? "&embed=1" : ""}`);
      return;
    }
    if (res && !res.ok) {
      setServerError(res.error);
      Object.entries(res.fieldErrors ?? {}).forEach(([k, v]) => form.setError(k as keyof LeadSubmissionInput, { message: v }));
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center py-8 text-center animate-slide-up" role="status">
        <span className="flex size-12 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
          <CheckCircle2 className="size-6 text-accent" aria-hidden />
        </span>
        <h2 className="mt-4 font-display text-2xl">Request received</h2>
        <p className="mt-2 max-w-sm text-sm text-foreground-muted">{successMessage}</p>
        <p className="mt-4 text-xs text-foreground-subtle">Keep an eye on your {channel === "sms" ? "texts" : "inbox"} — {businessName} will be in touch.</p>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="lf-name" error={errors.name?.message}>
          <Input id="lf-name" autoComplete="name" {...form.register("name")} aria-invalid={!!errors.name} />
        </Field>
        {askCompany ? (
          <Field label="Company (optional)" htmlFor="lf-company" error={errors.company?.message}>
            <Input id="lf-company" autoComplete="organization" {...form.register("company")} />
          </Field>
        ) : (
          <Field label="Service" htmlFor="lf-service">
            <Select id="lf-service" {...form.register("service")}>
              <option value="">Not sure / other</option>
              {services.map((s) => (
                <option key={s.key} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Email" htmlFor="lf-email" error={errors.email?.message}>
          <Input id="lf-email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Phone" htmlFor="lf-phone" error={errors.phone?.message}>
          <Input id="lf-phone" type="tel" autoComplete="tel" {...form.register("phone")} aria-invalid={!!errors.phone} />
        </Field>
      </div>
      {askCompany && (
        <Field label="Service" htmlFor="lf-service2">
          <Select id="lf-service2" {...form.register("service")}>
            <option value="">Not sure / other</option>
            {services.map((s) => (
              <option key={s.key} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="How can we help?" htmlFor="lf-message" error={errors.message?.message} hint="Where is the property, what's happening, and when do you need it done?">
        <Textarea id="lf-message" rows={4} {...form.register("message")} aria-invalid={!!errors.message} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-foreground-muted">Best way to reply</legend>
        <div className="flex gap-2">
          {(["email", "sms"] as const).map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/[0.06]">
              <input type="radio" value={c} {...form.register("preferredChannel")} className="accent-[var(--primary)]" />
              {c === "email" ? "Email" : "Text message"}
            </label>
          ))}
        </div>
      </fieldset>
      {/* Honeypot: hidden from people, irresistible to bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 overflow-hidden">
        <label>
          Website <input tabIndex={-1} autoComplete="off" {...form.register("website")} />
        </label>
      </div>
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-foreground-muted">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" {...form.register("consent")} />
        <span>{consentText}</span>
      </label>
      {serverError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
        Send request
      </Button>
    </form>
  );
}
