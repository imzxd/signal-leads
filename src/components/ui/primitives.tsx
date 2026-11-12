import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, initials } from "@/lib/utils";

/* Card ------------------------------------------------------------------------------- */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-foreground-muted", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

/* Badge ------------------------------------------------------------------------------ */
const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border bg-surface-elevated text-foreground-muted",
      lime: "border-accent/30 bg-accent/10 text-accent",
      primary: "border-primary/30 bg-primary/12 text-primary",
      warning: "border-warning/30 bg-warning/10 text-warning",
      danger: "border-danger/30 bg-danger/10 text-danger",
      info: "border-info/30 bg-info/10 text-info",
      cold: "border-temp-cold/30 bg-temp-cold/10 text-temp-cold",
      warm: "border-temp-warm/30 bg-temp-warm/10 text-temp-warm",
      qualified: "border-temp-qualified/30 bg-temp-qualified/10 text-temp-qualified",
      hot: "border-temp-hot/35 bg-temp-hot/12 text-temp-hot",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* Skeleton --------------------------------------------------------------------------- */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-surface-elevated/80", className)} aria-hidden {...props} />;
}

/* Avatar ----------------------------------------------------------------------------- */
export function Avatar({ name, className, tone = "default" }: { name: string | null | undefined; className?: string; tone?: "default" | "lime" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
        tone === "lime" ? "border-accent/30 bg-accent/12 text-accent" : "border-border-strong bg-surface-elevated text-foreground-muted",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/* Empty state ------------------------------------------------------------------------ */
export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-1 flex size-10 items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground-muted [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-foreground-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* Page header ------------------------------------------------------------------------ */
export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="font-display text-[28px] leading-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-foreground-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* Stat --------------------------------------------------------------------------------- */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-surface-elevated px-1.5 py-0.5 font-sans text-[10px] text-foreground-muted">{children}</kbd>;
}
