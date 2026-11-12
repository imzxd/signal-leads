import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { apiKeys } from "@/server/db/schema";

/** Resolve an organization from `Authorization: Bearer sl_live_…`. Only the key's SHA-256 is stored. */
export async function authenticateApiKey(db: Database, authorization: string | null): Promise<{ organizationId: string; keyId: string; name: string } | null> {
  const token = authorization?.match(/^Bearer\s+(sl_live_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt))).limit(1);
  if (!key) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return { organizationId: key.organizationId, keyId: key.id, name: key.name };
}

/** Twilio request validation: base64(HMAC-SHA1(authToken, url + sorted(key+value))). */
export function verifyTwilioSignature(authToken: string, signature: string | null, url: string, params: Record<string, string>): boolean {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = Buffer.from(createHmac("sha1", authToken).update(data).digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function bearerMatches(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(authorization?.replace(/^Bearer\s+/, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? "unknown";
}
