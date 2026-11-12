"use client";

import { useEffect } from "react";
import { markReadAction } from "@/server/actions/leads";

/** Marks the lead's conversation as read when it's opened. */
export function MarkRead({ leadId }: { leadId: string }) {
  useEffect(() => {
    void markReadAction(leadId).catch(() => undefined);
  }, [leadId]);
  return null;
}
