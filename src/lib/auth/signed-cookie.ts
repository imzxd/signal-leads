import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "@/lib/env";

/** Minimal signed token: base64url(json).base64url(hmac). Used for the demo session cookie. */
export function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
