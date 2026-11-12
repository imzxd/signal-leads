"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="card mx-auto mt-16 max-w-md p-8 text-center">
      <TriangleAlert className="mx-auto size-8 text-warning" aria-hidden />
      <h2 className="mt-3 font-display text-2xl">Something went wrong</h2>
      <p className="mt-1 text-sm text-foreground-muted">This view couldn&apos;t load. Your leads and automations are unaffected.</p>
      {error.digest && <p className="mt-2 text-[11px] text-foreground-subtle">Reference: {error.digest}</p>}
      <Button variant="primary" className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
