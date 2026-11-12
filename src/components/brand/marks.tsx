import { cn } from "@/lib/utils";

/** The Kime lime — the small fruit that dots the "ı" in the Kime wordmark. */
export function LimeMark({ className, glow = true }: { className?: string; glow?: boolean }) {
  const segments = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg viewBox="0 0 24 24" className={cn("overflow-visible", className)} aria-hidden>
      {glow && <circle cx="12" cy="13.5" r="11" fill="var(--accent)" opacity="0.18" />}
      <circle cx="12" cy="13.5" r="8.6" fill="var(--primary)" />
      <circle cx="12" cy="13.5" r="7" fill="var(--kime-lime)" />
      {segments.map((a) => (
        <line key={a} x1="12" y1="13.5" x2={12 + Math.cos(a) * 6.4} y2={13.5 + Math.sin(a) * 6.4} stroke="var(--primary)" strokeWidth="0.9" strokeLinecap="round" />
      ))}
      <circle cx="12" cy="13.5" r="1.3" fill="var(--foreground)" />
      <path d="M12.4 5.1c.9-2.4 3.3-3.6 5.9-3.3-.9 2.3-3.2 3.7-5.9 3.3Z" fill="var(--accent)" />
    </svg>
  );
}

/** Signal Leads mark (development placeholder): signal arcs radiating from the Kime lime. */
export function SignalMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="var(--surface-elevated)" stroke="var(--border-strong)" />
      <path d="M10 15.5a7 7 0 0 1 7-7" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.95" />
      <path d="M6.2 16a11 11 0 0 1 11-11.2" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5" />
      <circle cx="11" cy="21.5" r="4.2" fill="var(--primary)" />
      <circle cx="11" cy="21.5" r="3.1" fill="var(--kime-lime)" />
      <circle cx="11" cy="21.5" r="0.9" fill="var(--primary-foreground)" />
    </svg>
  );
}
