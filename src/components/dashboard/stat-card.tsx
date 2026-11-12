import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/overlays";
import { Info } from "lucide-react";

export function StatCard({
  label,
  value,
  sub,
  hint,
  highlight = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  hint?: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "card relative flex flex-col justify-between gap-2 overflow-hidden p-4",
        highlight && "border-accent/35 bg-[linear-gradient(140deg,rgb(166_227_93/0.12),rgb(13_36_25/0.85)_55%)]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <p className={cn("text-xs", highlight ? "text-kime" : "text-foreground-muted")}>{label}</p>
        {hint && (
          <Tooltip content={hint}>
            <button type="button" className="text-foreground-subtle hover:text-foreground" aria-label={`About ${label}`}>
              <Info className="size-3" />
            </button>
          </Tooltip>
        )}
      </div>
      <p className="font-display text-[28px] leading-none text-foreground tabular">{value}</p>
      {sub && <p className="text-[11px] text-foreground-subtle">{sub}</p>}
    </div>
  );
}
