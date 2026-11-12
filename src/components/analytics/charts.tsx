"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Chart conventions (see dataviz guidance):
 * - Single-series charts use the brand lime; ordinal data (score tiers) uses a one-hue sequential ramp.
 * - Thin marks, 2px lines, 4px rounded data-ends, recessive grid, one y-axis.
 * - Every chart has hover tooltips and an equivalent visually-hidden data table.
 */
const LIME = "var(--accent)";
const GRID = "rgb(155 180 164 / 0.12)";
const AXIS = { fontSize: 11, fill: "var(--foreground-subtle)" };
/** Sequential lime ramp (dark → bright) for ordinal tiers. */
export const SEQ_RAMP = ["#3f6b2a", "#5e9a36", "#86c94a", "#c9ef8a"];

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { value: number }[]; label?: string; format?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border-strong bg-surface-elevated px-2.5 py-1.5 text-xs shadow-lg">
      <p className="text-foreground-muted">{label}</p>
      <p className="font-medium text-foreground tabular">{format ? format(payload[0].value) : payload[0].value}</p>
    </div>
  );
}

function SrTable({ caption, rows }: { caption: string; rows: [string, string | number][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TrendChart({ data, xKey, yKey, caption, height = 220, format }: { data: Record<string, string | number>[]; xKey: string; yKey: string; caption: string; height?: number; format?: (v: number) => string }) {
  return (
    <figure>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={`fill-${yKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LIME} stopOpacity={0.28} />
                <stop offset="100%" stopColor={LIME} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
            <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
            <Area type="monotone" dataKey={yKey} stroke={LIME} strokeWidth={2} fill={`url(#fill-${yKey})`} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: LIME }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption={caption} rows={data.map((d) => [String(d[xKey]), d[yKey]])} />
    </figure>
  );
}

export function ColumnChart({
  data,
  xKey,
  yKey,
  caption,
  height = 200,
  colors,
  format,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  caption: string;
  height?: number;
  colors?: string[];
  format?: (v: number) => string;
}) {
  return (
    <figure>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} tickFormatter={format ? (v: number) => format(v) : undefined} />
            <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: "rgb(166 227 93 / 0.06)" }} />
            <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={44}>
              {data.map((_, i) => (
                <Cell key={i} fill={colors?.[i] ?? LIME} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption={caption} rows={data.map((d) => [String(d[xKey]), format ? format(Number(d[yKey])) : d[yKey]])} />
    </figure>
  );
}

/** Horizontal bar list — crisp HTML bars, value labels in text ink, hover detail via title. */
export function BarList({ items, format, className }: { items: { label: string; value: number; detail?: string }[]; format?: (v: number) => string; className?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="group" title={item.detail ?? `${item.label}: ${format ? format(item.value) : item.value}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-foreground-muted group-hover:text-foreground">{item.label}</span>
            <span className="font-medium text-foreground tabular">{format ? format(item.value) : item.value}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-hover/70">
            <div className="h-2 rounded-full bg-accent/85 transition-[width] group-hover:bg-accent" style={{ width: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Funnel as stepped bars with stage-to-stage conversion. */
export function Funnel({ steps }: { steps: { stage: string; count: number }[] }) {
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null;
        const rate = prev ? Math.round((s.count / prev) * 100) : null;
        return (
          <li key={s.stage} className="grid grid-cols-[84px_1fr_auto] items-center gap-3 text-xs" title={`${s.stage}: ${s.count}${rate !== null ? ` (${rate}% of previous step)` : ""}`}>
            <span className="text-foreground-muted">{s.stage}</span>
            <div className="h-6 rounded-[4px] bg-surface-hover/50">
              <div className="flex h-6 items-center rounded-[4px] bg-accent/80 px-2 text-[11px] font-semibold text-primary-foreground" style={{ width: `${Math.max(s.count ? 6 : 0, (s.count / top) * 100)}%` }}>
                {s.count > 0 && s.count}
              </div>
            </div>
            <span className="w-10 text-right text-foreground-subtle tabular">{rate !== null ? `${rate}%` : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
