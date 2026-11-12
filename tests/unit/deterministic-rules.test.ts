import { describe, expect, it } from "vitest";
import { decideNextAction, pipelineColumnFor } from "@/ai/orchestrator/decide";
import { asksForHuman, detectLegalThreat, detectSpam, detectUrgency, extractEmail, extractPhone, isOptOut } from "@/ai/agents/shared/text-signals";
import { matchSlotDeterministic } from "@/ai/agents/booking/slot-matcher";
import { followUpStopReason } from "@/features/follow-ups/stop-conditions";
import { canAutomationTransition } from "@/features/leads/lead-state";
import { checkServiceArea } from "@/features/leads/business-rules";
import { nextAllowedSendTime } from "@/lib/messaging/messaging-hours";
import { signPayload, verifySignature } from "@/lib/integrations/n8n";
import { chunkDocument } from "@/features/knowledge/chunker";
import { DEMO_SERVICE_AREA } from "@/server/seed/demo-config";
import type { Lead } from "@/server/db/schema";

const decision = (o: Partial<Parameters<typeof decideNextAction>[0]>) =>
  decideNextAction({ isSpam: false, handoffRequired: false, notInterested: false, serviceSupported: "yes", inServiceArea: "yes", qualificationComplete: false, targetField: "address", score: 50, alreadyBooked: false, ...o });

describe("orchestrator next-action policy", () => {
  it("prioritises spam, then handoff, then closing", () => {
    expect(decision({ isSpam: true, handoffRequired: true }).kind).toBe("ignore_spam");
    expect(decision({ handoffRequired: true, notInterested: true }).kind).toBe("handoff");
    expect(decision({ notInterested: true }).kind).toBe("close");
  });
  it("asks one question while qualification is incomplete", () => {
    const d = decision({});
    expect(d.kind).toBe("ask_question");
    expect(d.stage).toBe("qualifying");
  });
  it("offers booking only when complete and score ≥ 60", () => {
    expect(decision({ qualificationComplete: true, targetField: null, score: 72 }).kind).toBe("offer_booking");
    expect(decision({ qualificationComplete: true, targetField: null, score: 45 }).kind).toBe("nurture");
  });
  it("flags out-of-scope leads instead of promising work", () => {
    expect(decision({ inServiceArea: "no" }).kind).toBe("out_of_scope");
    expect(decision({ serviceSupported: "no" }).kind).toBe("out_of_scope");
  });
  it("maps every stage to a pipeline column (archived hidden)", () => {
    expect(pipelineColumnFor("booking", "hot")).toBe("hot");
    expect(pipelineColumnFor("needs_human", "warm")).toBe("qualifying");
    expect(pipelineColumnFor("archived", "cold")).toBeNull();
  });
  it("never lets automation reopen a closed deal", () => {
    expect(canAutomationTransition("won", "qualifying")).toBe(false);
    expect(canAutomationTransition("qualifying", "booking")).toBe(true);
  });
});

describe("compliance-critical text signals (never AI)", () => {
  it.each(["STOP", "stop.", "Unsubscribe", "please remove me from your list", "Stop texting me"])("detects opt-out: %s", (t) => expect(isOptOut(t)).toBe(true));
  it.each(["I can't stop the leak", "the water won't stop", "Thanks!"])("does not misfire on: %s", (t) => expect(isOptOut(t)).toBe(false));
  it("detects requests for a human and legal threats", () => {
    expect(asksForHuman("Can I speak to a real person please?")).toBe(true);
    expect(detectLegalThreat("I'll be calling my lawyer")).toBe(true);
  });
  it("classifies urgency", () => {
    expect(detectUrgency("water is pouring in through the ceiling")).toBe("emergency");
    expect(detectUrgency("can someone come tomorrow?")).toBe("urgent");
    expect(detectUrgency("thinking about it for next spring")).toBe("flexible");
  });
  it("detects obvious spam", () => {
    expect(detectSpam("Boost your SEO services today https://a.example https://b.example")).toBe(true);
    expect(detectSpam("My roof is leaking in Guelph")).toBe(false);
  });
  it("extracts contact details", () => {
    expect(extractEmail("reach me at Jane.Doe@Example.com")).toBe("jane.doe@example.com");
    expect(extractPhone("call 519-555-0142 anytime")).toBe("+15195550142");
  });
});

