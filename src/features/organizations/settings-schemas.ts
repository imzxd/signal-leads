import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const key = z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/, "Keys use lowercase letters, numbers and underscores");
const list = (max: number) =>
  z
    .array(z.string().trim().min(1).max(80))
    .max(max)
    .transform((a) => [...new Set(a)]);

export const companySchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().email().max(200).nullable().or(z.literal("").transform(() => null)),
  website: z.string().trim().url().max(300).nullable().or(z.literal("").transform(() => null)),
  address: z.string().trim().max(240).nullable(),
  brandVoice: z.string().trim().max(500).nullable(),
  averageDealValue: z.coerce.number().min(0).max(10_000_000),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
});

export const servicesSchema = z
  .array(
    z.object({
      key,
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(240).optional(),
      averageValue: z.coerce.number().min(0).max(10_000_000),
      enabled: z.boolean(),
      keywords: list(30).optional(),
    }),
  )
  .max(50)
  .refine((s) => new Set(s.map((x) => x.key)).size === s.length, "Service keys must be unique");

export const serviceAreaSchema = z.object({
  cities: list(200),
  postalPrefixes: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]\d[A-Z]$/, "Postal prefixes look like N1H")).max(500),
  note: z.string().trim().max(200).optional(),
});

export const qualificationSchema = z
  .array(
    z.object({
      key,
      label: z.string().trim().min(1).max(80),
      question: z.string().trim().min(5).max(240),
      required: z.boolean(),
      services: z.array(key).max(50).optional(),
    }),
  )
  .max(20)
  .refine((s) => new Set(s.map((x) => x.key)).size === s.length, "Field keys must be unique");

export const followUpSchema = z.object({
  sequence: z
    .array(
      z.object({
        delayHours: z.coerce.number().int().min(1).max(24 * 60),
        strategy: z.enum(["gentle_check_in", "value_reminder", "last_chance", "custom"]),
        template: z.string().trim().max(600).optional(),
      }),
    )
    .min(0)
    .max(6)
    .refine((s) => s.every((step, i) => i === 0 || step.delayHours > s[i - 1].delayHours), "Each follow-up must come after the previous one"),
  messagingHours: z.object({ enabled: z.boolean(), start: time, end: time }).refine((h) => !h.enabled || h.start < h.end, "End must be after start"),
});

export const escalationSchema = z.object({
  keywords: list(50),
  vipValueThreshold: z.coerce.number().min(0).max(100_000_000).nullable(),
  minConfidence: z.coerce.number().min(0).max(1),
});

export const bookingSchema = z.object({
  durationMinutes: z.coerce.number().int().min(15).max(480),
  slotsToOffer: z.coerce.number().int().min(1).max(6),
  minLeadTimeHours: z.coerce.number().int().min(0).max(168),
  appointmentLabel: z.string().trim().min(1).max(80),
});

export const formSchema = z.object({
  headline: z.string().trim().min(1).max(120),
  subheadline: z.string().trim().max(240),
  askCompany: z.boolean(),
  consentText: z.string().trim().min(10).max(400),
  successMessage: z.string().trim().min(1).max(240),
});

export const SETTINGS_SECTIONS = {
  company: companySchema,
  services: servicesSchema,
  serviceArea: serviceAreaSchema,
  qualification: qualificationSchema,
  followUps: followUpSchema,
  escalation: escalationSchema,
  booking: bookingSchema,
  form: formSchema,
} as const;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
