"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Badge, Card } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/overlays";
import { createApiKeyAction, revokeApiKeyAction, saveSettingsAction } from "@/server/actions/settings";
import type { SettingsSection } from "@/features/organizations/settings-schemas";
import type { BookingConfig, EscalationRules, FollowUpStep, FormConfig, MessagingHours, QualificationField, ServiceArea, ServiceOffering } from "@/types/domain";
import { relativeTime } from "@/lib/utils";

export interface SettingsData {
  company: { businessName: string; phone: string | null; email: string | null; website: string | null; address: string | null; brandVoice: string | null; averageDealValue: number; timezone: string };
  services: ServiceOffering[];
  serviceArea: ServiceArea;
  qualification: QualificationField[];
  followUps: { sequence: FollowUpStep[]; messagingHours: MessagingHours };
  escalation: EscalationRules;
  booking: BookingConfig;
  form: FormConfig;
}

function Section({ id, title, description, children, onSave, canEdit }: { id: string; title: string; description: string; children: React.ReactNode; onSave?: () => Promise<void>; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Card id={id} className="scroll-mt-6">
      <div className="flex flex-col gap-1 border-b border-border px-5 py-4">
        <h2 className="font-display text-lg">{title}</h2>
        <p className="text-xs text-foreground-muted">{description}</p>
      </div>
      <fieldset disabled={!canEdit} className="space-y-3 px-5 py-4">
        {children}
      </fieldset>
      {onSave && canEdit && (
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="primary" size="sm" loading={pending} onClick={() => start(onSave)}>
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

async function save(section: SettingsSection, data: unknown) {
  const r = await saveSettingsAction(section, data);
  if (r.ok) toast.success(r.message ?? "Saved");
  else toast.error(r.error);
}

const splitList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SettingsClient({
  data,
  canEdit,
  formUrl,
  integrations,
  keys,
}: {
  data: SettingsData;
  canEdit: boolean;
  formUrl: string;
  integrations: { name: string; status: "live" | "dev" | "off"; detail: string }[];
  keys: { id: string; name: string; prefix: string; lastUsedAt: string | null; revoked: boolean }[];
}) {
  const [company, setCompany] = useState(data.company);
  const [services, setServices] = useState(data.services);
  const [area, setArea] = useState({ cities: data.serviceArea.cities.join(", "), postal: data.serviceArea.postalPrefixes.join(", "), note: data.serviceArea.note ?? "" });
  const [fields, setFields] = useState(data.qualification);
  const [fu, setFu] = useState(data.followUps);
  const [esc, setEsc] = useState({ ...data.escalation, keywordsText: data.escalation.keywords.join(", ") });
  const [booking, setBooking] = useState(data.booking);
  const [form, setForm] = useState(data.form);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [pending, start] = useTransition();
  const embed = `<iframe src="${formUrl}?embed=1" title="Request an estimate" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`;

  const nav = [
    ["company", "Company"],
    ["services", "Services"],
    ["area", "Service area"],
    ["qualification", "Qualification"],
    ["followups", "Follow-ups"],
    ["escalation", "Escalation"],
    ["booking", "Booking"],
    ["form", "Lead form"],
    ["integrations", "Integrations"],
    ["api", "API keys"],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-4 space-y-0.5 text-sm">
          {nav.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-md px-3 py-1.5 text-foreground-muted hover:bg-surface-hover/60 hover:text-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-5">
        {!canEdit && <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">Only owners and admins can change settings.</p>}

        <Section id="company" title="Company" description="How Signal introduces your business." canEdit={canEdit} onSave={() => save("company", company)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" htmlFor="s-name">
              <Input id="s-name" value={company.businessName} onChange={(e) => setCompany({ ...company, businessName: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="s-phone">
              <Input id="s-phone" value={company.phone ?? ""} onChange={(e) => setCompany({ ...company, phone: e.target.value || null })} />
            </Field>
            <Field label="Email" htmlFor="s-email">
              <Input id="s-email" type="email" value={company.email ?? ""} onChange={(e) => setCompany({ ...company, email: e.target.value || null })} />
            </Field>
            <Field label="Website" htmlFor="s-web">
              <Input id="s-web" value={company.website ?? ""} onChange={(e) => setCompany({ ...company, website: e.target.value || null })} />
            </Field>
            <Field label="Address" htmlFor="s-addr">
              <Input id="s-addr" value={company.address ?? ""} onChange={(e) => setCompany({ ...company, address: e.target.value || null })} />
            </Field>
            <Field label="Timezone" htmlFor="s-tz">
              <Input id="s-tz" value={company.timezone} onChange={(e) => setCompany({ ...company, timezone: e.target.value })} />
            </Field>
            <Field label="Average job value (CAD)" htmlFor="s-avg" hint="Fallback when a service has no typical value.">
              <Input id="s-avg" inputMode="decimal" value={company.averageDealValue} onChange={(e) => setCompany({ ...company, averageDealValue: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} />
            </Field>
          </div>
          <Field label="Brand voice" htmlFor="s-voice" hint="Signal writes every message in this voice.">
            <Textarea id="s-voice" rows={2} value={company.brandVoice ?? ""} onChange={(e) => setCompany({ ...company, brandVoice: e.target.value || null })} />
          </Field>
        </Section>

        <Section id="services" title="Services" description="What you offer. Requests outside this list are flagged instead of promised." canEdit={canEdit} onSave={() => save("services", services)}>
          {services.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_120px_auto]">
              <Input aria-label="Service name" value={s.name} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
              <Input aria-label="Service key" value={s.key} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder="key" className="font-mono text-xs" />
              <Input aria-label="Typical value" inputMode="decimal" value={s.averageValue} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, averageValue: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 } : x)))} />
              <div className="flex items-center gap-2">
                <Switch checked={s.enabled} onCheckedChange={(v) => setServices(services.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} aria-label={`${s.name} enabled`} />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s.name}`} onClick={() => setServices(services.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              <Input
                aria-label="Keywords"
                className="sm:col-span-4"
                value={(s.keywords ?? []).join(", ")}
                onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, keywords: splitList(e.target.value) } : x)))}
                placeholder="Words customers use, comma separated (leak, shingles, …)"
              />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setServices([...services, { key: `service_${services.length + 1}`, name: "", averageValue: 0, enabled: true, keywords: [] }])}>
            <Plus /> Add service
          </Button>
        </Section>

        <Section
          id="area"
          title="Service area"
          description="Leads outside this area are flagged for review."
          canEdit={canEdit}
          onSave={() => save("serviceArea", { cities: splitList(area.cities), postalPrefixes: splitList(area.postal), note: area.note || undefined })}
        >
          <Field label="Cities and towns" htmlFor="s-cities" hint="Comma separated.">
            <Textarea id="s-cities" rows={2} value={area.cities} onChange={(e) => setArea({ ...area, cities: e.target.value })} />
          </Field>
          <Field label="Postal code prefixes (FSA)" htmlFor="s-postal" hint="e.g. N1H, N2L">
            <Textarea id="s-postal" rows={2} value={area.postal} onChange={(e) => setArea({ ...area, postal: e.target.value })} />
          </Field>
        </Section>

        <Section id="qualification" title="Qualification questions" description="What Signal needs to know before booking. It asks one question at a time and never re-asks what's known." canEdit={canEdit} onSave={() => save("qualification", fields)}>
          {fields.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_auto]">
              <Input aria-label="Label" value={f.label} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Label" />
              <Input aria-label="Field key" value={f.key} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="font-mono text-xs" />
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                <Switch checked={f.required} onCheckedChange={(v) => setFields(fields.map((x, j) => (j === i ? { ...x, required: v } : x)))} aria-label="Required" /> Required
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.label}`} onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              <Input aria-label="Question" className="sm:col-span-3" value={f.question} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} placeholder="How Signal asks it" />
              <Input
                aria-label="Only for services"
                className="sm:col-span-3"
                value={(f.services ?? []).join(", ")}
                onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, services: splitList(e.target.value) } : x)))}
                placeholder="Only for these service keys (blank = all)"
              />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, label: "", question: "", required: false }])}>
            <Plus /> Add question
          </Button>
        </Section>

        <Section id="followups" title="Follow-ups & messaging hours" description="When Signal nudges leads who go quiet. The sequence stops the moment they reply." canEdit={canEdit} onSave={() => save("followUps", fu)}>
          {fu.sequence.map((s, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[140px_1fr_auto]">
              <Field label={`Follow-up ${i + 1} after (hours)`} htmlFor={`fu-${i}`}>
                <Input id={`fu-${i}`} inputMode="numeric" value={s.delayHours} onChange={(e) => setFu({ ...fu, sequence: fu.sequence.map((x, j) => (j === i ? { ...x, delayHours: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)) })} />
              </Field>
              <Field label="Strategy" htmlFor={`fus-${i}`}>
                <Select id={`fus-${i}`} value={s.strategy} onChange={(e) => setFu({ ...fu, sequence: fu.sequence.map((x, j) => (j === i ? { ...x, strategy: e.target.value as FollowUpStep["strategy"] } : x)) })}>
                  <option value="gentle_check_in">Gentle check-in</option>
                  <option value="value_reminder">Value reminder</option>
                  <option value="last_chance">Final check</option>
                  <option value="custom">Custom template</option>
                </Select>
              </Field>
              <Button variant="ghost" size="icon" aria-label={`Remove follow-up ${i + 1}`} onClick={() => setFu({ ...fu, sequence: fu.sequence.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
              {s.strategy === "custom" && (
                <Textarea
                  aria-label="Template"
                  className="sm:col-span-3"
                  rows={2}
                  value={s.template ?? ""}
                  onChange={(e) => setFu({ ...fu, sequence: fu.sequence.map((x, j) => (j === i ? { ...x, template: e.target.value } : x)) })}
                  placeholder="Hi {first_name}, just checking in about {service}… — {business}"
                />
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={fu.sequence.length >= 6} onClick={() => setFu({ ...fu, sequence: [...fu.sequence, { delayHours: (fu.sequence.at(-1)?.delayHours ?? 0) + 72, strategy: "gentle_check_in" }] })}>
            <Plus /> Add follow-up
          </Button>
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <label className="flex items-center gap-2 pb-2 text-xs text-foreground-muted">
              <Switch checked={fu.messagingHours.enabled} onCheckedChange={(v) => setFu({ ...fu, messagingHours: { ...fu.messagingHours, enabled: v } })} /> Only send follow-ups between
            </label>
            <Input aria-label="Start time" type="time" className="w-32" value={fu.messagingHours.start} onChange={(e) => setFu({ ...fu, messagingHours: { ...fu.messagingHours, start: e.target.value } })} />
            <span className="pb-2 text-xs text-foreground-muted">and</span>
            <Input aria-label="End time" type="time" className="w-32" value={fu.messagingHours.end} onChange={(e) => setFu({ ...fu, messagingHours: { ...fu.messagingHours, end: e.target.value } })} />
          </div>
        </Section>

        <Section
          id="escalation"
          title="Escalation rules"
          description="When Signal stops and hands the lead to a person. Angry customers, legal threats and requests for a human always escalate."
          canEdit={canEdit}
          onSave={() => save("escalation", { keywords: splitList(esc.keywordsText), vipValueThreshold: esc.vipValueThreshold, minConfidence: esc.minConfidence })}
        >
          <Field label="Escalation keywords" htmlFor="s-kw" hint="Comma separated, e.g. insurance adjuster, property manager">
            <Input id="s-kw" value={esc.keywordsText} onChange={(e) => setEsc({ ...esc, keywordsText: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="VIP lead value (CAD)" htmlFor="s-vip" hint="Leads worth at least this go to a person.">
              <Input id="s-vip" inputMode="decimal" value={esc.vipValueThreshold ?? ""} onChange={(e) => setEsc({ ...esc, vipValueThreshold: e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "")) : null })} />
            </Field>
            <Field label={`Minimum AI confidence: ${Math.round(esc.minConfidence * 100)}%`} htmlFor="s-conf">
              <input id="s-conf" type="range" min={0} max={0.9} step={0.05} value={esc.minConfidence} onChange={(e) => setEsc({ ...esc, minConfidence: Number(e.target.value) })} className="mt-2 accent-[var(--accent)]" />
            </Field>
          </div>
        </Section>

        <Section id="booking" title="Booking" description="How appointments are offered. Times always come from your calendar." canEdit={canEdit} onSave={() => save("booking", booking)}>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Appointment name" htmlFor="b-label" className="sm:col-span-2">
              <Input id="b-label" value={booking.appointmentLabel} onChange={(e) => setBooking({ ...booking, appointmentLabel: e.target.value })} />
            </Field>
            <Field label="Length (min)" htmlFor="b-dur">
              <Input id="b-dur" inputMode="numeric" value={booking.durationMinutes} onChange={(e) => setBooking({ ...booking, durationMinutes: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Times to offer" htmlFor="b-n">
              <Input id="b-n" inputMode="numeric" value={booking.slotsToOffer} onChange={(e) => setBooking({ ...booking, slotsToOffer: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </Section>

        <Section id="form" title="Lead form" description="Your hosted form and website embed." canEdit={canEdit} onSave={() => save("form", form)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Headline" htmlFor="f-h">
              <Input id="f-h" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
            </Field>
            <Field label="Subheadline" htmlFor="f-sh">
              <Input id="f-sh" value={form.subheadline} onChange={(e) => setForm({ ...form, subheadline: e.target.value })} />
            </Field>
          </div>
          <Field label="Consent text" htmlFor="f-c" hint="Shown next to the consent checkbox (CASL).">
            <Textarea id="f-c" rows={2} value={form.consentText} onChange={(e) => setForm({ ...form, consentText: e.target.value })} />
          </Field>
          <Field label="Thank-you message" htmlFor="f-s">
            <Input id="f-s" value={form.successMessage} onChange={(e) => setForm({ ...form, successMessage: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <Switch checked={form.askCompany} onCheckedChange={(v) => setForm({ ...form, askCompany: v })} /> Ask for company name
          </label>
          <div className="rounded-lg border border-border bg-background-raised p-3">
            <p className="text-xs text-foreground-muted">
              Hosted form:{" "}
              <a href={formUrl} target="_blank" className="text-accent hover:underline">
                {formUrl}
              </a>
            </p>
            <div className="mt-2 flex items-start gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap rounded bg-background px-2 py-1.5 text-[11px] text-foreground-muted">{embed}</code>
              <CopyButton text={embed} label="Copy embed code" />
            </div>
          </div>
        </Section>

        <Section id="integrations" title="Integrations" description="Signal works fully in development mode. Add credentials in your environment to go live." canEdit={canEdit}>
          <ul className="divide-y divide-border/60">
            {integrations.map((i) => (
              <li key={i.name} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm">{i.name}</p>
                  <p className="text-xs text-foreground-muted">{i.detail}</p>
                </div>
                <Badge tone={i.status === "live" ? "lime" : i.status === "dev" ? "warning" : "neutral"}>{i.status === "live" ? "Connected" : i.status === "dev" ? "Development" : "Not configured"}</Badge>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="api" title="API keys" description="Send leads from your own systems: POST /api/v1/leads with Authorization: Bearer <key>." canEdit={canEdit}>
          {newKey && (
            <div className="rounded-lg border border-accent/40 bg-accent/[0.06] p-3">
              <p className="text-xs text-accent">Copy this key now — it won&apos;t be shown again.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-xs">{newKey}</code>
                <CopyButton text={newKey} label="Copy API key" />
              </div>
            </div>
          )}
          <ul className="divide-y divide-border/60">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <KeyRound className="size-4 text-foreground-subtle" aria-hidden /> {k.name} <code className="text-xs text-foreground-subtle">{k.prefix}…</code>
                </span>
                <span className="flex items-center gap-3 text-xs text-foreground-subtle">
                  {k.revoked ? "revoked" : `last used ${relativeTime(k.lastUsedAt)}`}
                  {!k.revoked && (
                    <Button variant="ghost" size="sm" onClick={() => start(async () => { const r = await revokeApiKeyAction(k.id); if (r.ok) toast.success(r.message); else toast.error(r.error); })}>
                      Revoke
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input aria-label="Key name" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Website backend" className="max-w-xs" />
            <Button
              variant="secondary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await createApiKeyAction(keyName);
                  if (r.ok && r.data) {
                    setNewKey(r.data);
                    setKeyName("");
                  } else if (!r.ok) toast.error(r.error);
                })
              }
            >
              <Plus /> Create key
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  );
}
