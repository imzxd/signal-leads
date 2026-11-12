import type { Urgency } from "@/types/domain";
import type { NextActionKind } from "@/ai/orchestrator/decide";

export interface EvalCase {
  id: string;
  description: string;
  message: string;
  name?: string;
  expect: {
    serviceKey?: string | null;
    urgency?: Urgency[];
    score: [number, number];
    handoff: boolean;
    nextAction: NextActionKind[];
  };
}

/**
 * Canonical leads. Changing prompts or heuristics must keep these passing —
 * this prevents silent quality regressions.
 */
export const EVAL_CASES: EvalCase[] = [
  {
    id: "urgent-leak",
    description: "Urgent roofing leak inside the service area",
    message: "Water is coming through our bedroom ceiling right now after the storm! We're in Guelph. Can someone come today?",
    expect: { serviceKey: "roof_repair", urgency: ["emergency", "urgent"], score: [55, 100], handoff: false, nextAction: ["ask_question"] },
  },
  {
    id: "spam",
    description: "SEO spam",
    message: "Hello! We offer SEO services to rank your website #1 on Google. Click here https://seo.example and https://deal.example",
    expect: { score: [0, 10], handoff: false, nextAction: ["ignore_spam"] },
  },
  {
    id: "outside-area",
    description: "Supported service but outside the service area",
    message: "Need a roof replacement for our house in Toronto, ideally next month.",
    expect: { serviceKey: "roof_replacement", score: [0, 45], handoff: false, nextAction: ["out_of_scope"] },
  },
  {
    id: "ambiguous",
    description: "Vague inquiry with little information",
    message: "Hi, can you help us?",
    expect: { urgency: ["unknown"], score: [0, 50], handoff: false, nextAction: ["ask_question"] },
  },
  {
    id: "ready-to-buy",
    description: "Ready-to-buy lead with every required detail",
    message: "We're ready to book a roof replacement as soon as possible. Detached house at 19 Paisley Rd, Guelph. The roof is 28 years old. When can you come out for the estimate?",
    expect: { serviceKey: "roof_replacement", score: [65, 100], handoff: false, nextAction: ["offer_booking"] },
  },
  {
    id: "price-shopper",
    description: "Price shopper comparing quotes",
    message: "Getting quotes from several companies for new eavestroughs in Kitchener. What's your cheapest price?",
    expect: { serviceKey: "eavestrough", score: [20, 60], handoff: false, nextAction: ["ask_question"] },
  },
  {
    id: "angry",
    description: "Angry existing customer",
    message: "This is ridiculous. You fixed our roof in Waterloo three months ago and it's leaking again. Terrible work. Fix it NOW.",
    expect: { handoff: true, score: [0, 100], nextAction: ["handoff"] },
  },
  {
    id: "wants-human",
    description: "Customer explicitly asks for a person",
    message: "I'd like to talk to a real person about a skylight leak in Elora, please call me.",
    expect: { serviceKey: "skylight", handoff: true, score: [0, 100], nextAction: ["handoff"] },
  },
  {
    id: "existing-customer",
    description: "Existing customer with a warranty question",
    message: "You installed our roof last year in Cambridge. A few shingles blew off in the wind — is that covered under warranty?",
    expect: { serviceKey: "roof_repair", score: [30, 100], handoff: false, nextAction: ["ask_question"] },
  },
  {
    id: "unsupported",
    description: "Service the business doesn't offer",
    message: "Do you guys do furnace repair? Ours stopped working in Guelph.",
    expect: { serviceKey: null, score: [0, 45], handoff: false, nextAction: ["out_of_scope"] },
  },
];
