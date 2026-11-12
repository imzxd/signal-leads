import { describe, expect, it } from "vitest";
import { computeLeadScore, explainScore, resolveWeights, temperatureForScore } from "@/features/leads/scoring/engine";
import type { ScoringInput } from "@/features/leads/scoring/types";

const base: ScoringInput = {
  serviceSupported: "yes",
  inServiceArea: "yes",
  urgency: "urgent",
  requiredFieldsTotal: 3,
  requiredFieldsKnown: 3,
  hasContactMethod: true,
  inboundReplies: 1,
  isExistingCustomer: false,
  signals: { buyingIntent: "high", isSpam: false, isPriceShopper: false, confidence: 0.9 },
};

describe("lead scoring engine", () => {
  it("maps scores to the spec's temperature bands", () => {
    expect(temperatureForScore(0)).toBe("cold");
    expect(temperatureForScore(29)).toBe("cold");
    expect(temperatureForScore(30)).toBe("warm");
    expect(temperatureForScore(59)).toBe("warm");
    expect(temperatureForScore(60)).toBe("qualified");
    expect(temperatureForScore(79)).toBe("qualified");
    expect(temperatureForScore(80)).toBe("hot");
    expect(temperatureForScore(100)).toBe("hot");
  });

  it("scores a ready-to-buy, in-area, urgent lead as HOT with explainable factors", () => {
    const r = computeLeadScore(base);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.temperature).toBe("hot");
    expect(r.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["service_supported", "in_area", "urgency_urgent", "intent_high"]));
    expect(r.explanation).toMatch(/clear buying intent/i);
  });

  it("penalises leads outside the service area or asking for unsupported services", () => {
    const outside = computeLeadScore({ ...base, inServiceArea: "no" });
    const unsupported = computeLeadScore({ ...base, serviceSupported: "no" });
    expect(outside.score).toBeLessThan(computeLeadScore(base).score - 40);
    expect(unsupported.factors.some((f) => f.key === "service_unsupported" && f.points < 0)).toBe(true);
  });

  it("caps spam regardless of other factors (the model can't talk a spammer up)", () => {
    const r = computeLeadScore({ ...base, signals: { ...base.signals, isSpam: true } });
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.explanation).toMatch(/spam/i);
  });

  it("is deterministic and clamps to 0..100", () => {
    expect(computeLeadScore(base)).toEqual(computeLeadScore(base));
    const low = computeLeadScore({ ...base, serviceSupported: "no", inServiceArea: "no", signals: { ...base.signals, buyingIntent: "none" }, hasContactMethod: false, inboundReplies: 0, urgency: "unknown" });
    expect(low.score).toBe(0);
  });

  it("accepts per-organization weight overrides and ignores unknown keys", () => {
    const w = resolveWeights({ intentHigh: 40, bogus: 99 } as never);
    expect(w.intentHigh).toBe(40);
    expect((w as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(computeLeadScore({ ...base, urgency: "flexible" }, w).score).toBeGreaterThan(computeLeadScore({ ...base, urgency: "flexible" }).score);
  });

  it("explains with owner-friendly language", () => {
    expect(explainScore([])).toMatch(/not enough information/i);
  });
});
