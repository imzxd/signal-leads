/**
 * Deterministic text signal detectors.
 *
 * Used (1) by compliance-critical paths that must never depend on a model
 * (opt-out keywords, contact extraction), and (2) by the heuristic fallbacks that
 * keep every agent working when the AI provider is unavailable or returns invalid output.
 */
import type { ServiceOffering, Urgency } from "@/types/domain";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

export function extractPhone(text: string): string | null {
  const m = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  return m ? normalizePhone(m[0]) : null;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim();
}

export function extractName(text: string): string | null {
  const m =
    text.match(/\b(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ??
    text.match(/\b(?:thanks|cheers|regards|best),?\s*\n?\s*[-–—]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/m);
  if (!m) return null;
  const candidate = m[1].trim();
  const stop = new Set(["Looking", "Interested", "Wondering", "Not", "In", "From", "Here", "Just", "Hoping", "Calling"]);
  return stop.has(candidate.split(" ")[0]) ? null : candidate;
}

/** Street-address-like phrase, e.g. "42 Maple Ave". */
export function extractAddress(text: string): string | null {
  const m = text.match(
    /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Cres|Crescent|Ct|Court|Ln|Lane|Way|Pl|Place|Trail|Tr)\b\.?/,
  );
  return m ? m[0].replace(/\.$/, "") : null;
}

const POSTAL = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])[ -]?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
export function extractPostalCode(text: string): string | null {
  const m = text.match(POSTAL);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

export function findCity(text: string, cities: string[]): string | null {
  const t = norm(text);
  for (const city of [...cities].sort((a, b) => b.length - a.length)) {
    const c = norm(city);
    if (new RegExp(`\\b${escapeRegExp(c)}\\b`).test(t)) return city;
  }
  return null;
}

/** Common Ontario places outside a typical service area, for "outside region" detection. */
const KNOWN_PLACES = [
  "Toronto", "Ottawa", "Hamilton", "London", "Kitchener", "Waterloo", "Windsor", "Sudbury", "Barrie",
  "Kingston", "Montreal", "Vancouver", "Calgary", "Thunder Bay", "Niagara Falls", "Sarnia", "Detroit",
  "Mississauga", "Brampton", "Oakville", "Burlington", "Guelph", "Cambridge", "Peterborough", "Oshawa",
  "Whitby", "Ajax", "Pickering", "Markham", "Vaughan", "Richmond Hill", "Newmarket", "Aurora", "Milton",
];
export function findAnyPlace(text: string, extraCities: string[] = []): string | null {
  return findCity(text, [...extraCities, ...KNOWN_PLACES]);
}

export function detectUrgency(text: string): Urgency {
  const t = norm(text);
  if (/\b(emergency|asap|right now|immediately|flooding|water (is )?(pouring|coming) in|caved|collapsed|fire|no heat|freezing|burst)\b/.test(t)) return "emergency";
  if (/\b(urgent|today|tonight|tomorrow|leak(ing)?|this week|as soon as|soon as possible|quickly|stopped working)\b/.test(t)) return "urgent";
  if (/\b(next week|within (a|two|2|few) weeks?|this month|soon|before winter|before (the )?(snow|rain))\b/.test(t)) return "soon";
  if (/\b(next (month|year|spring|summer|fall)|no rush|flexible|whenever|sometime|planning|thinking about|budgeting|in the future)\b/.test(t)) return "flexible";
  return "unknown";
}

export function detectTimeline(text: string): string | null {
  const t = norm(text);
  const patterns: [RegExp, string][] = [
    [/\b(today|tonight)\b/, "today"],
    [/\btomorrow\b/, "tomorrow"],
    [/\bthis week\b/, "this week"],
    [/\bnext week\b/, "next week"],
    [/\bthis month\b/, "this month"],
    [/\bnext month\b/, "next month"],
    [/\b(within|in) (\d+|a|two|few) (days?|weeks?|months?)\b/, "$0"],
    [/\b(this|next) (spring|summer|fall|autumn|winter)\b/, "$0"],
    [/\bbefore winter\b/, "before winter"],
    [/\b(asap|as soon as possible|right away|immediately)\b/, "as soon as possible"],
  ];
  for (const [re, label] of patterns) {
    const m = t.match(re);
    if (m) return label === "$0" ? m[0] : label;
  }
  return null;
}

export function detectBudget(text: string): string | null {
  const m = text.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K)?(?:\s?(?:-|to)\s?\$?\s?\d[\d,]*(?:\s?(?:k|K))?)?/);
  if (m) return m[0].replace(/\s+/g, "");
  const k = text.match(/\b(\d{1,3})\s?(k|K)\b(?:\s?budget)?/);
  return k ? `$${k[1]}k` : null;
}

/** Words that describe *an action*, not *a trade* — on their own they don't identify a service. */
const GENERIC_TERMS = new Set(["repair", "repairs", "fix", "replace", "replacement", "damaged", "damage", "inspection", "inspect", "check", "quote", "estimate", "install", "new"]);

/**
 * Pick the offered service the text refers to. Specific terms outweigh generic ones
 * ("skylight leak" → Skylight, not Roof Repair), and a different trade mentioned alongside
 * only generic terms ("furnace repair") is not mistaken for one of ours.
 */
