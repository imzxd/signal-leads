"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { leadSubmissionSchema, type LeadSubmission, type LeadSubmissionInput } from "@/features/leads/intake-schema";
import { createManualLeadAction } from "@/server/actions/leads";

export function NewLeadDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<LeadSubmissionInput, unknown, LeadSubmission>({
    resolver: zodResolver(leadSubmissionSchema),
    defaultValues: { name: "", email: "", phone: "", service: "", message: "", preferredChannel: "email", consent: true },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: LeadSubmission) {
    const res = await createManualLeadAction(values);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.message);
    setOpen(false);
    form.reset();
    if (res.data?.leadId) router.push(`/leads/${res.data.leadId}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus /> Add lead
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a lead" description="For phone calls and walk-ins. Signal will qualify and follow up just like a form lead.">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="nl-name" error={errors.name?.message}>
              <Input id="nl-name" {...form.register("name")} aria-invalid={!!errors.name} />
            </Field>
            <Field label="Service" htmlFor="nl-service" error={errors.service?.message}>
              <Input id="nl-service" placeholder="e.g. Roof repair" {...form.register("service")} />
            </Field>
            <Field label="Email" htmlFor="nl-email" error={errors.email?.message}>
              <Input id="nl-email" type="email" {...form.register("email")} aria-invalid={!!errors.email} />
            </Field>
            <Field label="Phone" htmlFor="nl-phone" error={errors.phone?.message}>
              <Input id="nl-phone" type="tel" {...form.register("phone")} aria-invalid={!!errors.phone} />
            </Field>
          </div>
          <Field label="What do they need?" htmlFor="nl-message" error={errors.message?.message}>
            <Textarea id="nl-message" rows={3} placeholder="Notes from the call, in the customer's words…" {...form.register("message")} aria-invalid={!!errors.message} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reply by" htmlFor="nl-channel">
              <Select id="nl-channel" {...form.register("preferredChannel")}>
                <option value="email">Email</option>
                <option value="sms">Text message</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-foreground-muted">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" {...form.register("consent")} />
              Customer agreed to be contacted
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Add lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
