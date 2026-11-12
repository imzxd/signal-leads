/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { BRAND } from "./brand-config";
import { LimeMark, SignalMark } from "./marks";

/**
 * Kime wordmark: script "Kime" with the lime dotting the dotless ı,
 * optionally with the "AI AGENTS & AUTOMATION" rule-line tagline.
 */
export function KimeLogo({ className, tagline = false, size = "md" }: { className?: string; tagline?: boolean; size?: "xs" | "sm" | "md" | "lg" | "xl" }) {
  const text = { xs: "text-[18px]", sm: "text-[24px]", md: "text-[34px]", lg: "text-[52px]", xl: "text-[84px]" }[size];
  return (
    <span className={cn("inline-flex flex-col items-center", className)} aria-label="Kime — AI Agents & Automation" role="img">
      <span className={cn("font-script leading-none text-foreground", text)} aria-hidden>
        K
        <span className="relative inline-block">
          ı
          <LimeMark className="absolute left-1/2 top-[-0.02em] size-[0.3em] -translate-x-[38%]" />
        </span>
        me
      </span>
      {tagline && (
        <span className="mt-1 flex items-center gap-2 text-[9px] font-medium tracking-[0.28em] text-kime" aria-hidden>
          <span className="h-px w-6 bg-kime/50" />
          AI AGENTS &amp; AUTOMATION
          <span className="h-px w-6 bg-kime/50" />
        </span>
      )}
    </span>
  );
}

/** "A Kime product" endorsement line. */
export function KimeEndorsement({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 text-[11px] text-foreground-subtle", className)}>
      A
      <KimeLogo size="xs" className="translate-y-[3px]" />
      product
    </span>
  );
}

/**
 * Signal Leads logo. Uses the official asset at /public/brand/signal-leads-logo.svg when
 * BRAND.signalLeadsLogoSrc is set; otherwise a development wordmark placeholder.
 */
export function BrandLogo({ className, size = "md", endorsement = false }: { className?: string; size?: "sm" | "md" | "lg"; endorsement?: boolean }) {
  const mark = { sm: "size-7", md: "size-8", lg: "size-11" }[size];
  const word = { sm: "text-[17px]", md: "text-[19px]", lg: "text-[28px]" }[size];
  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      {BRAND.signalLeadsLogoSrc ? (
        <img src={BRAND.signalLeadsLogoSrc} alt="Signal Leads" className={cn(size === "lg" ? "h-11" : "h-8", "w-auto")} />
      ) : (
        <span className="inline-flex items-center gap-2.5">
          <SignalMark className={mark} />
          <span className={cn("font-display leading-none tracking-[0.01em] text-foreground", word)}>
            Signal <span className="text-accent">Leads</span>
          </span>
        </span>
      )}
      {endorsement && <KimeEndorsement className={cn(size === "lg" ? "pl-[3.4rem]" : "pl-[2.6rem]")} />}
    </span>
  );
}
