import { Bot, Hand, Mail, MessageSquare, Pause, Globe } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, TEMPERATURE_LABELS, type ControlMode, type LeadStage, type Temperature } from "@/types/domain";

const TEMP_TONE: Record<Temperature, BadgeTone> = { cold: "cold", warm: "warm", qualified: "qualified", hot: "hot" };

export function TemperatureBadge({ temperature }: { temperature: Temperature }) {
  return (
    <Badge tone={TEMP_TONE[temperature]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {TEMPERATURE_LABELS[temperature]}
    </Badge>
  );
}

const STAGE_TONE: Partial<Record<LeadStage, BadgeTone>> = {
  booked: "primary",
  won: "lime",
  lost: "neutral",
  needs_human: "hot",
  booking: "info",
  hot: "hot",
  archived: "neutral",
};

export function StageBadge({ stage }: { stage: LeadStage }) {
  return <Badge tone={STAGE_TONE[stage] ?? "neutral"}>{STAGE_LABELS[stage]}</Badge>;
}

/** Score as a number with a thin meter. Temperature tiers use the sequential lime ramp. */
export function ScoreMeter({ score, className }: { score: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-label={`Score ${score} of 100`}>
      <span className="w-6 text-right text-sm font-medium tabular text-foreground">{score}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${score}%`, opacity: 0.35 + (score / 100) * 0.65 }} />
      </span>
    </span>
  );
}

export function ControlBadge({ mode }: { mode: ControlMode }) {
  if (mode === "autopilot")
    return (
      <Badge tone="lime">
        <Bot className="size-3" aria-hidden /> Autopilot
      </Badge>
    );
  if (mode === "paused")
    return (
      <Badge tone="warning">
        <Pause className="size-3" aria-hidden /> Paused
      </Badge>
    );
  return (
    <Badge tone="info">
      <Hand className="size-3" aria-hidden /> Human
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; icon: typeof Mail }> = {
    email: { label: "EMAIL", icon: Mail },
    sms: { label: "SMS", icon: MessageSquare },
    web: { label: "WEB", icon: Globe },
  };
  const c = map[channel] ?? { label: channel.toUpperCase(), icon: Globe };
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px text-[10px] font-semibold tracking-wider text-foreground-muted">
      <Icon className="size-3" aria-hidden /> {c.label}
    </span>
  );
}
