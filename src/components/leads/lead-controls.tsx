"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, CalendarPlus, Ellipsis, FastForward, Hand, LifeBuoy, Pause, RefreshCcw, SlidersHorizontal, Trophy, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";
import { Field, Input, Select } from "@/components/ui/form-controls";
import type { ActionResult } from "@/server/actions/result";
import {
  assignLeadAction,
  changeStageAction,
  markLostAction,
  markWonAction,
  overrideScoreAction,
  pauseAutopilotAction,
  rerunIntakeAction,
  returnToSignalAction,
  sendNextFollowUpAction,
  takeOverAction,
  triggerHandoffAction,
} from "@/server/actions/leads";
import { LEAD_STAGES, STAGE_LABELS, type ControlMode, type LeadStage } from "@/types/domain";
import { BookDialog } from "./book-dialog";

type Dlg = null | "won" | "lost" | "score" | "stage" | "handoff" | "book";

export function LeadControls({
  leadId,
  controlMode,
  stage,
  score,
  estimatedValue,
  assignedTo,
  team,
  isDemo,
  hasScheduledFollowUp,
}: {
  leadId: string;
  controlMode: ControlMode;
  stage: LeadStage;
  score: number;
  estimatedValue: number | null;
  assignedTo: string | null;
  team: { id: string; name: string | null }[];
  isDemo: boolean;
  hasScheduledFollowUp: boolean;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Dlg>(null);
  const closed = stage === "won" || stage === "lost" || stage === "archived";

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else {
        if (typeof res.data === "string") toast(res.data);
        else if (res.message) toast.success(res.message);
        after?.();
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {controlMode === "autopilot" ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => run(() => takeOverAction(leadId))} disabled={pending}>
            <Hand /> Take over
          </Button>
          <Button variant="ghost" size="sm" onClick={() => run(() => pauseAutopilotAction(leadId))} disabled={pending || closed}>
            <Pause /> Pause autopilot
          </Button>
        </>
      ) : (
        <Button variant="lime" size="sm" onClick={() => run(() => returnToSignalAction(leadId))} disabled={pending}>
          <Bot /> Return to Signal
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={() => setDialog("book")} disabled={pending || closed}>
        <CalendarPlus /> Book
      </Button>
      <Button variant="primary" size="sm" onClick={() => setDialog("won")} disabled={pending || stage === "won"}>
        <Trophy /> Mark won
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDialog("lost")} disabled={pending || stage === "lost"}>
        <XCircle /> Mark lost
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={pending}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("stage")}>
            <SlidersHorizontal /> Change stage
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("score")}>
            <SlidersHorizontal /> Override score
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("handoff")}>
            <LifeBuoy /> Escalate to a person
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(() => rerunIntakeAction(leadId))}>
            <RefreshCcw /> Re-run Signal on this lead
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Assign to</DropdownMenuLabel>
          {team.map((m) => (
            <DropdownMenuItem key={m.id} onSelect={() => run(() => assignLeadAction(leadId, m.id))}>
              <UserRound /> {m.name ?? "Team member"} {assignedTo === m.id && <span className="ml-auto text-[10px] text-accent">current</span>}
            </DropdownMenuItem>
          ))}
          {assignedTo && (
            <DropdownMenuItem onSelect={() => run(() => assignLeadAction(leadId, null))}>
              <UserRound /> Unassign
            </DropdownMenuItem>
          )}
          {isDemo && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Demo tools</DropdownMenuLabel>
              <DropdownMenuItem disabled={!hasScheduledFollowUp} onSelect={() => run(() => sendNextFollowUpAction(leadId))}>
                <FastForward /> Fast-forward next follow-up
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <WonDialog open={dialog === "won"} onClose={() => setDialog(null)} defaultValue={estimatedValue} onConfirm={(v) => run(() => markWonAction(leadId, v), () => setDialog(null))} pending={pending} />
      <LostDialog open={dialog === "lost"} onClose={() => setDialog(null)} onConfirm={(r) => run(() => markLostAction(leadId, r), () => setDialog(null))} pending={pending} />
      <ScoreDialog open={dialog === "score"} onClose={() => setDialog(null)} score={score} onConfirm={(s, r) => run(() => overrideScoreAction(leadId, s, r), () => setDialog(null))} pending={pending} />
      <StageDialog open={dialog === "stage"} onClose={() => setDialog(null)} stage={stage} onConfirm={(s) => run(() => changeStageAction(leadId, s), () => setDialog(null))} pending={pending} />
      <HandoffDialog open={dialog === "handoff"} onClose={() => setDialog(null)} onConfirm={(r) => run(() => triggerHandoffAction(leadId, r), () => setDialog(null))} pending={pending} />
      {dialog === "book" && <BookDialog open onClose={() => setDialog(null)} leadId={leadId} />}
    </div>
  );
}

type DialogProps = { open: boolean; onClose: () => void; pending: boolean };

function WonDialog({ open, onClose, onConfirm, defaultValue, pending }: DialogProps & { defaultValue: number | null; onConfirm: (v: number | null) => void }) {
  const [value, setValue] = useState(defaultValue ? String(Math.round(defaultValue)) : "");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Mark as won" description="Stops all automation for this lead and records the conversion.">
        <Field label="Job value (CAD)" htmlFor="won-value" hint="Used for won revenue and ROI reporting.">
          <Input id="won-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 14500" />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => onConfirm(value ? Number(value) : null)}>
            <Trophy /> Mark won
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LostDialog({ open, onClose, onConfirm, pending }: DialogProps & { onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("Went with another contractor");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Mark as lost?" description="Signal will stop all follow-ups for this lead. You can reopen it later by changing the stage.">
        <Field label="Reason" htmlFor="lost-reason">
          <Select id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {["Went with another contractor", "Price too high", "No response after follow-ups", "Outside service area", "Not a fit", "Other"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => onConfirm(reason)}>
            Mark lost
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScoreDialog({ open, onClose, onConfirm, score, pending }: DialogProps & { score: number; onConfirm: (s: number, reason: string) => void }) {
  const [value, setValue] = useState(score);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Override score" description="Manual scores are recorded with your name. Signal will rescore on the next customer reply.">
        <Field label={`Score: ${value}`} htmlFor="score-range">
          <input id="score-range" type="range" min={0} max={100} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
        </Field>
        <Field label="Why?" htmlFor="score-reason" className="mt-3">
          <Input id="score-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spoke on the phone — ready to sign" maxLength={200} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => onConfirm(value, reason)}>
            Save score
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StageDialog({ open, onClose, onConfirm, stage, pending }: DialogProps & { stage: LeadStage; onConfirm: (s: LeadStage) => void }) {
  const [value, setValue] = useState<LeadStage>(stage);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Change stage" description="Stage changes are recorded on the timeline.">
        <Select aria-label="Stage" value={value} onChange={(e) => setValue(e.target.value as LeadStage)}>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => onConfirm(value)} disabled={value === stage}>
            Update stage
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HandoffDialog({ open, onClose, onConfirm, pending }: DialogProps & { onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Escalate to a person" description="Signal stops messaging this lead and assigns it to you.">
        <Field label="Reason" htmlFor="handoff-reason">
          <Input id="handoff-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Complex commercial job" maxLength={200} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => onConfirm(reason)}>
            <LifeBuoy /> Escalate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
