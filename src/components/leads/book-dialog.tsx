"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { OfferedSlot } from "@/features/leads/lead-state";
import { bookSlotAction, getSlotsAction, offerTimesAction } from "@/server/actions/leads";

/** Staff booking: availability always comes from the calendar provider. */
export function BookDialog({ open, onClose, leadId }: { open: boolean; onClose: () => void; leadId: string }) {
  const [slots, setSlots] = useState<OfferedSlot[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Mounted fresh each time it opens (see LeadControls), so state starts clean.
  useEffect(() => {
    if (!open) return;
    getSlotsAction().then((r) => {
      if (r.ok) setSlots(r.data ?? []);
      else {
        toast.error(r.error);
        setSlots([]);
      }
    });
  }, [open]);

  const book = () =>
    start(async () => {
      const slot = slots?.find((s) => s.id === selected);
      if (!slot) return;
      const r = await bookSlotAction(leadId, slot);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      onClose();
    });

  const offer = () =>
    start(async () => {
      const r = await offerTimesAction(leadId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      onClose();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Book an appointment" description="Pick a time to book directly, or let Signal send the customer the next open times.">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Available times">
          {slots === null
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)
            : slots.length === 0
              ? <p className="col-span-2 text-sm text-foreground-muted">No availability in the next 14 days.</p>
              : slots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={selected === s.id}
                    onClick={() => setSelected(s.id)}
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                      selected === s.id ? "border-accent bg-accent/10 text-foreground" : "border-border bg-background-raised hover:border-border-strong",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
        </div>
        <p className="mt-3 text-[11px] text-foreground-subtle">Times come from the calendar provider and exclude existing appointments.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={offer} loading={pending} disabled={!slots?.length}>
            <Send /> Send times to customer
          </Button>
          <Button variant="primary" onClick={book} loading={pending} disabled={!selected}>
            <CalendarCheck /> Book selected time
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
