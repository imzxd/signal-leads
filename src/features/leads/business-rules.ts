/**
 * Deterministic business-rule validation — no AI involved.
 */
import type { ServiceArea, ServiceOffering } from "@/types/domain";
import type { TriState } from "./scoring/types";
import { escapeRegExp, extractPostalCode } from "@/ai/agents/shared/text-signals";

export function checkServiceSupported(
  serviceKey: string | null,
  serviceRequested: string | null,
  intent: string | null,
  services: ServiceOffering[],
): TriState {
  if (serviceKey && services.some((s) => s.key === serviceKey && s.enabled)) return "yes";
  if (serviceKey && services.some((s) => s.key === serviceKey && !s.enabled)) return "no";
  if (intent === "unsupported_service") return "no";
  if (serviceRequested && !serviceKey && intent && intent !== "general_inquiry" && intent !== "spam") return "no";
  return "unknown";
}

export function checkServiceArea(location: string | null, address: string | null, area: ServiceArea): TriState {
  const haystack = `${location ?? ""} ${address ?? ""}`.trim();
  if (!haystack) return "unknown";
  if (area.cities.length === 0 && area.postalPrefixes.length === 0) return "unknown";
  const lower = haystack.toLowerCase();
  if (area.cities.some((c) => new RegExp(`\\b${escapeRegExp(c.toLowerCase())}\\b`).test(lower))) return "yes";
  const postal = extractPostalCode(haystack);
  if (postal && area.postalPrefixes.some((p) => postal.replace(/\s/g, "").startsWith(p.replace(/\s/g, "").toUpperCase()))) return "yes";
  // A street address without a city can't be judged; a named place outside the list can.
  return location ? "no" : "unknown";
}

export function estimateLeadValue(serviceKey: string | null, services: ServiceOffering[], fallback: number): number | null {
  const service = services.find((s) => s.key === serviceKey);
  if (service) return service.averageValue;
  return fallback > 0 ? fallback : null;
}
