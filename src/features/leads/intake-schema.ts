import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** One validation schema for every lead entry point: hosted form, embed, API, webhooks. */
export const leadSubmissionSchema = z
  .object({
    name: z.string().trim().min(1, "Please tell us your name").max(120),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v.toLowerCase() : undefined))
      .pipe(z.string().email("Enter a valid email").optional()),
    phone: optionalText(40),
    company: optionalText(160),
    service: optionalText(160),
    message: z.string().trim().min(5, "Add a few words about what you need").max(4000),
    preferredChannel: z.enum(["email", "sms"]).default("email"),
    consent: z.boolean().default(false),
    /** Honeypot — real people never fill this hidden field. */
    website: z.string().max(0, "Invalid submission").optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), { message: "Add an email or phone number so we can reply", path: ["email"] })
  .refine((v) => v.preferredChannel !== "sms" || Boolean(v.phone), { message: "Add a phone number to get text replies", path: ["phone"] });

export type LeadSubmission = z.infer<typeof leadSubmissionSchema>;
export type LeadSubmissionInput = z.input<typeof leadSubmissionSchema>;
