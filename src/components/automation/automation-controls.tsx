"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Switch } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { runDueFollowUpsAction, toggleAutomationAction } from "@/server/actions/automations";

export function AutomationToggle({ id, enabled, name, canEdit }: { id: string; enabled: boolean; name: string; canEdit: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={on}
      disabled={pending || !canEdit}
      aria-label={`${on ? "Disable" : "Enable"} ${name}`}
      onCheckedChange={(v) => {
        setOn(v);
        start(async () => {
          const r = await toggleAutomationAction(id, v);
          if (!r.ok) {
            setOn(!v);
            toast.error(r.error);
          } else toast.success(`${name} ${v ? "enabled" : "paused"}`);
        });
      }}
    />
  );
}

export function RunFollowUpsButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await runDueFollowUpsAction();
          if (r.ok) toast(r.data ?? "Done");
          else toast.error(r.error);
        })
      }
    >
      <Play /> Run due follow-ups now
    </Button>
  );
}
