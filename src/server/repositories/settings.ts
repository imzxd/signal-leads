import { eq } from "drizzle-orm";
import type { BusinessProfile } from "@/ai/agents/shared/context";
import { DEFAULT_ESCALATION_RULES } from "@/ai/agents/handoff/triggers";
import { organizations, organizationSettings, type Organization, type OrganizationSettingsRow } from "@/server/db/schema";
import { NotFoundError, type OrgContext } from "@/server/context";
import type {
  BookingConfig,
  BusinessHours,
  EscalationRules,
  FollowUpStep,
  FormConfig,
  MessagingHours,
  QualificationField,
  ServiceArea,
  ServiceOffering,
} from "@/types/domain";
import type { ScoringWeights } from "@/features/leads/scoring/types";

export const DEFAULT_FOLLOW_UP_SEQUENCE: FollowUpStep[] = [
  { delayHours: 24, strategy: "gentle_check_in" },
  { delayHours: 72, strategy: "value_reminder" },
  { delayHours: 168, strategy: "last_chance" },
];

export const DEFAULT_BOOKING: BookingConfig = { durationMinutes: 60, slotsToOffer: 3, minLeadTimeHours: 2, appointmentLabel: "On-site estimate" };

export const DEFAULT_FORM: FormConfig = {
  headline: "Tell us what you need",
  subheadline: "We usually reply within minutes.",
  askCompany: false,
  consentText: "I agree to receive messages about my request by email or text. Reply STOP to opt out at any time.",
  successMessage: "Thanks! We've received your request and will be in touch shortly.",
};

export const DEFAULT_HOURS: BusinessHours = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
  wed: { open: "08:00", close: "17:00" },
  thu: { open: "08:00", close: "17:00" },
  fri: { open: "08:00", close: "17:00" },
  sat: { open: "09:00", close: "13:00" },
  sun: null,
};

/** Fully-resolved organization settings — every JSON field has its defaults applied. */
export interface ResolvedSettings {
  organization: Organization;
  businessName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  brandVoice: string | null;
  averageDealValue: number;
  services: ServiceOffering[];
  serviceArea: ServiceArea;
  qualificationFields: QualificationField[];
  businessHours: BusinessHours;
  messagingHours: MessagingHours;
  followUpSequence: FollowUpStep[];
  scoringWeights: Partial<ScoringWeights>;
  escalationRules: EscalationRules;
  booking: BookingConfig;
  form: FormConfig;
}

export function resolveSettings(organization: Organization, row: OrganizationSettingsRow | undefined): ResolvedSettings {
  return {
    organization,
    businessName: row?.businessName ?? organization.name,
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    website: row?.website ?? null,
    address: row?.address ?? null,
    brandVoice: row?.brandVoice ?? null,
    averageDealValue: row?.averageDealValue ?? 0,
    services: row?.services ?? [],
    serviceArea: { cities: [], postalPrefixes: [], ...(row?.serviceArea ?? {}) },
    qualificationFields: row?.qualificationFields ?? [],
    businessHours: row?.businessHours && Object.keys(row.businessHours).length ? row.businessHours : DEFAULT_HOURS,
    messagingHours: { enabled: false, start: "08:00", end: "20:00", ...(row?.messagingHours ?? {}) },
    followUpSequence: row?.followUpSequence?.length ? row.followUpSequence : DEFAULT_FOLLOW_UP_SEQUENCE,
    scoringWeights: row?.scoringWeights ?? {},
    escalationRules: { ...DEFAULT_ESCALATION_RULES, ...(row?.escalationRules ?? {}) },
    booking: { ...DEFAULT_BOOKING, ...(row?.bookingConfig ?? {}) },
    form: { ...DEFAULT_FORM, ...(row?.formConfig ?? {}) },
  };
}

export async function getSettings(ctx: OrgContext): Promise<ResolvedSettings> {
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  if (!org) throw new NotFoundError("Organization");
  const [row] = await ctx.db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, ctx.organizationId)).limit(1);
  return resolveSettings(org, row);
}

export function toBusinessProfile(s: ResolvedSettings): BusinessProfile {
  return {
    name: s.businessName,
    industry: s.organization.industry,
    brandVoice: s.brandVoice,
    phone: s.phone,
    timezone: s.organization.timezone,
    services: s.services,
    serviceArea: s.serviceArea,
    qualificationFields: s.qualificationFields,
  };
}
