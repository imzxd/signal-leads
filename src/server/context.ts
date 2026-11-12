import type { Database } from "@/server/db/client";

export type Actor =
  | { kind: "staff"; userId: string; name: string }
  | { kind: "system"; label: string }
  | { kind: "api"; keyId: string | null; label: string }
  | { kind: "lead" };

/**
 * Every server operation runs inside an OrgContext. `organizationId` is ALWAYS derived
 * from an authenticated session, a verified API key, a signed webhook, or a public form
 * slug lookup — never from a client-supplied id.
 */
export interface OrgContext {
  db: Database;
  organizationId: string;
  actor: Actor;
}

export function systemContext(db: Database, organizationId: string, label = "Signal"): OrgContext {
  return { db, organizationId, actor: { kind: "system", label } };
}

export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case "staff":
      return actor.name;
    case "system":
      return actor.label;
    case "api":
      return actor.label;
    case "lead":
      return "Customer";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}
