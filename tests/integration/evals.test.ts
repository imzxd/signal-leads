import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "@/ai/evals/cases";
import { runEvals } from "@/ai/evals/harness";

describe("AI evaluation suite (deterministic baseline)", () => {
  it("every canonical lead is handled as expected", async () => {
    const results = await runEvals(EVAL_CASES);
    const failures = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.checks.filter((c) => !c.passed).map((c) => `${c.name} expected ${c.expected} got ${c.actual}`).join("; ")}`);
    expect(failures).toEqual([]);
  });
});