export function matchService(text: string, services: ServiceOffering[]): ServiceOffering | null {
  const t = norm(text);
  let best: { s: ServiceOffering; score: number; specific: boolean } | null = null;
  for (const s of services) {
    const name = norm(s.name);
    const terms = [name, ...(s.keywords ?? []).map(norm)].filter(Boolean);
    let score = 0;
    let specific = false;
    for (const term of terms) {
      if (!new RegExp(`\\b${escapeRegExp(term)}`).test(t)) continue;
      const generic = GENERIC_TERMS.has(term);
      score += (generic ? 1 : term.length) + (term === name ? 4 : 0);
      if (!generic) specific = true;
    }
    if (score > 0 && (!best || score > best.score)) best = { s, score, specific };
  }
  if (best && !best.specific && detectOtherTrade(text)) return null;
  return best?.s ?? null;
}

/** Service words that clearly belong to a different trade (unsupported request detection). */
const OTHER_TRADES = /\b(plumb(ing|er)|furnace|hvac|air condition(ing|er)|electrical|electrician|landscap(ing|er)|lawn|pool|painting|painter|carpet|flooring|kitchen remodel|basement|insulation|window replacement|new windows|solar panels?|website|logo|seo|marketing|tax|accounting|legal advice|dog walking|car repair|auto repair)\b/;
export function detectOtherTrade(text: string): string | null {
  const m = norm(text).match(OTHER_TRADES);
  return m ? m[0] : null;
}

export function isOptOut(text: string): boolean {
  const t = norm(text).replace(/[.!]+$/, "");
  return /^(stop|stopall|unsubscribe|cancel|end|quit|opt out|optout|remove me)$/.test(t) ||
    /\b(unsubscribe|stop (texting|messaging|emailing|contacting) me|remove me from|do not (contact|text|email) me|don't (contact|text|email) me)\b/.test(t);
}

export function asksForHuman(text: string): boolean {
  return /\b(speak|talk|chat) (to|with) (a |an )?(human|person|real person|someone|manager|owner|staff|representative)\b|\b(real person|human please|call me instead|can someone call|have someone call|phone me)\b/.test(norm(text));
}

export function detectLegalThreat(text: string): boolean {
  return /\b(lawyer|attorney|sue|suing|lawsuit|legal action|small claims|court|better business bureau|bbb)\b/.test(norm(text));
}

export type Sentiment = "positive" | "neutral" | "negative" | "angry";
export function detectSentiment(text: string): Sentiment {
  const t = norm(text);
  const angry = /\b(furious|unacceptable|ridiculous|terrible|worst|scam|rip(ped)? off|angry|disgusted|never again|incompetent|useless)\b|!!!/.test(t) ||
    (text.replace(/[^A-Z]/g, "").length > 25 && text === text.toUpperCase());
  if (angry) return "angry";
  if (/\b(disappointed|unhappy|frustrated|annoyed|not happy|still waiting|no one (called|answered))\b/.test(t)) return "negative";
  if (/\b(thanks|thank you|great|perfect|awesome|appreciate|sounds good|love)\b/.test(t)) return "positive";
  return "neutral";
}

export function detectPriceShopping(text: string): boolean {
  return /\b(cheapest|lowest price|best price|ballpark|how much (does|do|would|is)|price (check|range)|quote(s)? from (several|multiple|other)|shopping around|compar(e|ing) (prices|quotes))\b/.test(norm(text));
}

export function detectSpam(text: string): boolean {
  const t = norm(text);
  if (t.length < 3) return true;
  if (/\b(seo services|rank (your|you) (site|website)|backlinks|crypto|bitcoin|forex|casino|viagra|loan offer|guest post|web design services|increase your traffic|buy followers|click here)\b/.test(t)) return true;
  const links = (text.match(/https?:\/\//g) ?? []).length;
  if (links >= 2) return true;
  if (/^[a-z]{12,}$/.test(t.replace(/\s/g, "")) && !/[aeiou]{1}/.test(t)) return true;
  return /(.)\1{7,}/.test(t) || /^(test|asdf|qwerty|hello)$/.test(t);
}

export function detectExistingCustomer(text: string): boolean {
  return /\b(you (did|installed|replaced|fixed) (my|our)|existing customer|previous customer|last (year|time) you|warranty claim|under warranty|you guys (did|installed))\b/.test(norm(text));
}

export function detectNotInterested(text: string): boolean {
  return /\b(not interested|no longer (need|interested)|went with (another|someone else)|found someone|already hired|never ?mind|no thanks|we('re| are) good)\b/.test(norm(text));
}

export function extractQuestions(text: string): string[] {
  const parts = text
    .split(/(?<=[?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") && s.length > 8);
  const implicit = /\b(do you|are you|can you|what (is|are)|how (much|long|soon)|is there|does it)\b/i;
  if (parts.length === 0) {
    const sentence = text.split(/(?<=[.!])\s+/).find((s) => implicit.test(s));
    if (sentence) parts.push(sentence.trim());
  }
  // A question that only asks for service ("can someone come today?") is a booking intent, not a knowledge question.
  return parts.filter((q) => !/\b(can|could) (someone|you) (come|stop by|fix|look)\b/i.test(q)).slice(0, 3);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function firstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const f = name.trim().split(/\s+/)[0];
  return f ? f[0].toUpperCase() + f.slice(1) : null;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
