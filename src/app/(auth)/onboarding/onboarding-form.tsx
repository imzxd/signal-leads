"use client";

import { useActionState } from "react";
import { Field, FieldError, Input } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/shared/submit-button";
import { createOrganization } from "../actions";

export function OnboardingForm() {
  const [state, action] = useActionState(createOrganization, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Business name" htmlFor="name">
        <Input id="name" name="name" placeholder="e.g. Northside Plumbing" required maxLength={120} />
      </Field>
      <Field label="Industry" htmlFor="industry" hint="Helps Signal phrase questions naturally.">
        <Input id="industry" name="industry" placeholder="e.g. Plumbing contractor" maxLength={80} />
      </Field>
      <FieldError message={state?.error} />
      <SubmitButton variant="primary" className="w-full" pendingLabel="Creating…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
