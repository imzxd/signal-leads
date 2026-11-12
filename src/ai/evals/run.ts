/**
 * pnpm evals — run the canonical lead evaluations through the real workflow.
 * Uses Claude when ANTHROPIC_API_KEY is set (costs a few cents), otherwise the dev heuristics.
 */
import { describeAIMode } from "@/ai/providers";
import { EVAL_CASES } from "./cases";
import { runEvals } from "./harness";

const mode = describeAIMode();
console.log(`\nSignal Leads evals — agents: ${mode.label}\n`);
const results = await runEvals(EVAL_CASES);
for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.id.padEnd(18)} ${r.description}`);
  for (const c of r.checks.filter((x) => !x.passed)) console.log(`        ✗ ${c.name}: expected ${c.expected}, got ${c.actual}`);
}
const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} cases passed\n`);
process.exit(passed === results.length ? 0 : 1);
