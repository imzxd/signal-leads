"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { Bot, Hand, LifeBuoy, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ScoreMeter } from "@/components/leads/lead-badges";
import { cn, formatCurrency, relativeTime } from "@/lib/utils";
import { changeStageAction } from "@/server/actions/leads";
import { STAGE_LABELS, type LeadStage } from "@/types/domain";

export interface PipelineCard {
  id: string;
  name: string;
  service: string | null;
  score: number;
  value: number | null;
  lastActivity: string | null;
  nextAction: string | null;
  column: LeadStage;
  stage: LeadStage;
  controlMode: string;
}

const COLUMN_ACCENT: Partial<Record<LeadStage, string>> = { hot: "bg-temp-hot", booked: "bg-primary", won: "bg-accent", lost: "bg-foreground-subtle" };

function Card({ card, overlay = false }: { card: PipelineCard; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: overlay });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      className={cn(
        "group cursor-grab touch-none rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-colors hover:border-border-strong active:cursor-grabbing",
        isDragging && "opacity-30",
        overlay && "rotate-1 border-accent/50 shadow-xl shadow-black/40",
      )}
      aria-label={`${card.name}, ${STAGE_LABELS[card.stage]}. Press space to move.`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${card.id}`} className="min-w-0 text-sm font-medium text-foreground hover:text-accent" onPointerDown={(e) => e.stopPropagation()}>
          <span className="line-clamp-1">{card.name}</span>
        </Link>
        {card.stage === "needs_human" ? (
          <LifeBuoy className="size-3.5 shrink-0 text-temp-hot" aria-label="Needs human" />
        ) : card.controlMode === "human" ? (
          <Hand className="size-3.5 shrink-0 text-info" aria-label="Human takeover" />
        ) : card.controlMode === "paused" ? (
          <Pause className="size-3.5 shrink-0 text-warning" aria-label="Paused" />
        ) : (
          <Bot className="size-3.5 shrink-0 text-foreground-subtle" aria-label="Autopilot" />
        )}
      </div>
      <p className="mt-0.5 line-clamp-1 text-[11px] text-foreground-muted">{card.service ?? "Service not identified"}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <ScoreMeter score={card.score} />
        <span className="text-xs text-foreground tabular">{formatCurrency(card.value, { compact: true })}</span>
      </div>
      {card.nextAction && <p className="mt-2 line-clamp-1 border-t border-border/70 pt-2 text-[11px] text-foreground-subtle">{card.nextAction}</p>}
      <p className="mt-1 text-[10px] text-foreground-subtle">{relativeTime(card.lastActivity)}</p>
    </div>
  );
}

function Column({ stage, cards }: { stage: LeadStage; cards: PipelineCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = cards.reduce((s, c) => s + (c.value ?? 0), 0);
  return (
    <section ref={setNodeRef} aria-label={`${STAGE_LABELS[stage]} column`} className={cn("flex w-[260px] shrink-0 flex-col rounded-xl border border-border bg-background-raised/60 transition-colors", isOver && "border-accent/50 bg-accent/[0.04]")}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", COLUMN_ACCENT[stage] ?? "bg-accent/60")} aria-hidden />
          <h2 className="text-sm font-medium">{STAGE_LABELS[stage]}</h2>
          <span className="rounded-full bg-surface-elevated px-1.5 text-[11px] text-foreground-muted tabular">{cards.length}</span>
        </div>
        <span className="text-[11px] text-foreground-subtle tabular">{formatCurrency(total, { compact: true })}</span>
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 240px)" }}>
        {cards.map((c) => (
          <Card key={c.id} card={c} />
        ))}
        {cards.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-foreground-subtle">Drop leads here</p>}
      </div>
    </section>
  );
}

export function PipelineBoard({ columns, initial }: { columns: LeadStage[]; initial: PipelineCard[] }) {
  const [cards, setCards] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; to: LeadStage } | null>(null);
  const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  // Adopt fresh server data (live refresh) whenever we're not mid-drag or mid-save.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial && !activeId && !pending) {
    setSeen(initial);
    setCards(initial);
  }

  const move = (id: string, to: LeadStage) => {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, column: to, stage: to } : c)));
    start(async () => {
      const res = await changeStageAction(id, to);
      if (!res.ok) {
        setCards(prev);
        toast.error(res.error);
      } else toast.success(`Moved to ${STAGE_LABELS[to]}`);
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const to = e.over?.id as LeadStage | undefined;
    const card = cards.find((c) => c.id === e.active.id);
    if (!to || !card || card.column === to) return;
    if (to === "won" || to === "lost") setConfirm({ id: card.id, to });
    else move(card.id, to);
  };

  const active = cards.find((c) => c.id === activeId);
  const confirmCard = cards.find((c) => c.id === confirm?.id);

  return (
    <>
      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8">
          {columns.map((stage) => (
            <Column key={stage} stage={stage} cards={cards.filter((c) => c.column === stage)} />
          ))}
        </div>
        <DragOverlay>{active ? <Card card={active} overlay /> : null}</DragOverlay>
      </DndContext>
      <Dialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title={`Mark ${confirmCard?.name ?? "lead"} as ${confirm?.to === "won" ? "won" : "lost"}?`} description="This stops all automation for the lead. It's recorded on the timeline and in analytics.">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.to === "won" ? "primary" : "danger"}
              onClick={() => {
                if (confirm) move(confirm.id, confirm.to);
                setConfirm(null);
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
