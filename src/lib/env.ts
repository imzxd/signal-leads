/**
 * Centralised, validated environment access. Only credentials for features that are
 * actually enabled are required — the demo runs with none of them.
 *
 * Server-side only values never use the NEXT_PUBLIC_ prefix, so they are never
 * inlined into browser bundles.
 */
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: optional,
  DATABASE_URL: optional,
  SIGNAL_PGLITE_DIR: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SESSION_SECRET: optional,
  DEMO_MODE: optional,
  SIGNAL_AI_PROVIDER: optional, // "anthropic" | "dev"
  ANTHROPIC_API_KEY: optional,
  VOYAGE_API_KEY: optional,
  RESEND_API_KEY: optional,
  RESEND_FROM_EMAIL: optional,
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_PHONE_NUMBER: optional,
  N8N_WEBHOOK_SECRET: optional,
  N8N_OUTBOUND_WEBHOOK_URL: optional,
  CRON_SECRET: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached && process.env.NODE_ENV !== "test") return cached;
  cached = schema.parse(process.env);
  return cached;
}

export const features = {
  /** Supabase Auth is used when the public URL + anon key are configured. */
  supabaseAuth: () => Boolean(env().NEXT_PUBLIC_SUPABASE_URL && env().NEXT_PUBLIC_SUPABASE_ANON_KEY),
  /** Demo sign-in is always on locally; in production it must be opted into. */
  demoMode: () => env().NODE_ENV !== "production" || env().DEMO_MODE === "true" || !features.supabaseAuth(),
  liveAI: () => env().SIGNAL_AI_PROVIDER !== "dev" && Boolean(env().ANTHROPIC_API_KEY),
  voyageEmbeddings: () => Boolean(env().VOYAGE_API_KEY),
  resend: () => Boolean(env().RESEND_API_KEY && env().RESEND_FROM_EMAIL),
  twilio: () => Boolean(env().TWILIO_ACCOUNT_SID && env().TWILIO_AUTH_TOKEN && env().TWILIO_PHONE_NUMBER),
  n8n: () => Boolean(env().N8N_WEBHOOK_SECRET),
};

const DEV_SESSION_SECRET = "signal-leads-local-development-secret-change-me";

export function sessionSecret(): string {
  const secret = env().SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (env().NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (32+ characters) is required in production.");
  }
  return DEV_SESSION_SECRET;
}

export function appUrl(): string {
  return env().APP_URL ?? "http://localhost:3000";
}
