import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "@/server/db/client";
import { createInboundLead } from "@/server/services/lead-intake";
import { findLead, getLead, updateLead } from "@/server/repositories/leads";
import { listLeads, leadListQuerySchema } from "@/server/repositories/lead-list";
import { NotFoundError } from "@/server/context";
import { createOrg, createTestDatabase, systemCtx } from "../helpers/db";

let h: DatabaseHandle;
const A_OWNER = "20000000-0000-4000-8000-00000000000a";
const B_OWNER = "20000000-0000-4000-8000-00000000000b";
let orgA: string;
let orgB: string;
let leadA: string;

beforeAll(async () => {
  h = await createTestDatabase();
  orgA = (await createOrg(h, { slug: "org-a", ownerId: A_OWNER })).id;
  orgB = (await createOrg(h, { slug: "org-b", ownerId: B_OWNER })).id;
  leadA = (await createInboundLead(systemCtx(h, orgA), { name: "Alice", email: "alice@example.com", message: "Roof leak in Guelph", preferredChannel: "email", consent: true } as never, { source: "form" })).leadId;
  await createInboundLead(systemCtx(h, orgB), { name: "Bob", email: "bob@example.com", message: "Gutter quote in Waterloo", preferredChannel: "email", consent: true } as never, { source: "form" });
});
afterAll(async () => h.close());

describe("organization isolation (server-side)", () => {
  it("another organization cannot read a lead by id", async () => {
    await expect(getLead(systemCtx(h, orgB), leadA)).rejects.toBeInstanceOf(NotFoundError);
    expect(await findLead(systemCtx(h, orgB), leadA)).toBeNull();
  });
  it("another organization cannot update a lead by id", async () => {
    await expect(updateLead(systemCtx(h, orgB), leadA, { name: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLead(systemCtx(h, orgA), leadA)).name).toBe("Alice");
  });
  it("lists only the caller's leads, even when searching for the other org's data", async () => {
    const res = await listLeads(systemCtx(h, orgB), leadListQuerySchema.parse({ q: "Alice" }));
    expect(res.total).toBe(0);
    const all = await listLeads(systemCtx(h, orgB), leadListQuerySchema.parse({}));
    expect(all.rows.map((r) => r.lead.name)).toEqual(["Bob"]);
  });
});

describe("Row Level Security (database-side)", () => {
  async function asUser(userId: string | null, query: string) {
    await h.raw.exec("begin");
    try {
      await h.raw.exec("set local role authenticated");
      if (userId) await h.raw.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
      return await h.raw.query(query);
    } finally {
      await h.raw.exec("rollback");
    }
  }

  it("a member sees only their organization's leads", async () => {
    const rows = await asUser(A_OWNER, "select name, organization_id from leads");
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });
  it("an anonymous/unknown user sees nothing", async () => {
    expect(await asUser(null, "select id from leads")).toHaveLength(0);
    expect(await asUser("20000000-0000-4000-8000-0000000000ff", "select id from organizations")).toHaveLength(0);
  });
  it("RLS also protects messages and consents", async () => {
    const msgs = await asUser(B_OWNER, "select body from messages");
    expect(msgs.map((m) => m.body)).toEqual(["Gutter quote in Waterloo"]);
    const consents = await asUser(B_OWNER, `select id from consents where lead_id = '${leadA}'`);
    expect(consents).toHaveLength(0);
  });
});
