"use client";

import { useState } from "react";
import { ChevronRight, CircleSlash, Info, StickyNote } from "lucide-react";
import type { DecisionReceipt } from "@/features/leads/receipts";
import { cn, formatTime } from "@/lib/utils";
import { EventIcon, eventTone } from "./event-icon";
import { ChannelBadge } from "./lead-badges";

export type TimelineItem =
  | {
      kind: "event";
      id: string;
      at: string;
      type: string;
      actor: string;
      actorLabel: string;
      title: string;
      detail: string | null;
      receipt: DecisionReceipt | null;
    }
  | {
      kind: "message";
      id: string;
      at: string;
      direction: "inbound" | "outbound" | "internal";
      authorType: string;
      authorLabel: string;
      channel: string;
      body: string;
      status: string;
      blockReason: string | null;
      purpose: string | null;
    };

/** Events that a message bubble already represents — hidden in the combined view to avoid repetition. */
const REPRESENTED_BY_MESSAGE = new Set(["message_sent", "follow_up_sent", "reply_received", "note"]);

const PURPOSE_LABEL: Record<string, string> = {
  first_response: "First response",
  reply: "Reply",
  booking_offer: "Booking offer",
  booking_confirmation: "Confirmation",
  handoff_holding: "Holding reply",
  out_of_scope: "Scope check",
  closing: "Closing",
  follow_up: "Follow-up",
};

function dayLabel(iso: string, timeZone: string) {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
  const d = fmt(new Date(iso));
  const today = fmt(new Date());
  const yesterday = fmt(new Date(Date.now() - 86_400_000));
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone }).format(new Date(iso));
}

