import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { LeadSource } from "@/types/domain";
import { clamp01, type BusinessProfile } from "../shared/context";
import { extractKnownField } from "../shared/field-extractors";
import {
  asksForHuman,
  detectBudget,
  detectExistingCustomer,
  detectOtherTrade,
  detectSentiment,
  detectSpam,
  detectTimeline,
  detectUrgency,
  extractAddress,
  extractEmail,
  extractName,
  extractPhone,
  extractQuestions,
  findAnyPlace,
  matchService,
  normalizePhone,
  truncate,
} from "../shared/text-signals";
import { intakeSystemPrompt, intakeUserPrompt } from "./prompt";
import { intakeOutputSchema, type IntakeOutput } from "./schema";

export interface IntakeInput {
  business: BusinessProfile;
  message: string;
  source: LeadSource;
  form: { name?: string | null; email?: string | null; phone?: string | null; company?: string | null; service?: string | null };
}

export function intakeHeuristic(input: IntakeInput): IntakeOutput {
  const { message, business, form } = input;
  const text = `${form.service ? `${form.service}. ` : ""}${message}`;
  const service = matchService(text, business.services.filter((s) => s.enabled));
  const otherTrade = service ? null : detectOtherTrade(text);
  const spam = detectSpam(message);
  const urgency = detectUrgency(text);
  const location = findAnyPlace(text, business.serviceArea.cities);
  const fields = business.qualificationFields
    .map((f) => ({ key: f.key, value: extractKnownField(f.key, text) }))
    .filter((f): f is { key: string; value: string } => Boolean(f.value));

  const serviceRequested = service?.name ?? (otherTrade ? capitalize(otherTrade) : form.service ?? null);
  const intent = spam ? "spam" : service ? `${service.key}_request` : otherTrade ? "unsupported_service" : "general_inquiry";
  const where = location ? ` in ${location}` : "";
  const when = urgency === "emergency" ? " — emergency" : urgency === "urgent" ? " — urgent" : "";
  const summary = spam
    ? "Message looks like spam or an unrelated sales pitch."
    : serviceRequested
      ? `${capitalize(serviceRequested)} request${where}${when}.`
      : `General inquiry${where}: "${truncate(message.trim(), 90)}"`;

  let confidence = 0.55;
  if (service) confidence += 0.15;
  if (location) confidence += 0.05;
  if (urgency !== "unknown") confidence += 0.05;
  if (message.trim().length < 25) confidence -= 0.15;

  return {
    intent,
    serviceRequested,
    serviceKey: service?.key ?? null,
    urgency,
    location,
    address: extractAddress(text),
    timeline: detectTimeline(text),
    budget: detectBudget(text),
    name: form.name || extractName(message),
    email: form.email || extractEmail(message),
    phone: form.phone || extractPhone(message),
    company: form.company || null,
    summary,
    questions: spam ? [] : extractQuestions(message),
    fields,
    sentiment: detectSentiment(message),
    asksForHuman: asksForHuman(message),
    isExistingCustomer: detectExistingCustomer(message),
    missingFields: [],
    confidence: clamp01(confidence),
  };
}

export function normalizeIntake(output: IntakeOutput, input: IntakeInput): IntakeOutput {
  const serviceKeys = new Set(input.business.services.filter((s) => s.enabled).map((s) => s.key));
  const fieldKeys = new Set(input.business.qualificationFields.map((f) => f.key));
  // Verified form values always win over model extraction; regexes back-fill contact details.
  const email = input.form.email || output.email || extractEmail(input.message);
  const phone = input.form.phone || output.phone || extractPhone(input.message);
  return {
    ...output,
    serviceKey: output.serviceKey && serviceKeys.has(output.serviceKey) ? output.serviceKey : null,
    name: input.form.name || output.name,
    email: email ? email.toLowerCase() : null,
    phone: phone ? normalizePhone(phone) : null,
    company: input.form.company || output.company,
    fields: output.fields.filter((f) => fieldKeys.has(f.key) && f.value.trim().length > 0).map((f) => ({ key: f.key, value: f.value.trim().slice(0, 200) })),
    missingFields: output.missingFields.filter((k) => fieldKeys.has(k)),
    // Compliance-relevant flags also get a deterministic floor.
    asksForHuman: output.asksForHuman || asksForHuman(input.message),
    summary: truncate(output.summary.trim(), 280),
    questions: output.questions.slice(0, 3),
    confidence: clamp01(output.confidence),
  };
}

export const intakeAgent: AgentDefinition<IntakeInput, IntakeOutput> = {
  type: "intake",
  schema: intakeOutputSchema,
  system: intakeSystemPrompt,
  prompt: intakeUserPrompt,
  heuristic: intakeHeuristic,
  normalize: normalizeIntake,
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ source: i.source, message: i.message, form: { service: i.form.service, company: i.form.company } }),
};

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