describe("booking slot matching (no fabricated availability)", () => {
  const slots = [
    { id: "1", startsAt: "", endsAt: "", label: "Thu, Nov 19 · 10:00 AM" },
    { id: "2", startsAt: "", endsAt: "", label: "Fri, Nov 20 · 1:30 PM" },
    { id: "3", startsAt: "", endsAt: "", label: "Mon, Nov 23 · 9:00 AM" },
  ];
  it.each([
    ["2", "2"],
    ["2 works for me", "2"],
    ["Option 3 please", "3"],
    ["the first one works", "1"],
    ["Friday works", "2"],
    ["thursday at 10:00", "1"],
  ])("%s → slot %s", (reply, id) => expect(matchSlotDeterministic(reply, slots)?.id).toBe(id));
  it("returns null for ambiguous or unrelated replies", () => {
    expect(matchSlotDeterministic("I need one more thing", slots)).toBeNull();
    expect(matchSlotDeterministic("what's your warranty?", slots)).toBeNull();
    expect(matchSlotDeterministic("7", slots)).toBeNull();
    expect(matchSlotDeterministic("2 story house", slots)).toBeNull();
    expect(matchSlotDeterministic("2pm would be better", slots)).toBeNull();
  });
});

describe("follow-up stop conditions", () => {
  const lead = { optedOutAt: null, stage: "qualifying", controlMode: "autopilot", lastInboundAt: new Date("2026-01-01T10:00:00Z") } as unknown as Lead;
  const fu = { createdAt: new Date("2026-01-01T11:00:00Z"), sequenceNumber: 1 };
  it("allows a due follow-up for a silent lead", () => expect(followUpStopReason(lead, fu, 3)).toBeNull());
  it("stops when the lead replied after scheduling", () => expect(followUpStopReason({ ...lead, lastInboundAt: new Date("2026-01-01T12:00:00Z") }, fu, 3)).toBe("lead_responded"));
  it.each([
    [{ optedOutAt: new Date() }, "opted_out"],
    [{ stage: "won" }, "converted"],
    [{ stage: "lost" }, "lost"],
    [{ stage: "booked" }, "booked"],
    [{ controlMode: "human" }, "human_takeover"],
    [{ controlMode: "paused" }, "autopilot_paused"],
  ])("stops for %o", (patch, reason) => expect(followUpStopReason({ ...lead, ...patch } as Lead, fu, 3)).toBe(reason));
  it("stops past the configured maximum", () => expect(followUpStopReason(lead, { ...fu, sequenceNumber: 4 }, 3)).toBe("max_reached"));
});

describe("service area & messaging hours", () => {
  it("validates cities and postal prefixes", () => {
    expect(checkServiceArea("Guelph", null, DEMO_SERVICE_AREA)).toBe("yes");
    expect(checkServiceArea("Toronto", null, DEMO_SERVICE_AREA)).toBe("no");
    expect(checkServiceArea(null, "12 Elm St, N1H 2B3", DEMO_SERVICE_AREA)).toBe("yes");
    expect(checkServiceArea(null, null, DEMO_SERVICE_AREA)).toBe("unknown");
  });
  it("defers sends outside messaging hours to the next window", () => {
    const hours = { enabled: true, start: "08:00", end: "20:00" };
    const late = new Date("2026-03-10T03:30:00Z"); // 23:30 Toronto the previous evening
    const next = nextAllowedSendTime(late, hours, "America/Toronto");
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(late.getTime());
    expect(nextAllowedSendTime(new Date("2026-03-10T16:00:00Z"), hours, "America/Toronto")).toBeNull();
    expect(nextAllowedSendTime(late, { ...hours, enabled: false }, "America/Toronto")).toBeNull();
  });
});

describe("webhook signatures", () => {
  it("accepts valid and rejects tampered or stale payloads", () => {
    const body = JSON.stringify({ type: "followups.run" });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signPayload(body, "secret", ts);
    expect(verifySignature(body, sig, ts, "secret")).toBe(true);
    expect(verifySignature(body + " ", sig, ts, "secret")).toBe(false);
    expect(verifySignature(body, sig, ts, "other")).toBe(false);
    expect(verifySignature(body, sig, String(Number(ts) - 3600), "secret")).toBe(false);
  });
});

describe("knowledge chunking", () => {
  it("keeps FAQ pairs intact and prefixes the title", () => {
    const chunks = chunkDocument("FAQ", "Q: Are estimates free?\nA: Yes.\n\nQ: Warranty?\nA: 10 years.");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content.startsWith("FAQ\n")).toBe(true);
    expect(chunks.map((c) => c.content).join(" ")).toContain("A: 10 years.");
  });
});
