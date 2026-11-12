import { ZodError } from "zod";
import { ForbiddenError, NotFoundError } from "@/server/context";
import { logger } from "@/lib/observability/logger";

/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Wraps a server action so failures become user-friendly messages instead of crashes. */
export async function act<T>(name: string, fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    // Next.js uses thrown errors for redirect()/notFound(); let those through.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    if (e instanceof UserError || e instanceof ForbiddenError || e instanceof NotFoundError) return { ok: false, error: e.message };
    logger.error("action.failed", { action: name, error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
