'use client';

import { CHART_COLORS, CHART_THEME, ChartTooltip, formatTick } from '@/components/chart-utils';
import { DataCard, Delta, Flag, Hidden, TimeRange } from '@/components/obs/common';
import { TurnTable } from '@/components/obs/turns';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard, StatCardSkeleton } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { arr, bool, num, obj, useFilters, useQ, type Row } from '@/lib/use-q';
import { Coins, Gauge, MessageSquare, Timer, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function AgentView() {
  const { days, sp } = useFilters();
  const fqn = sp.get('fqn');
  const cfg = useQ('agent', { agent: fqn }, !!fqn);
  const kpis = useQ('kpis', { days, agent: fqn }, !!fqn);
  const history = useQ('config_history', { agent: fqn }, !!fqn);

  if (!fqn) return <Shell><EmptyState title="No agent selected" description="Open an agent from the portfolio leaderboard." /></Shell>;

  const a = cfg.data?.[0];
  const cur = kpis.data?.find((r) => r.PERIOD === 'cur') ?? {};
  const prev = kpis.data?.find((r) => r.PERIOD === 'prev') ?? {};

  return (
    <Shell>
      <PageHeader
        eyebrow="Agent"
        title={a ? String(a.DISPLAY_NAME) : fqn}
        description={a?.COMMENT ? String(a.COMMENT) : fqn}
        actions={<TimeRange />}
      />
      {cfg.error && <EmptyState variant="error" title="Could not load agent" description={cfg.error.message} />}
      {a && <ConfigBadges a={a} />}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.isPending ? (
          Array.from({ length: 5 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Turns" icon={MessageSquare} value={formatNumber(cur.TURNS ?? 0)} hint={<Delta cur={num(cur.TURNS)} prev={num(prev.TURNS)} />} />
            <StatCard label="Users" icon={Users} value={formatNumber(cur.USERS ?? 0)} hint={<Delta cur={num(cur.USERS)} prev={num(prev.USERS)} />} />
            <StatCard label="AI credits" icon={Coins} value={formatNumber(cur.CREDITS, 3)} hint={`${formatNumber((num(cur.CREDITS) ?? 0) / Math.max(1, num(cur.TURNS) ?? 1), 4)} / turn`} />
            <StatCard label="p95 latency" icon={Timer} value={formatDuration(cur.P95_MS)} hint={`p50 ${formatDuration(cur.P50_MS)}`} />
            <StatCard label="Success" icon={Gauge} value={formatPercent(cur.SUCCESS_RATE)} hint={`SQL error ${formatPercent(cur.SQL_ERROR_RATE)}`} />
          </>
        )}
      </section>

      <TrendWithVersions fqn={fqn} changes={history.data ?? []} />

      <section className="grid gap-4 lg:grid-cols-3">
        <ToolUsage fqn={fqn} className="lg:col-span-2" />
        <PlanningDepth fqn={fqn} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ToolConfig fqn={fqn} />
        <TopUsers fqn={fqn} />
      </section>

      <TurnTable title="Failed or SQL-error turns" agent={fqn} failed limit={25} />
      <TurnTable title="Recent turns" agent={fqn} limit={50} />
      <ConfigHistory query={history} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">{children}</main>;
}

function ConfigBadges({ a }: { a: Row }) {
  const b = (on: unknown, label: string) => (bool(on) ? <Badge variant="secondary">{label}</Badge> : null);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Badge variant="outline" className="font-mono">{String(a.AGENT_FQN)}</Badge>
      <Badge>model: {String(a.ORCHESTRATION_MODEL ?? 'default')}</Badge>
      <Badge variant="outline">
        budget: {a.BUDGET_SECONDS ? `${a.BUDGET_SECONDS}s / ${formatNumber(a.BUDGET_TOKENS)} tok` : 'unbounded'}
      </Badge>
      <Badge variant="outline">
        tools: {String(a.TOOL_COUNT)} ({String(a.ANALYST_TOOL_COUNT)} analyst · {String(a.SEARCH_TOOL_COUNT)} search · {String(a.CUSTOM_TOOL_COUNT)} custom)
      </Badge>
      {b(a.HAS_WEB_SEARCH, 'web search')}
      {b(a.HAS_CODE_EXECUTION, 'code execution')}
      {b(a.HAS_CHARTS, 'charts')}
      {b(a.HAS_MCP, 'MCP')}
      {b(a.HAS_MEMORY, 'memory')}
      {b(a.HAS_ANALYTICAL_SEARCH, 'analytical search')}
      <Badge variant="outline">owner: {String(a.OWNER)}</Badge>
      <Badge variant="outline">default version: {String(a.DEFAULT_VERSION_NAME ?? '—')} of {String(a.VERSION_COUNT ?? '—')}</Badge>
      <Badge variant="outline">created {formatDateTime(a.CREATED_ON)}</Badge>
      <Flag on={bool(a.GOV_NO_DESCRIPTION)} label="no description" />
      <Flag on={bool(a.GOV_NO_SAMPLE_QUESTIONS)} label="no sample questions" />
      <Flag on={bool(a.IS_DROPPED)} label="dropped" tone="destructive" />
    </div>
  );
}

function TrendWithVersions({ fqn, changes }: { fqn: string; changes: Row[] }) {
  const { days } = useFilters();
  const q = useQ('trend', { days, agent: fqn });
  return (
    <DataCard title="Daily usage" description="Turns (bars) and credits (line); dashed markers are config changes" query={q}>
      {(rows) => {
        const byDay = new Map<string, { DAY: string; Turns: number; Credits: number }>();
        for (const r of rows) {
          const d = String(r.DAY).slice(0, 10);
          const o = byDay.get(d) ?? { DAY: d, Turns: 0, Credits: 0 };
          o.Turns += num(r.TURNS) ?? 0;
          o.Credits += num(r.CREDITS) ?? 0;
          byDay.set(d, o);
        }
        const data = [...byDay.values()].sort((x, y) => x.DAY.localeCompare(y.DAY));
        const marks = changes.filter((c) => !bool(c.IS_FIRST_SEEN)).map((c) => String(c.CHANGED_AT).slice(0, 10));
        return (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="DAY" tick={CHART_THEME.tick} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="t" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <YAxis yAxisId="c" orientation="right" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={48} tickFormatter={formatTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="t" dataKey="Turns" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                <Line yAxisId="c" dataKey="Credits" stroke={CHART_COLORS[2]} dot={false} strokeWidth={2} />
                {marks.map((m) => (
                  <ReferenceLine key={m} yAxisId="t" x={m} stroke="var(--warning)" strokeDasharray="4 3" />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function ToolUsage({ fqn, className }: { fqn: string; className?: string }) {
  const { days } = useFilters();
  const q = useQ('tool_usage', { days, agent: fqn });
  return (
    <DataCard title="Tool usage" description="Tool-call spans from traces" query={q} className={className} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Category</TableHead>
              <TableHead numeric>Calls</TableHead>
              <TableHead numeric>Turns</TableHead>
              <TableHead numeric>Error %</TableHead>
              <TableHead numeric>Avg</TableHead>
              <TableHead numeric>p95</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="max-w-[14rem] truncate font-medium">{String(r.TOOL_NAME)}</TableCell>
                <TableCell><Badge variant="outline">{String(r.SPAN_CATEGORY)}</Badge></TableCell>
                <TableCell numeric>{formatNumber(r.CALLS)}</TableCell>
                <TableCell numeric>{formatNumber(r.TURNS)}</TableCell>
                <TableCell numeric>{formatPercent((num(r.ERRORS) ?? 0) / Math.max(1, num(r.CALLS) ?? 1))}</TableCell>
                <TableCell numeric>{formatDuration(r.AVG_MS)}</TableCell>
                <TableCell numeric>{formatDuration(r.P95_MS)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function PlanningDepth({ fqn }: { fqn: string }) {
  const { days } = useFilters();
  const q = useQ('planning_depth', { days, agent: fqn });
  return (
    <DataCard title="Planning depth" description="Planning steps per turn (10 = 10+)" query={q}>
      {(rows) => {
        const data = rows.map((r) => ({ steps: String(r.STEPS), Turns: num(r.TURNS) ?? 0 }));
        return (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="steps" tick={CHART_THEME.tick} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Turns" fill={CHART_COLORS[3]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function ToolConfig({ fqn }: { fqn: string }) {
  const q = useQ('agent_tools', { agent: fqn });
  return (
    <DataCard title="Configured tools" description="Current spec: tool → bound resource" query={q} contentClassName="p-0" empty="No tools configured">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Resource</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium" title={String(r.TOOL_DESCRIPTION ?? '')}>{String(r.TOOL_NAME)}</TableCell>
                <TableCell><Badge variant="outline">{String(r.TOOL_TYPE)}</Badge></TableCell>
                <TableCell className="max-w-[18rem] truncate font-mono text-xs" title={String(r.RESOURCE_FQN ?? '')}>
                  {String(r.RESOURCE_FQN ?? '—')}
                  {r.WAREHOUSE ? <span className="text-muted-foreground"> · {String(r.WAREHOUSE)}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function TopUsers({ fqn }: { fqn: string }) {
  const { days } = useFilters();
  const q = useQ('top_users', { days, agent: fqn });
  return (
    <DataCard title="Top users" query={q} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead numeric>Turns</TableHead>
              <TableHead numeric>Threads</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead>Last active (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.USER_NAME)}>
                <TableCell className="font-medium">{String(r.USER_NAME ?? '—')}</TableCell>
                <TableCell numeric>{formatNumber(r.TURNS)}</TableCell>
                <TableCell numeric>{formatNumber(r.THREADS)}</TableCell>
                <TableCell numeric>{formatNumber(r.CREDITS, 3)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(r.LAST_ACTIVE_UTC)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

/** SCD2 history with a key-level spec diff against the previous version. */
function ConfigHistory({ query }: { query: { data?: Row[]; error: Error | null; isPending: boolean } }) {
  return (
    <DataCard title="Configuration history" description="Captured hourly-to-12-hourly from DESCRIBE AGENT; diff vs the previous snapshot" query={query}>
      {(rows) => (
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const diffs = specDiff(obj(r.PREV_AGENT_SPEC), obj(r.AGENT_SPEC));
            return (
              <li key={i} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{formatDateTime(r.CHANGED_AT)}</span>
                  {bool(r.IS_FIRST_SEEN) && <Badge variant="secondary">first captured</Badge>}
                  {bool(r.IS_DROPPED) && <Badge variant="destructive">dropped</Badge>}
                  <span className="text-muted-foreground">default version {String(r.DEFAULT_VERSION_NAME ?? '—')}</span>
                </div>
                {!bool(r.IS_FIRST_SEEN) && (
                  <ul className="mt-2 space-y-1 font-mono text-xs">
                    {diffs.length === 0 && <li className="text-muted-foreground">No spec change (owner / profile / versions changed)</li>}
                    {diffs.slice(0, 25).map((d) => (
                      <li key={d.path} className="break-all">
                        <span className="text-muted-foreground">{d.path}: </span>
                        <span className="text-destructive line-through">{d.before}</span> → <span className="text-success">{d.after}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </DataCard>
  );
}

function flatten(o: unknown, prefix = '', out: Record<string, string> = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(o)) {
    o.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else out[prefix] = o === undefined ? '' : JSON.stringify(o);
  return out;
}

function specDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const a = flatten(before ?? {});
  const b = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const trim = (s: string | undefined) => (s === undefined ? '∅' : s.length > 120 ? `${s.slice(0, 117)}…` : s);
  return keys.filter((k) => a[k] !== b[k]).map((k) => ({ path: k, before: trim(a[k]), after: trim(b[k]) }));
}

