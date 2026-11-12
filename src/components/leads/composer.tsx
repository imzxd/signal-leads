"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FlaskConical, Send, Sparkles, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form-controls";
import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { addNoteAction, sendStaffMessageAction, simulateCustomerReplyAction, suggestReplyAction } from "@/server/actions/leads";

type Mode = "message" | "note" | "simulate";

const DEMO_REPLIES = ["42 Maple Ave, it's a detached house", "2", "Do you offer financing?", "Can I speak to a real person?", "We went with someone else, thanks", "STOP"];

export function Composer({ leadId, controlMode, isDemo, optedOut }: { leadId: string; controlMode: string; isDemo: boolean; optedOut: boolean }) {
  const [mode, setMode] = useState<Mode>("message");
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [suggesting, startSuggest] = useTransition();

  const submit = () => {
    if (!text.trim()) return;
    start(async () => {
      const res = mode === "message" ? await sendStaffMessageAction(leadId, text) : mode === "note" ? await addNoteAction(leadId, text) : await simulateCustomerReplyAction(leadId, text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (mode === "simulate") toast.success("Customer reply received — Signal processed it.");
      else if (res.message) toast.success(res.message);
      setText("");
    });
  };

  const suggest = () =>
    startSuggest(async () => {
      const res = await suggestReplyAction(leadId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMode("message");
      setText(res.data?.message ?? "");
      toast("Suggestion drafted — review and edit before sending.");
    });

  const tabs: { id: Mode; label: string; icon: typeof Send }[] = [
    { id: "message", label: "Message", icon: Send },
    { id: "note", label: "Internal note", icon: StickyNote },
    ...(isDemo ? [{ id: "simulate" as const, label: "Simulate customer", icon: FlaskConical }] : []),
  ];

  return (
    <div className={cn("card p-3", mode === "simulate" && "border-info/40", mode === "note" && "border-dashed border-warning/40")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Composer mode" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground", mode === t.id && "bg-surface-elevated text-foreground")}
            >
              <t.icon className="size-3.5" aria-hidden /> {t.label}
            </button>
          ))}
        </div>
        {mode === "message" && (
          <Button variant="lime" size="sm" onClick={suggest} loading={suggesting}>
            <Sparkles /> Request AI suggestion
          </Button>
        )}
      </div>
      {mode === "message" && controlMode === "autopilot" && <p className="mb-2 text-[11px] text-foreground-subtle">Sending a message yourself pauses this lead&apos;s automated follow-ups. Take over to stop Signal replying entirely.</p>}
      {mode === "message" && optedOut && <p className="mb-2 text-[11px] text-temp-hot">This lead opted out — messages will be blocked.</p>}
      {mode === "simulate" && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {DEMO_REPLIES.map((r) => (
            <button key={r} type="button" onClick={() => setText(r)} className="rounded-full border border-info/30 px-2 py-0.5 text-[11px] text-info hover:bg-info/10">
              {r}
            </button>
          ))}
        </div>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        aria-label={mode === "message" ? "Message to customer" : mode === "note" ? "Internal note" : "Simulated customer reply"}
        placeholder={mode === "message" ? "Write to the customer…" : mode === "note" ? "Only your team sees notes…" : "Type what the customer replies — it runs through the real inbound pipeline."}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="hidden text-[11px] text-foreground-subtle sm:inline">
          <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to send
        </span>
        <Button variant={mode === "simulate" ? "secondary" : "primary"} size="sm" onClick={submit} loading={pending} disabled={!text.trim()}>
          {mode === "message" ? "Send" : mode === "note" ? "Add note" : "Send as customer"}
        </Button>
      </div>
    </div>
  );
}
