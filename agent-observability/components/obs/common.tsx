'use client';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilters, useQ, type Row } from '@/lib/use-q';
import { cn } from '@/lib/utils';
import { EyeOff } from 'lucide-react';
import type React from 'react';

/** Card with built-in loading / error / empty handling for a query result. */
export function DataCard({
  title,
  description,
  query,
  children,
  actions,
  className,
  contentClassName,
  empty = 'No data in this time range',
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  query: { data?: Row[]; error: Error | null; isPending: boolean };
  children: (rows: Row[]) => React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  empty?: string;
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <CardContent className={contentClassName}>
        {query.isPending ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : query.error ? (
          <EmptyState variant="error" title="Query failed" description={query.error.message} />
        ) : !query.data?.length ? (
          <EmptyState title={empty} />
        ) : (
          children(query.data)
        )}
      </CardContent>
    </Card>
  );
}

const RANGES = [7, 30, 90, 365];

export function TimeRange() {
  const { days, set } = useFilters();
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Time range">
      {RANGES.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => set({ days: d })}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
            days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d === 365 ? '1y' : `${d}d`}
        </button>
      ))}
    </div>
  );
}

/** Agent filter populated from the config catalog. */
export function AgentFilter() {
  const { agent, set } = useFilters();
  const q = useQ('config_catalog');
  return (
    <select
      aria-label="Agent"
      value={agent ?? ''}
      onChange={(e) => set({ agent: e.target.value || null })}
      className="h-8 max-w-[14rem] truncate rounded-lg border bg-card px-2 text-xs"
    >
      <option value="">All agents</option>
      {(q.data ?? []).map((r) => (
        <option key={String(r.AGENT_FQN)} value={String(r.AGENT_FQN)}>
          {String(r.DISPLAY_NAME)}
        </option>
      ))}
    </select>
  );
}

/** Placeholder for masked content-tier values. */
export function Hidden({ label = 'Content hidden' }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs italic text-muted-foreground"
      title="Requires AGENT_OBS_CONTENT_ROLE"
    >
      <EyeOff className="h-3 w-3" /> {label}
    </span>
  );
}

export function Flag({ on, label, tone = 'warning' }: { on: boolean; label: string; tone?: 'warning' | 'destructive' | 'secondary' | 'success' }) {
  if (!on) return null;
  return (
    <Badge variant={tone} className="whitespace-nowrap">
      {label}
    </Badge>
  );
}

/** Tiny inline sparkline (SVG, no axes). */
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(...points, 1);
  const w = 80;
  const h = 20;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="text-primary" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

/** Percent change between periods, coloured by direction. */
export function Delta({ cur, prev, invert = false }: { cur: number | null; prev: number | null; invert?: boolean }) {
  if (cur === null || prev === null || prev === 0) return <span>vs prior: —</span>;
  const pct = (cur - prev) / Math.abs(prev);
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={cn(pct === 0 ? '' : good ? 'text-success' : 'text-destructive')}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {Math.abs(pct * 100).toFixed(0)}% vs prior period
    </span>
  );
}
