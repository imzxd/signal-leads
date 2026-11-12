"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { LEAD_STAGES, SOURCE_LABELS, STAGE_LABELS, TEMPERATURE_LABELS, TEMPERATURES, type LeadSource } from "@/types/domain";

const SOURCES: LeadSource[] = ["form", "embed", "api", "webhook", "email", "sms", "manual"];

export function LeadsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const searchRef = useRef<HTMLInputElement>(null);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update("q", q);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = ["q", "temperature", "stage", "source", "control"].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" aria-hidden />
        <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, service…  ( / )" className="pl-8" aria-label="Search leads" />
      </div>
      <Select aria-label="Temperature" value={params.get("temperature") ?? ""} onChange={(e) => update("temperature", e.target.value)} className="w-auto">
        <option value="">All temperatures</option>
        {TEMPERATURES.map((t) => (
          <option key={t} value={t}>
            {TEMPERATURE_LABELS[t]}
          </option>
        ))}
      </Select>
      <Select aria-label="Stage" value={params.get("stage") ?? ""} onChange={(e) => update("stage", e.target.value)} className="w-auto">
        <option value="">All stages</option>
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select aria-label="Source" value={params.get("source") ?? ""} onChange={(e) => update("source", e.target.value)} className="w-auto">
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s} value={s}>
            {SOURCE_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select aria-label="Autopilot" value={params.get("control") ?? ""} onChange={(e) => update("control", e.target.value)} className="w-auto">
        <option value="">Any control</option>
        <option value="autopilot">Autopilot on</option>
        <option value="paused">Autopilot paused</option>
        <option value="human">Human takeover</option>
      </Select>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            start(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
