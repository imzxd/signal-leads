/**
 * Decision receipts: short, structured explanations of automated decisions.
 * They replace chain-of-thought — they say *what* was decided and *which facts*
 * drove it, never the model's private reasoning.
 */
export interface DecisionReceipt {
  headline: string;
  reasons: string[];
  nextAction?: string;
  scoreDelta?: number;
  confidence?: number;
  /** Knowledge sources consulted, by document title. */
  sources?: string[];
  /** True when the deterministic fallback produced the decision. */
  fallback?: boolean;
}

export function receipt(r: DecisionReceipt): DecisionReceipt {
  return {
    ...r,
    reasons: r.reasons.filter(Boolean).slice(0, 6),
    ...(r.confidence !== undefined ? { confidence: Math.round(r.confidence * 100) / 100 } : {}),
    ...(r.fallback ? { fallback: true } : { fallback: undefined }),
  };
}