function Receipt({ receipt }: { receipt: DecisionReceipt }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-background-raised/70 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {receipt.scoreDelta !== undefined && (
          <span className={cn("rounded px-1.5 py-0.5 font-semibold tabular", receipt.scoreDelta >= 0 ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger")}>
            {receipt.scoreDelta >= 0 ? "+" : ""}
            {receipt.scoreDelta}
          </span>
        )}
        <span className="text-foreground">{receipt.headline}</span>
      </div>
      {receipt.reasons.length > 0 && (
        <>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-foreground-subtle">Reasons</p>
          <ul className="mt-1 space-y-0.5 text-foreground-muted">
            {receipt.reasons.map((r) => (
              <li key={r} className="flex gap-1.5">
                <span aria-hidden className="text-accent">·</span>
                {r}
              </li>
            ))}
          </ul>
        </>
      )}
      {receipt.sources && receipt.sources.length > 0 && <p className="mt-2 text-foreground-subtle">Sources: {receipt.sources.join(", ")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-foreground-subtle">
        {receipt.nextAction && (
          <span>
            Next action: <span className="text-foreground">{receipt.nextAction}</span>
          </span>
        )}
        {receipt.confidence !== undefined && <span>Confidence {Math.round(receipt.confidence * 100)}%</span>}
        {receipt.fallback && (
          <span className="inline-flex items-center gap-1 text-warning">
            <Info className="size-3" /> Deterministic fallback used
          </span>
        )}
      </div>
    </div>
  );
}

function EventRow({ item, timeZone }: { item: Extract<TimelineItem, { kind: "event" }>; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(item.receipt) || Boolean(item.detail && !REPRESENTED_BY_MESSAGE.has(item.type));
  return (
    <li className="relative pl-9">
      <span className={cn("absolute left-0 top-0.5 flex size-[22px] items-center justify-center rounded-full border", eventTone(item.type, item.actor))}>
        <EventIcon type={item.type} className="size-3" />
      </span>
      <div className="flex items-start gap-3">
        <span className="w-16 shrink-0 pt-0.5 text-[11px] text-foreground-subtle tabular">{formatTime(item.at, timeZone)}</span>
        <div className="min-w-0 flex-1">
          {expandable ? (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group flex w-full items-start gap-1 text-left">
              <span className="text-sm text-foreground group-hover:text-accent">{item.title}</span>
              <ChevronRight className={cn("mt-1 size-3.5 shrink-0 text-foreground-subtle transition-transform", open && "rotate-90")} aria-hidden />
            </button>
          ) : (
            <p className="text-sm text-foreground">{item.title}</p>
          )}
          <p className="text-[11px] text-foreground-subtle">{item.actorLabel}</p>
          {open && (
            <div className="animate-fade-in">
              {item.detail && !REPRESENTED_BY_MESSAGE.has(item.type) && <p className="mt-1.5 whitespace-pre-line text-xs text-foreground-muted">{item.detail}</p>}
              {item.receipt && <Receipt receipt={item.receipt} />}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function MessageRow({ item, timeZone }: { item: Extract<TimelineItem, { kind: "message" }>; timeZone: string }) {
  const inbound = item.direction === "inbound";
  const note = item.direction === "internal";
  const blocked = item.status === "blocked" || item.status === "failed";
  return (
    <li className="relative pl-9">
      <span
        className={cn(
          "absolute left-[7px] top-2 size-2 rounded-full ring-4 ring-background",
          inbound ? "bg-info" : note ? "bg-warning" : item.authorType === "staff" ? "bg-warning" : "bg-accent",
        )}
        aria-hidden
      />
      <div className="flex items-start gap-3">
        <span className="w-16 shrink-0 pt-2 text-[11px] text-foreground-subtle tabular">{formatTime(item.at, timeZone)}</span>
        <div
          className={cn(
            "min-w-0 flex-1 rounded-lg border px-3.5 py-2.5",
            inbound && "border-info/25 bg-info/[0.06]",
            !inbound && !note && item.authorType === "ai" && "border-accent/25 bg-accent/[0.05]",
            !inbound && !note && item.authorType === "staff" && "border-warning/25 bg-warning/[0.05]",
            note && "border-dashed border-warning/40 bg-transparent",
            blocked && "opacity-70",
          )}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-subtle">
            {note && <StickyNote className="size-3 text-warning" aria-hidden />}
            <span className="font-medium text-foreground-muted">{item.authorLabel}</span>
            {item.purpose && PURPOSE_LABEL[item.purpose] && <span>· {PURPOSE_LABEL[item.purpose]}</span>}
            {!note && <ChannelBadge channel={item.channel} />}
            {item.status === "simulated" && <span title="Development channel: recorded, not actually delivered">· Simulated delivery</span>}
            {blocked && (
              <span className="inline-flex items-center gap-1 text-temp-hot">
                <CircleSlash className="size-3" /> {item.status === "blocked" ? `Not sent${item.blockReason ? ` — ${item.blockReason.replace(/_/g, " ")}` : ""}` : "Failed"}
              </span>
            )}
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{item.body}</p>
        </div>
      </div>
    </li>
  );
}

export function ActivityTimeline({ items, timeZone }: { items: TimelineItem[]; timeZone: string }) {
  const [view, setView] = useState<"all" | "conversation" | "decisions">("all");
  const visible = items.filter((i) => {
    if (view === "conversation") return i.kind === "message";
    if (view === "decisions") return i.kind === "event";
    return i.kind === "message" || !REPRESENTED_BY_MESSAGE.has(i.type);
  });

  const days = visible.map((item) => dayLabel(item.at, timeZone));
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Activity</h2>
        <div role="tablist" aria-label="Timeline view" className="inline-flex rounded-lg border border-border bg-background-raised p-0.5 text-xs">
          {(["all", "conversation", "decisions"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("rounded-md px-2.5 py-1 capitalize text-foreground-muted hover:text-foreground", view === v && "bg-surface-elevated text-foreground")}
            >
              {v === "all" ? "Everything" : v}
            </button>
          ))}
        </div>
      </div>
      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[10px] before:top-2 before:w-px before:bg-border">
        {visible.map((item, i) => {
          const showDay = i === 0 || days[i] !== days[i - 1];
          return (
            <FragmentWithDay key={`${item.kind}-${item.id}`} day={showDay ? days[i] : null}>
              {item.kind === "event" ? <EventRow item={item} timeZone={timeZone} /> : <MessageRow item={item} timeZone={timeZone} />}
            </FragmentWithDay>
          );
        })}
      </ol>
    </div>
  );
}

function FragmentWithDay({ day, children }: { day: string | null; children: React.ReactNode }) {
  return (
    <>
      {day && (
        <li className="relative pl-9 pt-1" aria-hidden>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-kime">{day}</span>
        </li>
      )}
      {children}
    </>
  );
}
