'use client';

import { CHART_COLORS, CHART_THEME, ChartTooltip, formatTick } from '@/components/chart-utils';
import { DataCard, Hidden, TimeRange } from '@/components/obs/common';
import { PageHeader } from '@/components/page-header';
import { StatCard, StatCardSkeleton } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { bool, num, useFilters, useQ, withDays, type Row } from '@/lib/use-q';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowLeft, CalendarClock, Coins, PauseCircle, PlayCircle, Users } from 'lucide-react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const KIND_LABEL: Record<string, string> = { COWORK: 'CoWork', COCO: 'Cortex Code', AGENT_SDK: 'Agent SDK' };
const kindLabel = (v: unknown) => KIND_LABEL[String(v)] ?? String(v ?? '—');

const HEALTH: Record<string, { label: string; tone: 'success' | 'warning' | 'destructive' | 'secondary'; help: string }> = {
  healthy: { label: 'Healthy', tone: 'success', help: 'Running on schedule, no failures in 30 days' },
  flaky: { label: 'Flaky', tone: 'warning', help: 'Last run succeeded, but there were failures in the last 30 days' },
  failing: { label: 'Failing', tone: 'destructive', help: 'The most recent run failed' },
  auto_suspended: { label: 'Auto-suspended', tone: 'destructive', help: 'Snowflake suspended it after repeated failures' },
  paused: { label: 'Paused', tone: 'secondary', help: 'Suspended by its owner' },
  never_run: { label: 'Never run', tone: 'secondary', help: 'Scheduled but no runs recorded yet' },
  deleted: { label: 'Deleted', tone: 'secondary', help: 'Dropped; kept here for history' },
};
const HealthBadge = ({ h }: { h: unknown }) => {
  const x = HEALTH[String(h)] ?? { label: String(h ?? '—'), tone: 'secondary' as const, help: '' };
  return <Badge variant={x.tone} title={x.help} className="whitespace-nowrap">{x.label}</Badge>;
};
const utc = (v: unknown) => (v ? String(v) : null);

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Plain-English version of a task schedule ("USING CRON 0 9 * * 1 America/New_York" → "Mondays at 09:00 America/New_York"). */
export function describeSchedule(s: unknown): string {
  const v = String(s ?? '').trim();
  if (!v) return 'Manual';
  const every = v.match(/^(\d+)\s*(MINUTE|MINUTES|HOUR|HOURS|M|H)$/i);
  if (every) return `Every ${every[1]} ${/^h/i.test(every[2]) ? 'hours' : 'minutes'}`;
  const m = v.match(/^USING CRON\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(\S+)?/i);
  if (!m) return v;
  const [, min, hour, dom, mon, dow, tz = 'UTC'] = m;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${hour.padStart(2, '0')}:${min.padStart(2, '0')}` : null;
  const at = time ? ` at ${time} ${tz}` : ` (${min} ${hour}) ${tz}`;
  if (dom === '*' && mon === '*') {
    if (dow === '*') return `Daily${at}`;
    if (dow === '1-5' || /^mon-fri$/i.test(dow)) return `Weekdays${at}`;
    const days = dow.split(',').map((d) => (/^\d$/.test(d) ? `${DOW[Number(d) % 7]}s` : d));
    return `${days.join(', ')}${at}`;
  }
  if (mon === '*' && /^\d+$/.test(dom) && dow === '*') return `Monthly on day ${dom}${at}`;
  return v.replace(/^USING CRON\s+/i, 'cron ');
}

export function AutomationsView() {
  const { sp } = useFilters();
  const task = sp.get('task');
  return task ? <AutomationDetail task={task} /> : <Overview />;
}

function ShowDeletedToggle() {
  const { sp, set } = useFilters();
  const on = sp.get('failed') === '1';
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <input type="checkbox" checked={on} onChange={(e) => set({ failed: e.target.checked ? 1 : null })} /> show deleted
    </label>
  );
}

function Overview() {
  const { days, sp } = useFilters();
  const showDeleted = sp.get('failed') === '1' ? 1 : 0;
  const me = useQ('whoami');
  const canView = bool(me.data?.[0]?.CAN_VIEW_CONTENT);
  const list = useQ('auto_list', { failed: showDeleted });
  const rows = list.data ?? [];
  const live = rows.filter((r) => !bool(r.IS_DELETED));
  const active = live.filter((r) => r.STATE === 'started').length;
  const attention = live.filter((r) => ['failing', 'auto_suspended', 'flaky'].includes(String(r.HEALTH))).length;
  const runs30 = live.reduce((a, r) => a + (num(r.RUNS_30D) ?? 0), 0);
  const failed30 = live.reduce((a, r) => a + (num(r.FAILED_30D) ?? 0), 0);
  const credits30 = live.reduce((a, r) => a + (num(r.CREDITS_30D) ?? 0), 0);
  const owners = new Set(live.map((r) => String(r.OWNER_USER))).size;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="Automations"
        title="Scheduled automations"
        description="Every CoWork automation and Cortex Code routine users have scheduled in this account: what runs, when, whether it works and what it costs."
        actions={<div className="flex flex-wrap items-center gap-3"><ShowDeletedToggle /><TimeRange /></div>}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {list.isPending ? Array.from({ length: 8 }, (_, i) => <StatCardSkeleton key={i} />) : (
          <>
            <StatCard label="Automations" icon={CalendarClock} value={formatNumber(live.length)}
              hint={`${live.filter((r) => r.KIND === 'COWORK').length} CoWork · ${live.filter((r) => r.KIND === 'COCO').length} Cortex Code · ${live.filter((r) => r.KIND === 'AGENT_SDK').length} Agent SDK`} />
            <StatCard label="Active" icon={PlayCircle} value={formatNumber(active)} hint="Schedule running" />
            <StatCard label="Paused" icon={PauseCircle} value={formatNumber(live.length - active)} hint="Suspended by owner or by Snowflake" />
            <StatCard label="Owners" icon={Users} value={formatNumber(owners)} hint="People with at least one automation" />
            <StatCard label="Runs (30 days)" icon={PlayCircle} value={formatNumber(runs30)} hint={`${formatNumber(failed30)} failed`} />
            <StatCard label="Run success (30 days)" icon={CalendarClock} value={formatPercent(runs30 ? (runs30 - failed30) / runs30 : null)} hint="Task history state" />
            <StatCard label="Credits (30 days)" icon={Coins} value={formatNumber(credits30, 3)} hint="Task compute + agent / Cortex Code usage" />
            <StatCard label="Need attention" icon={AlertTriangle} value={formatNumber(attention)} hint="Failing, flaky or auto-suspended" />
          </>
        )}
      </section>

      <RunsPerDay />

      <DataCard title={`All automations (${rows.length})`} description="Click one for its prompt, schedule and run history. Problems are listed first." query={list} contentClassName="p-0" empty="No automations found">
        {() => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automation</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Health</TableHead>
                <TableHead numeric>Runs</TableHead>
                <TableHead numeric>Success</TableHead>
                <TableHead numeric>Median run</TableHead>
                <TableHead numeric>Credits</TableHead>
                <TableHead>Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r.TASK_ID)}>
                  <TableCell className="max-w-[18rem]">
                    <Link className="block truncate font-medium hover:underline" href={withDays('/automations', days, { task: String(r.TASK_ID) })} title={String(r.TASK_NAME)}>
                      {String(r.TITLE)}
                    </Link>
                    {r.LAST_ERROR ? <span className="block truncate text-xs text-destructive">{String(r.LAST_ERROR)}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{kindLabel(r.KIND)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Link className="hover:underline" href={withDays('/users', days, { user: String(r.OWNER_USER) })}>{String(r.OWNER_USER)}</Link>
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate text-muted-foreground" title={String(r.TARGET_AGENT ?? '')}>
                    {r.TARGET_AGENT ? String(r.TARGET_AGENT).split('.').pop() : r.KIND === 'COCO' ? 'Cortex Code sandbox' : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{describeSchedule(r.SCHEDULE)}</TableCell>
                  <TableCell><HealthBadge h={r.HEALTH} /></TableCell>
                  <TableCell numeric>{formatNumber(r.RUNS)}</TableCell>
                  <TableCell numeric>{formatPercent(r.SUCCESS_RATE)}</TableCell>
                  <TableCell numeric>{formatDuration(r.P50_MS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.TOTAL_CREDITS, 3)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.LAST_RUN))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>

      <section className="grid gap-4 lg:grid-cols-2">
        <Owners />
        <Targets />
      </section>
      <RecentRuns title="Recent failures" failedOnly canView={canView} />
      <HealthLegend />
    </main>
  );
}

function RunsPerDay({ task }: { task?: string }) {
  const { days } = useFilters();
  const q = useQ('auto_daily', { days, task });
  return (
    <DataCard title="Runs per day" description="Succeeded vs failed task runs" query={q} empty="No runs in this range">
      {(rows) => {
        const byDay = new Map<string, Record<string, number | string>>();
        for (const r of rows) {
          const d = String(r.DAY).slice(0, 10);
          const o = byDay.get(d) ?? { DAY: d, Succeeded: 0, Failed: 0, Other: 0 };
          o.Succeeded = Number(o.Succeeded) + (num(r.SUCCEEDED) ?? 0);
          o.Failed = Number(o.Failed) + (num(r.FAILED) ?? 0);
          o.Other = Number(o.Other) + (num(r.OTHER) ?? 0);
          byDay.set(d, o);
        }
        const data = [...byDay.values()].sort((a, b) => String(a.DAY).localeCompare(String(b.DAY)));
        return (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="DAY" tick={CHART_THEME.tick} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={32} allowDecimals={false} tickFormatter={formatTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Succeeded" stackId="r" fill={CHART_COLORS[2]} />
                <Bar dataKey="Failed" stackId="r" fill={CHART_COLORS[3]} />
                <Bar dataKey="Other" stackId="r" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function Owners() {
  const { days, sp } = useFilters();
  const q = useQ('auto_owners', { failed: sp.get('failed') === '1' ? 1 : 0 });
  return (
    <DataCard title="By owner" description="Who is automating" query={q} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Owner</TableHead>
              <TableHead numeric>Automations</TableHead>
              <TableHead numeric>Active</TableHead>
              <TableHead numeric>Runs (30d)</TableHead>
              <TableHead numeric>Failed (30d)</TableHead>
              <TableHead numeric>Credits (30d)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.OWNER_USER)}>
                <TableCell className="font-medium"><Link className="hover:underline" href={withDays('/users', days, { user: String(r.OWNER_USER) })}>{String(r.OWNER_USER)}</Link></TableCell>
                <TableCell numeric>{formatNumber(r.AUTOMATIONS)}</TableCell>
                <TableCell numeric>{formatNumber(r.ACTIVE)}</TableCell>
                <TableCell numeric>{formatNumber(r.RUNS_30D)}</TableCell>
                <TableCell numeric>{formatNumber(r.FAILED_30D)}</TableCell>
                <TableCell numeric>{formatNumber(r.CREDITS_30D, 3)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function Targets() {
  const { days } = useFilters();
  const q = useQ('auto_agents');
  return (
    <DataCard title="By target agent" description="Which agents run on a schedule" query={q} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead numeric>Automations</TableHead>
              <TableHead numeric>Owners</TableHead>
              <TableHead numeric>Runs (30d)</TableHead>
              <TableHead numeric>Credits (30d)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const t = String(r.TARGET);
              const parts = t.split('.');
              return (
                <TableRow key={t}>
                  <TableCell className="max-w-[16rem] truncate font-medium" title={t}>
                    {parts.length === 3 ? (
                      <Link className="hover:underline" href={withDays('/agent', days, { fqn: parts.map((x) => `"${x}"`).join('.') })}>{parts[2]}</Link>
                    ) : <span className="text-muted-foreground">{t}</span>}
                  </TableCell>
                  <TableCell numeric>{formatNumber(r.AUTOMATIONS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.OWNERS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.RUNS_30D)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CREDITS_30D, 3)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function RecentRuns({ title, task, failedOnly, canView }: { title: string; task?: string; failedOnly?: boolean; canView: boolean }) {
  const { days } = useFilters();
  const q = useQ('auto_runs', { task, failed: failedOnly ? 1 : 0, limit: 100 });
  return (
    <DataCard
      title={title}
      description={failedOnly ? 'Runs that ended in FAILED, newest first' : 'Every run from task history, with attributed cost. Open the thread to read what the automation produced.'}
      query={q}
      contentClassName="p-0"
      empty={failedOnly ? 'No failed runs. ' : 'No runs recorded yet'}
    >
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scheduled</TableHead>
              {!task && <TableHead>Automation</TableHead>}
              <TableHead>State</TableHead>
              <TableHead numeric>Duration</TableHead>
              <TableHead numeric>Task credits</TableHead>
              <TableHead numeric>Agent / CoCo credits</TableHead>
              <TableHead>Output</TableHead>
              <TableHead>Query id</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.RUN_KEY)}>
                <TableCell className="whitespace-nowrap">{formatDateTime(r.SCHEDULED_TIME)}</TableCell>
                {!task && (
                  <TableCell className="max-w-[16rem] truncate">
                    <Link className="hover:underline" href={withDays('/automations', days, { task: String(r.TASK_ID) })}>{String(r.TITLE ?? r.TASK_ID)}</Link>
                  </TableCell>
                )}
                <TableCell className="max-w-[20rem]">
                  <Badge variant={r.STATE === 'SUCCEEDED' ? 'success' : String(r.STATE).startsWith('FAILED') ? 'destructive' : 'secondary'}>{String(r.STATE)}</Badge>
                  {r.ERROR_MESSAGE ? <span className="mt-1 block truncate text-xs text-destructive" title={String(r.ERROR_MESSAGE)}>{String(r.ERROR_CODE ?? '')} {String(r.ERROR_MESSAGE)}</span> : null}
                </TableCell>
                <TableCell numeric>{formatDuration(r.DURATION_MS)}</TableCell>
                <TableCell numeric>{formatNumber(r.TASK_CREDITS, 4)}</TableCell>
                <TableCell numeric>{formatNumber(num(r.AGENT_CREDITS) ?? num(r.CODE_CREDITS), 4)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.THREAD_ID ? (
                    canView ? <Link className="underline" href={withDays('/thread', days, { id: String(r.THREAD_ID) })}>thread</Link> : <Hidden label="thread" />
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground" title={String(r.QUERY_ID ?? '')}>{String(r.QUERY_ID ?? '—')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function HealthLegend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {Object.entries(HEALTH).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5"><HealthBadge h={k} /> {v.help}</span>
      ))}
    </p>
  );
}

function AutomationDetail({ task }: { task: string }) {
  const { set, days } = useFilters();
  const me = useQ('whoami');
  const canView = bool(me.data?.[0]?.CAN_VIEW_CONTENT);
  const q = useQ('auto_detail', { task });
  const r = q.data?.[0] ?? {};
  const target = r.TARGET_AGENT ? String(r.TARGET_AGENT) : null;
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <button type="button" onClick={() => set({ task: null })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All automations
      </button>
      <PageHeader
        eyebrow={`${kindLabel(r.KIND)} automation`}
        title={q.isPending ? 'Loading…' : String(r.TITLE ?? task)}
        description={r.OWNER_USER ? `Owned by ${String(r.OWNER_USER)} · ${describeSchedule(r.SCHEDULE)} · created ${formatRelative(utc(r.CREATED))}` : undefined}
        actions={<TimeRange />}
      />
      {r.TASK_ID ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <HealthBadge h={r.HEALTH} />
            <Badge variant="secondary">{String(r.STATE)}</Badge>
            {r.LAST_SUSPENDED_REASON ? <Badge variant="secondary">suspended: {String(r.LAST_SUSPENDED_REASON)}</Badge> : null}
            <span className="font-mono text-muted-foreground">{`${String(r.TASK_DATABASE)}.${String(r.TASK_SCHEMA)}.${String(r.TASK_NAME)}`}</span>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Runs" icon={PlayCircle} value={formatNumber(r.RUNS)} hint={`${formatNumber(r.FAILED)} failed · ${formatNumber(r.RUNS_30D)} in 30 days`} />
            <StatCard label="Success rate" icon={CalendarClock} value={formatPercent(r.SUCCESS_RATE)} hint={r.LAST_FAILURE ? `last failure ${formatRelative(utc(r.LAST_FAILURE))}` : 'No failures recorded'} />
            <StatCard label="Median run time" icon={CalendarClock} value={formatDuration(r.P50_MS)} hint={`longest ${formatDuration(r.MAX_MS)}`} />
            <StatCard label="Credits" icon={Coins} value={formatNumber(r.TOTAL_CREDITS, 3)}
              hint={`task ${formatNumber(r.TASK_CREDITS ?? 0, 3)} · agent ${formatNumber(r.AGENT_CREDITS ?? 0, 3)} · CoCo ${formatNumber(r.CODE_CREDITS ?? 0, 3)}`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 rounded-xl border bg-card p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold">What it does</h3>
              {canView ? (
                <p className="whitespace-pre-wrap text-sm">{String(r.PROMPT_TEXT ?? r.PROMPT ?? '—')}</p>
              ) : <Hidden label="Prompt needs AGENT_OBS_CONTENT_ROLE" />}
            </div>
            <dl className="grid grid-cols-[8rem_1fr] content-start gap-x-3 gap-y-2 rounded-xl border bg-card p-5 text-sm">
              <dt className="text-muted-foreground">Schedule</dt><dd>{describeSchedule(r.SCHEDULE)}</dd>
              <dt className="text-muted-foreground">Cron</dt><dd className="font-mono text-xs">{String(r.SCHEDULE ?? '—')}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd>{target ? (
                <Link className="hover:underline" href={withDays('/agent', days, { fqn: target.split('.').map((x) => `"${x}"`).join('.') })}>{target}</Link>
              ) : r.KIND === 'COCO' ? 'Cortex Code sandbox session' : '—'}</dd>
              <dt className="text-muted-foreground">Owner</dt>
              <dd><Link className="hover:underline" href={withDays('/users', days, { user: String(r.OWNER_USER) })}>{String(r.OWNER_USER)}</Link></dd>
              <dt className="text-muted-foreground">Last run</dt><dd>{formatDateTime(r.LAST_RUN)} ({String(r.LAST_STATE ?? '—')})</dd>
              <dt className="text-muted-foreground">Last changed</dt><dd>{formatDateTime(r.LAST_ALTERED)}</dd>
              {bool(r.IS_DELETED) && <><dt className="text-muted-foreground">Deleted</dt><dd>{formatDateTime(r.DELETED)}</dd></>}
            </dl>
          </section>

          {r.LAST_ERROR ? (
            <div className={cn('rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm')}>
              <p className="font-medium text-destructive">Last error</p>
              <p className="mt-1 font-mono text-xs">{String(r.LAST_ERROR)}</p>
            </div>
          ) : null}

          <RunsPerDay task={task} />
          <RecentRuns title="Run history" task={task} canView={canView} />
        </>
      ) : !q.isPending ? <p className="text-sm text-muted-foreground">Automation not found.</p> : null}
    </main>
  );
}
