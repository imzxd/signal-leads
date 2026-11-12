import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { appointments, followUps, knowledgeChunks, leads } from "@/server/db/schema";
import type { DatabaseHandle } from "@/server/db/client";
import { getMetrics } from "@/server/repositories/analytics";
import { searchKnowledge } from "@/server/repositories/knowledge";
import { createTestDatabase, seedDemo, systemCtx } from "../helpers/db";

let h: DatabaseHandle;
let orgId: string;

beforeAll(async () => {
  h = await createTestDatabase();
  orgId = await seedDemo(h);
});
afterAll(async () => h.close());

describe("demo organization", () => {
  it("seeds a living CRM: 25+ leads across stages, appointments, follow-ups and knowledge", async () => {
    const [{ n }] = await h.db.select({ n: count() }).from(leads).where(eq(leads.organizationId, orgId));
    expect(n).toBeGreaterThanOrEqual(25);
    const stages = new Set((await h.db.select({ s: leads.stage }).from(leads).where(eq(leads.organizationId, orgId))).map((r) => r.s));
    for (const s of ["qualifying", "booking", "booked", "won", "lost", "needs_human", "archived"]) expect(stages.has(s as never)).toBe(true);
    expect((await h.db.select({ n: count() }).from(appointments).where(eq(appointments.organizationId, orgId)))[0].n).toBeGreaterThan(5);
    expect((await h.db.select({ n: count() }).from(followUps).where(eq(followUps.status, "scheduled")))[0].n).toBeGreaterThan(3);
    expect((await h.db.select({ n: count() }).from(knowledgeChunks).where(eq(knowledgeChunks.organizationId, orgId)))[0].n).toBeGreaterThan(5);
  });

  it("produces meaningful analytics, including recovered leads", async () => {
    const m = await getMetrics(systemCtx(h, orgId), 30);
    expect(m.leadsReceived).toBeGreaterThan(10);
    expect(m.recoveredLeads).toBeGreaterThan(0);
    expect(m.wins).toBeGreaterThan(0);
    expect(m.funnel[0].count).toBeGreaterThanOrEqual(m.funnel[4].count);
  });

  it("retrieves relevant knowledge with hybrid search", async () => {
    const hits = await searchKnowledge(systemCtx(h, orgId), "What warranty do you offer on a new roof?", 3);
    expect(hits[0].content).toMatch(/warranty/i);
  });
});
