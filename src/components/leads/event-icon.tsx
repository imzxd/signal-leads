import {
  ArrowDownLeft,
  BellRing,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CircleDollarSign,
  CircleSlash,
  ClipboardList,
  Clock,
  FileSearch,
  Hand,
  LifeBuoy,
  ListChecks,
  MessageSquareText,
  Pause,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  StickyNote,
  TrendingUp,
  TriangleAlert,
  UserPlus,
  XCircle,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  lead_received: UserPlus,
  intake_completed: FileSearch,
  validation: ShieldCheck,
  qualification: ListChecks,
  question_asked: ListChecks,
  knowledge_answered: BookOpen,
  knowledge_escalated: BookOpen,
  score_changed: TrendingUp,
  message_sent: Send,
  message_blocked: CircleSlash,
  message_failed: TriangleAlert,
  reply_received: ArrowDownLeft,
  follow_up_scheduled: CalendarClock,
  follow_up_sent: Clock,
  follow_up_cancelled: XCircle,
  lead_recovered: RotateCcw,
  booking_offered: ClipboardList,
  appointment_created: CalendarCheck,
  appointment_cancelled: XCircle,
  owner_notified: BellRing,
  handoff_requested: LifeBuoy,
  takeover: Hand,
  returned_to_signal: Play,
  autopilot_paused: Pause,
  autopilot_resumed: Play,
  stage_changed: ClipboardList,
  assigned: UserPlus,
  converted: CircleDollarSign,
  lost: XCircle,
  opted_out: CircleSlash,
  note: StickyNote,
  ai_suggestion: Sparkles,
  error: TriangleAlert,
};

export function EventIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type] ?? MessageSquareText;
  return <Icon className={className} aria-hidden />;
}

/** Border/background/text classes for an event's icon bubble. */
export function eventTone(type: string, actor: string): string {
  if (type === "error" || type === "message_failed") return "border-danger/40 bg-danger/10 text-danger";
  if (type === "handoff_requested" || type === "opted_out" || type === "message_blocked") return "border-temp-hot/40 bg-temp-hot/10 text-temp-hot";
  if (type === "converted" || type === "appointment_created" || type === "lead_recovered") return "border-accent/50 bg-accent/15 text-accent";
  if (actor === "lead") return "border-info/40 bg-info/10 text-info";
  if (actor === "staff") return "border-warning/40 bg-warning/10 text-warning";
  if (actor === "agent") return "border-primary/40 bg-primary/10 text-primary";
  return "border-border-strong bg-surface-elevated text-foreground-muted";
}
