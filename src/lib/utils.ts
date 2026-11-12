import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (opts.compact && Math.abs(value) >= 10_000) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function relativeTime(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return diff < 0 ? "just now" : "in a moment";
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), "hour");
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function formatDateTime(date: Date | string | null | undefined, timeZone = "America/Toronto"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(d);
}

export function formatTime(date: Date | string, timeZone = "America/Toronto"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(d);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
