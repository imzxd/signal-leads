/**
 * Deterministic extractors for common qualification fields. Used by the intake and
 * reply-parser heuristics; Claude handles everything else when it is enabled.
 */
import { detectBudget, detectTimeline, extractAddress } from "./text-signals";

type Extractor = (text: string) => string | null;

const EXTRACTORS: Record<string, Extractor> = {
  address: (t) => extractAddress(t),
  timeline: (t) => detectTimeline(t),
  budget: (t) => detectBudget(t),
  property_type: (t) => {
    const m = t.toLowerCase().match(/\b(detached|semi-detached|townhouse|town house|condo|bungalow|cottage|duplex|commercial|warehouse|office|storefront|residential|house|home|garage|barn|church|apartment building)\b/);
    if (!m) return null;
    const v = m[1];
    if (["house", "home", "residential", "detached", "bungalow", "cottage", "semi-detached", "duplex"].includes(v)) return v === "home" ? "house" : v;
    return v;
  },
  roof_age: (t) => {
    const m = t.toLowerCase().match(/\b(?:roof|shingles?)\b[^.?!]{0,40}?\b(\d{1,2})\s*(?:years?|yrs?)\b|\b(\d{1,2})\s*(?:years?|yrs?)[ -]old\b|\b(?:installed|put on|replaced) (?:in )?((?:19|20)\d{2})\b/);
    if (!m) return null;
    if (m[3]) return `installed ${m[3]}`;
    return `${m[1] ?? m[2]} years`;
  },
  roof_type: (t) => {
    const m = t.toLowerCase().match(/\b(asphalt|shingle|metal|steel|tile|slate|flat|cedar|rubber|epdm|tpo)\b/);
    return m ? m[1] : null;
  },
  stories: (t) => {
    const m = t.toLowerCase().match(/\b(one|two|three|single|1|2|3)[ -](?:story|storey|level)\b/);
    return m ? m[1] : null;
  },
  insurance_claim: (t) => (/\b(insurance|adjuster|claim)\b/i.test(t) ? "yes" : null),
  company: (t) => {
    const m = t.match(/\b(?:at|from|with|for)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3}\s+(?:Inc|Ltd|LLC|Corp|Co|Group|Holdings|Properties|Management))\b/);
    return m ? m[1] : null;
  },
};

export function extractKnownField(key: string, text: string): string | null {
  const fn = EXTRACTORS[key];
  return fn ? fn(text) : null;
}

/** Best-effort answer extraction when we know which question the customer is answering. */
export function answerForPendingField(key: string, reply: string): string | null {
  const specific = extractKnownField(key, reply);
  if (specific) return specific;
  const t = reply.trim();
  // Short, non-question replies are almost always a direct answer to the last question.
  if (t.length > 0 && t.length <= 140 && !t.endsWith("?")) return t.replace(/^(it'?s|it is|we have|we're|we are|i have|about|around)\s+/i, "").replace(/[.!]+$/, "");
  return null;
}
