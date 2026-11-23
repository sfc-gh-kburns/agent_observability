'use client';

import { CHART_COLORS, CHART_THEME, ChartTooltip, formatTick } from '@/components/chart-utils';
import { AgentFilter, DataCard, Hidden, Sparkline, TimeRange } from '@/components/obs/common';
import { PageHeader } from '@/components/page-header';
import { StatCard, StatCardSkeleton } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDuration, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { arr, bool, num, useFilters, useQ, withDays, type Row } from '@/lib/use-q';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowLeft, Coins, FileBarChart, MessageSquareText, ThumbsDown, ThumbsUp, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const INTENT_LABEL: Record<string, string> = {
  metric_lookup: 'Metric lookup', breakdown: 'Breakdown', ranking: 'Ranking / top N', trend: 'Trend over time',
  comparison: 'Comparison', diagnostic: 'Why / diagnostic', forecast_whatif: 'Forecast / what-if',
  entity_lookup: 'Record lookup', list_records: 'List records', definition_help: 'Definition / how-to',
  data_discovery: 'What can I ask?', report_build: 'Build report / chart', document_qa: 'Documents',
  action_request: 'Action request', followup_refinement: 'Follow-up', problem_report: 'Problem report',
  system_generated: 'System generated', test_noise: 'Test', other: 'Other',
};
const intentLabel = (v: unknown) => INTENT_LABEL[String(v)] ?? String(v ?? '—');
const utc = (v: unknown) => (v ? `${String(v).replace('Z', '')}Z` : null);

/** People vs app/service accounts toggle, kept in the URL like the other filters. */
function KindToggle() {
  const { sp, set } = useFilters();
  const kind = sp.get('kind') === 'all' ? 'all' : 'person';
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Accounts">
      {[['person', 'People'], ['all', 'Incl. apps & services']].map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => set({ kind: k === 'person' ? null : k })}
          className={cn('rounded-md px-2.5 py-1 text-xs font-medium',
            kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function useEuFilters() {
  const { days, agent, sp } = useFilters();
  const kind = sp.get('kind') === 'all' ? 'all' : 'person';
  return { days, agent, kind, user: sp.get('user') };
}

export function EndUsersView() {
  const { user } = useEuFilters();
  return user ? <UserProfile user={user} /> : <Overview />;
}

// ============================================================ Overview
function Overview() {
  const { days, agent, kind } = useEuFilters();
  const p = { days, agent, kind };
  const me = useQ('whoami');
  const canView = bool(me.data?.[0]?.CAN_VIEW_CONTENT);
  const summary = useQ('eu_summary', p);
  const users = useQ('eu_users', p);
  const cur = summary.data?.find((r) => r.PERIOD === 'cur') ?? {};
  const prev = summary.data?.find((r) => r.PERIOD === 'prev') ?? {};
  const list = users.data ?? [];
  const returning = (num(cur.USERS) ?? 0) - (num(cur.NEW_USERS) ?? 0);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="End users"
        title="End user insights"
        description="Who uses your agents, what they ask, what it costs, where they get stuck and what to build for them. Click any user for their full profile."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <KindToggle />
            <AgentFilter />
            <TimeRange />
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.isPending ? (
          Array.from({ length: 8 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Active users" icon={Users} value={formatNumber(cur.USERS ?? 0)} hint={<DeltaText cur={num(cur.USERS)} prev={num(prev.USERS)} />} />
            <StatCard label="New users" icon={UserPlus} value={formatNumber(cur.NEW_USERS ?? 0)} hint={`${formatNumber(Math.max(returning, 0))} returning`} />
            <StatCard label="Questions" icon={MessageSquareText} value={formatNumber(cur.TURNS ?? 0)}
              hint={`${formatNumber(num(cur.USERS) ? (num(cur.TURNS) ?? 0) / (num(cur.USERS) ?? 1) : null, 1)} per user · ${formatNumber(cur.THREADS ?? 0)} conversations`} />
            <StatCard label="AI credits" icon={Coins} value={formatNumber(cur.CREDITS ?? 0, 2)}
              hint={`${formatNumber(num(cur.USERS) ? (num(cur.CREDITS) ?? 0) / (num(cur.USERS) ?? 1) : null, 2)} per user`} />
            <StatCard label="Questions with issues" icon={AlertTriangle} value={formatNumber(cur.ISSUES ?? 0)}
              hint={`${formatPercent(num(cur.TURNS) ? (num(cur.ISSUES) ?? 0) / (num(cur.TURNS) ?? 1) : null)} of questions · ${formatNumber(cur.USERS_WITH_ISSUES ?? 0)} users affected`} />
            <StatCard label="Positive feedback" icon={ThumbsUp} value={formatNumber(cur.FEEDBACK_POSITIVE ?? 0)} hint="Thumbs up in range" />
            <StatCard label="Negative feedback" icon={ThumbsDown} value={formatNumber(cur.FEEDBACK_NEGATIVE ?? 0)} hint="Thumbs down in range" />
            <StatCard label="Dashboard opportunities" icon={FileBarChart} value={<DashboardOppCount />} hint="People re-asking the same question on several days" />
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WeeklyActive className="lg:col-span-2" />
        <Segments rows={list} isPending={users.isPending} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TopUsersByCredits query={users} />
        <IssueReasons />
      </section>

      <DashboardOpportunities canView={canView} />
      <UsersTable query={users} canView={canView} />
      <section className="grid gap-4 lg:grid-cols-2">
        <RecentIssues canView={canView} />
        <Feedback canView={canView} />
      </section>
    </main>
  );
}

function DeltaText({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || !prev) return <span>vs prior: —</span>;
  const pct = (cur - prev) / prev;
  return <span className={cn(pct > 0 ? 'text-success' : pct < 0 ? 'text-destructive' : '')}>{pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {Math.abs(pct * 100).toFixed(0)}% vs prior period</span>;
}

function DashboardOppCount() {
  const { days, agent, kind } = useEuFilters();
  const q = useQ('eu_dashboard_opps', { days, agent, kind });
  return <>{q.isPending ? '…' : formatNumber(q.data?.length ?? 0)}</>;
}

function WeeklyActive({ className }: { className?: string }) {
  const { days, agent, kind } = useEuFilters();
  const q = useQ('eu_weekly', { days, agent, kind });
  return (
    <DataCard title="Active users per week" description="New vs returning users (bars) and questions asked (line)" query={q} className={className}>
      {(rows) => {
        const data = rows.map((r) => ({
          DAY: String(r.DAY).slice(0, 10), New: num(r.NEW_USERS) ?? 0, Returning: num(r.RETURNING_USERS) ?? 0, Questions: num(r.TURNS) ?? 0,
        }));
        return (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="DAY" tick={CHART_THEME.tick} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="u" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <YAxis yAxisId="q" orientation="right" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={40} tickFormatter={formatTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="u" dataKey="Returning" stackId="u" fill={CHART_COLORS[0]} />
                <Bar yAxisId="u" dataKey="New" stackId="u" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
                <Line yAxisId="q" dataKey="Questions" type="monotone" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

const SEGMENTS: { flag: string; label: string; tone: 'success' | 'warning' | 'destructive' | 'secondary'; help: string }[] = [
  { flag: 'FLAG_POWER', label: 'Power users', tone: 'success', help: '20+ questions on 5+ days' },
  { flag: 'FLAG_NEW', label: 'New this period', tone: 'secondary', help: 'First question in the selected range' },
  { flag: 'FLAG_STRUGGLING', label: 'Struggling', tone: 'destructive', help: '2+ issues and 20%+ of questions with issues, or negative feedback' },
  { flag: 'FLAG_NEEDS_ONBOARDING', label: 'Need onboarding', tone: 'warning', help: '30%+ of questions are "what can I ask?" or definitions' },
  { flag: 'FLAG_DORMANT', label: 'Gone quiet', tone: 'secondary', help: 'No questions in the last 14 days' },
];

function Segments({ rows, isPending }: { rows: Row[]; isPending: boolean }) {
  const { days, agent, kind } = useEuFilters();
  const q = { data: rows, error: null, isPending };
  return (
    <DataCard title="User segments" description="Who to celebrate, help or check in with" query={q}>
      {() => (
        <ul className="space-y-3">
          {SEGMENTS.map((s) => {
            const members = rows.filter((r) => bool(r[s.flag]));
            return (
              <li key={s.flag} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Badge variant={s.tone}>{s.label}</Badge>
                  </span>
                  <span className="text-sm font-medium tabular-nums">{members.length}</span>
                </div>
                <p className="text-xs text-muted-foreground">{s.help}</p>
                {members.length > 0 && (
                  <p className="truncate text-xs">
                    {members.slice(0, 6).map((m, i) => (
                      <span key={String(m.USER_NAME)}>
                        {i > 0 && ', '}
                        <UserLink name={String(m.USER_NAME)} days={days} agent={agent} kind={kind} />
                      </span>
                    ))}
                    {members.length > 6 && ` +${members.length - 6}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </DataCard>
  );
}

function UserLink({ name, days, agent, kind, className }: { name: string; days: number; agent: string | null; kind: string; className?: string }) {
  const extra: Record<string, string> = { user: name };
  if (agent) extra.agent = agent;
  if (kind === 'all') extra.kind = 'all';
  return <Link href={withDays('/users', days, extra)} className={cn('hover:underline', className)}>{name}</Link>;
}

function TopUsersByCredits({ query }: { query: { data?: Row[]; error: Error | null; isPending: boolean } }) {
  return (
    <DataCard title="Top users by AI credits" description="Where the spend goes" query={query}>
      {(rows) => {
        const data = [...rows].sort((a, b) => (num(b.CREDITS) ?? 0) - (num(a.CREDITS) ?? 0)).slice(0, 10)
          .map((r) => ({ name: String(r.USER_NAME), Credits: Number((num(r.CREDITS) ?? 0).toFixed(3)) }));
        return (
          <div style={{ height: Math.max(180, data.length * 28) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={CHART_THEME.grid} horizontal={false} />
                <XAxis type="number" tick={CHART_THEME.tick} axisLine={false} tickLine={false} tickFormatter={formatTick} />
                <YAxis type="category" dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={160} interval={0} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Credits" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function IssueReasons() {
  const { days, agent, kind } = useEuFilters();
  const q = useQ('eu_issue_reasons', { days, agent, kind });
  return (
    <DataCard title="Where users get stuck" description="Questions with an issue, by reason" query={q} empty="No issues in this range">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reason</TableHead>
              <TableHead numeric>Questions</TableHead>
              <TableHead numeric>Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.ISSUE_REASON)}>
                <TableCell className="font-medium">{String(r.ISSUE_REASON)}</TableCell>
                <TableCell numeric>{formatNumber(r.TURNS)}</TableCell>
                <TableCell numeric>{formatNumber(r.USERS)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function themeCell(r: Row, canView: boolean) {
  if (r.THEME_LABEL) return String(r.THEME_LABEL);
  return canView ? intentLabel(r.INTENT) : <Hidden label={intentLabel(r.INTENT)} />;
}

function DashboardOpportunities({ canView, user }: { canView: boolean; user?: string }) {
  const { days, agent, kind } = useEuFilters();
  const q = useQ('eu_dashboard_opps', { days, agent, kind, user });
  return (
    <DataCard
      title="Dashboard opportunities"
      description="The same person asked the same kind of question on several days. A saved dashboard or scheduled report would answer it instantly, without the agent cost."
      query={q}
      contentClassName="p-0"
      empty="No repeated questions from the same person in this range"
    >
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              {!user && <TableHead>User</TableHead>}
              <TableHead>Recurring question</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Type</TableHead>
              <TableHead numeric>Times asked</TableHead>
              <TableHead numeric>Days</TableHead>
              <TableHead numeric>Weeks</TableHead>
              <TableHead numeric>Credits spent</TableHead>
              <TableHead numeric>Median wait</TableHead>
              <TableHead>Last asked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.USER_NAME}|${r.AGENT_KEY}|${r.THEME_ID}`}>
                {!user && (
                  <TableCell className="font-medium"><UserLink name={String(r.USER_NAME)} days={days} agent={agent} kind={kind} /></TableCell>
                )}
                <TableCell className="max-w-[22rem] truncate">
                  {r.LAST_THREAD_ID ? (
                    <Link className="hover:underline" href={withDays('/thread', days, { id: String(r.LAST_THREAD_ID) })}>{themeCell(r, canView)}</Link>
                  ) : themeCell(r, canView)}
                </TableCell>
                <TableCell className="max-w-[10rem] truncate text-muted-foreground">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_KEY)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{intentLabel(r.INTENT)}</TableCell>
                <TableCell numeric>{formatNumber(r.ASKS)}</TableCell>
                <TableCell numeric>{formatNumber(r.DAYS_ASKED)}</TableCell>
                <TableCell numeric>{formatNumber(r.WEEKS_ASKED)}</TableCell>
                <TableCell numeric>{formatNumber(r.CREDITS, 3)}</TableCell>
                <TableCell numeric>{formatDuration(r.P50_MS)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.LAST_ASKED_UTC))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function UserFlags({ r }: { r: Row }) {
  return (
    <>
      {SEGMENTS.filter((s) => bool(r[s.flag])).map((s) => (
        <Badge key={s.flag} variant={s.tone} className="whitespace-nowrap">{s.label.replace(' this period', '')}</Badge>
      ))}
      {r.ACCOUNT_KIND && r.ACCOUNT_KIND !== 'person' && <Badge variant="secondary">{String(r.ACCOUNT_KIND)}</Badge>}
    </>
  );
}

function UsersTable({ query, canView }: { query: { data?: Row[]; error: Error | null; isPending: boolean }; canView: boolean }) {
  const { days, agent, kind } = useEuFilters();
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (query.data ?? []).filter((r) => !f || [r.USER_NAME, r.DISPLAY_NAME, r.TOP_AGENT].some((v) => String(v ?? '').toLowerCase().includes(f)));
  }, [query.data, filter]);
  return (
    <DataCard
      title={`All users (${rows.length})`}
      description="Click a name for the full profile"
      query={query}
      contentClassName="p-0"
      actions={<input aria-label="Filter users" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-40 rounded-lg border bg-card px-2 text-xs" />}
    >
      {() => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead numeric>Questions</TableHead>
              <TableHead numeric>Active days</TableHead>
              <TableHead numeric>Agents</TableHead>
              <TableHead>Most used agent</TableHead>
              <TableHead>Asks most about</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead numeric>Issue rate</TableHead>
              <TableHead numeric>Feedback +/−</TableHead>
              <TableHead>Weekly</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Segments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.USER_NAME)}>
                <TableCell className="font-medium"><UserLink name={String(r.USER_NAME)} days={days} agent={agent} kind={kind} /></TableCell>
                <TableCell numeric>{formatNumber(r.TURNS)}</TableCell>
                <TableCell numeric>{formatNumber(r.ACTIVE_DAYS)}</TableCell>
                <TableCell numeric>{formatNumber(r.AGENTS)}</TableCell>
                <TableCell className="max-w-[10rem] truncate text-muted-foreground">{String(r.TOP_AGENT ?? '—')}</TableCell>
                <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                  {r.TOP_THEME ? String(r.TOP_THEME) : r.TOP_THEME_INTENT ? (canView ? intentLabel(r.TOP_THEME_INTENT) : <Hidden label={intentLabel(r.TOP_THEME_INTENT)} />) : '—'}
                </TableCell>
                <TableCell numeric>{formatNumber(r.CREDITS, 2)}</TableCell>
                <TableCell numeric>{formatPercent(r.ISSUE_RATE)}</TableCell>
                <TableCell numeric>{formatNumber(r.FEEDBACK_POSITIVE ?? 0)} / {formatNumber(r.FEEDBACK_NEGATIVE ?? 0)}</TableCell>
                <TableCell><Sparkline points={arr(r.SPARK).map((x) => Number(x) || 0)} /></TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.LAST_SEEN_UTC))}</TableCell>
                <TableCell className="space-x-1 whitespace-nowrap"><UserFlags r={r} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function RecentIssues({ canView, user }: { canView: boolean; user?: string }) {
  const { days, agent, kind } = useEuFilters();
  const q = useQ('eu_issues', { days, agent, kind, user });
  return (
    <DataCard title="Recent issues" description="Questions that errored, failed or were reported as a problem" query={q} contentClassName="p-0" empty="No issues in this range">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              {!user && <TableHead>User</TableHead>}
              <TableHead>Question</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 25).map((r) => (
              <TableRow key={String(r.TURN_ID)}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.START_TIME_UTC))}</TableCell>
                {!user && <TableCell className="whitespace-nowrap"><UserLink name={String(r.USER_NAME)} days={days} agent={agent} kind={kind} /></TableCell>}
                <TableCell className="max-w-[20rem] truncate">
                  <Link className="hover:underline" href={withDays('/thread', days, { id: String(r.THREAD_ID), turn: String(r.TURN_ID) })}>
                    {canView ? String(r.QUESTION ?? r.THEME_LABEL ?? 'Open thread') : <Hidden />}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_KEY)}</span>
                </TableCell>
                <TableCell><Badge variant={String(r.ISSUE_REASON).startsWith('SQL error') ? 'warning' : 'destructive'} className="whitespace-nowrap">{String(r.ISSUE_REASON)}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function Feedback({ canView, user }: { canView: boolean; user?: string }) {
  const { days, agent } = useEuFilters();
  const q = useQ('eu_feedback', { days, agent, user });
  return (
    <DataCard
      title="User feedback"
      description="Thumbs up / down and comments left on answers"
      query={q}
      contentClassName="p-0"
      empty="No feedback in this range. Users can rate answers in CoWork and in apps built on the agent API."
    >
      {(rows) => (
        <ul className="divide-y">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3 p-3 text-sm">
              {bool(r.IS_POSITIVE) ? <ThumbsUp className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <ThumbsDown className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0 space-y-1">
                <p>{canView ? (r.FEEDBACK_TEXT ? `“${String(r.FEEDBACK_TEXT)}”` : <span className="text-muted-foreground">No comment</span>) : <Hidden />}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {String(r.USER_NAME ?? '—')} · {String(r.AGENT_DISPLAY_NAME ?? '')} · {formatRelative(utc(r.FEEDBACK_TS_UTC))}
                  {r.THREAD_ID ? <> · <Link className="underline" href={withDays('/thread', days, { id: String(r.THREAD_ID) })}>thread</Link></> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DataCard>
  );
}

// ============================================================ User profile (drill-down)
function UserProfile({ user }: { user: string }) {
  const { days, agent, kind } = useEuFilters();
  const { set } = useFilters();
  const me = useQ('whoami');
  const canView = bool(me.data?.[0]?.CAN_VIEW_CONTENT);
  // Profile ignores the people/service toggle so any account can be opened.
  const prof = useQ('eu_users', { days, agent, kind: 'all', user });
  const r = prof.data?.[0] ?? {};

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <button type="button" onClick={() => set({ user: null })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All users
      </button>
      <PageHeader
        eyebrow="End user"
        title={user}
        description={prof.isPending ? 'Loading…' : r.FIRST_SEEN_UTC
          ? `${String(r.ACCOUNT_KIND ?? 'person')} account · first question ${formatRelative(utc(r.FIRST_SEEN_UTC))} · last seen ${formatRelative(utc(r.LAST_SEEN_UTC))}`
          : 'No activity in this range'}
        actions={<div className="flex flex-wrap items-center gap-2"><AgentFilter /><TimeRange /></div>}
      />
      <div className="flex flex-wrap gap-1"><UserFlags r={r} /></div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {prof.isPending ? Array.from({ length: 4 }, (_, i) => <StatCardSkeleton key={i} />) : (
          <>
            <StatCard label="Questions" icon={MessageSquareText} value={formatNumber(r.TURNS ?? 0)} hint={`${formatNumber(r.THREADS ?? 0)} conversations on ${formatNumber(r.ACTIVE_DAYS ?? 0)} days`} />
            <StatCard label="AI credits" icon={Coins} value={formatNumber(r.CREDITS ?? 0, 2)} hint={`${formatNumber(r.CREDITS_PER_TURN, 3)} per question`} />
            <StatCard label="Issue rate" icon={AlertTriangle} value={formatPercent(r.ISSUE_RATE)} hint={`${formatNumber(r.ISSUES ?? 0)} questions with issues`} />
            <StatCard label="Feedback" icon={ThumbsUp} value={`${formatNumber(r.FEEDBACK_POSITIVE ?? 0)} / ${formatNumber(r.FEEDBACK_NEGATIVE ?? 0)}`} hint={`Positive / negative · median wait ${formatDuration(r.P50_MS)}`} />
          </>
        )}
      </section>

      <UserDaily user={user} />
      <section className="grid gap-4 lg:grid-cols-3">
        <UserAgents user={user} className="lg:col-span-2" />
        <UserIntents user={user} />
      </section>
      <UserThemes user={user} canView={canView} />
      <DashboardOpportunities canView={canView} user={user} />
      <section className="grid gap-4 lg:grid-cols-2">
        <RecentIssues canView={canView} user={user} />
        <Feedback canView={canView} user={user} />
      </section>
      <UserTurns user={user} canView={canView} />
    </main>
  );
}

function UserDaily({ user }: { user: string }) {
  const { days } = useEuFilters();
  const q = useQ('eu_user_daily', { days, user });
  return (
    <DataCard title="Activity" description="Questions per day (bars) and credits (line)" query={q}>
      {(rows) => {
        const data = rows.map((r) => ({ DAY: String(r.DAY).slice(0, 10), Questions: num(r.TURNS) ?? 0, Issues: num(r.ISSUES) ?? 0, Credits: Number((num(r.CREDITS) ?? 0).toFixed(3)) }));
        return (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="DAY" tick={CHART_THEME.tick} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="q" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <YAxis yAxisId="c" orientation="right" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={40} tickFormatter={formatTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="q" dataKey="Questions" stackId="q" fill={CHART_COLORS[0]} />
                <Bar yAxisId="q" dataKey="Issues" fill={CHART_COLORS[3]} />
                <Line yAxisId="c" dataKey="Credits" type="monotone" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function UserAgents({ user, className }: { user: string; className?: string }) {
  const { days } = useEuFilters();
  const q = useQ('eu_user_agents', { days, user });
  return (
    <DataCard title="Agents used" query={q} className={className} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead numeric>Questions</TableHead>
              <TableHead numeric>Conversations</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead numeric>Issues</TableHead>
              <TableHead>Last used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const key = String(r.AGENT_KEY);
              return (
                <TableRow key={key}>
                  <TableCell className="max-w-[16rem] truncate font-medium">
                    {key.startsWith('(') ? <span className="text-muted-foreground">{key}</span> : (
                      <Link className="hover:underline" href={withDays('/agent', days, { fqn: key })}>{String(r.AGENT_DISPLAY_NAME ?? key)}</Link>
                    )}
                  </TableCell>
                  <TableCell numeric>{formatNumber(r.TURNS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.THREADS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CREDITS, 3)}</TableCell>
                  <TableCell numeric>{formatNumber(r.ISSUES)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.LAST_USED_UTC))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function UserIntents({ user }: { user: string }) {
  const { days } = useEuFilters();
  const q = useQ('eu_user_intents', { days, user });
  return (
    <DataCard title="Kinds of questions" query={q}>
      {(rows) => {
        const data = rows.map((r) => ({ name: intentLabel(r.INTENT), Asks: num(r.ASKS) ?? 0 }));
        return (
          <div style={{ height: Math.max(180, data.length * 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={CHART_THEME.grid} horizontal={false} />
                <XAxis type="number" tick={CHART_THEME.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={130} interval={0} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Asks" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function UserThemes({ user, canView }: { user: string; canView: boolean }) {
  const { days } = useEuFilters();
  const q = useQ('eu_user_themes', { days, user });
  return (
    <DataCard title="What they ask about" description="Question themes, most asked first" query={q} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Theme</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Type</TableHead>
              <TableHead numeric>Times asked</TableHead>
              <TableHead numeric>Days</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead numeric>Issues</TableHead>
              <TableHead>Last asked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.AGENT_KEY}|${r.THEME_ID}`}>
                <TableCell className="max-w-[24rem] truncate font-medium">{themeCell(r, canView)}</TableCell>
                <TableCell className="max-w-[10rem] truncate text-muted-foreground">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_KEY)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{intentLabel(r.INTENT)}</TableCell>
                <TableCell numeric>{formatNumber(r.ASKS)}</TableCell>
                <TableCell numeric>{formatNumber(r.DAYS_ASKED)}</TableCell>
                <TableCell numeric>{formatNumber(r.CREDITS, 3)}</TableCell>
                <TableCell numeric>{formatNumber(r.ISSUES)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.LAST_ASKED_UTC))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function UserTurns({ user, canView }: { user: string; canView: boolean }) {
  const { days } = useEuFilters();
  const q = useQ('eu_user_turns', { days, user });
  return (
    <DataCard title="Recent questions" description="Latest 50; open any to see the full conversation and trace" query={q} contentClassName="p-0">
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead numeric>Wait</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.TURN_ID)}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(utc(r.START_TIME_UTC))}</TableCell>
                <TableCell className="max-w-[26rem] truncate">
                  <Link className="hover:underline" href={withDays('/thread', days, { id: String(r.THREAD_ID), turn: String(r.TURN_ID) })}>
                    {canView ? String(r.QUESTION ?? '—') : <Hidden label={intentLabel(r.INTENT)} />}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[10rem] truncate text-muted-foreground">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_KEY)}</TableCell>
                <TableCell numeric>{formatNumber(r.COMBINED_CREDITS, 3)}</TableCell>
                <TableCell numeric>{formatDuration(r.DURATION_MS)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.ISSUE_REASON ? <Badge variant="warning">{String(r.ISSUE_REASON)}</Badge>
                    : num(r.FEEDBACK_POSITIVE) ? <Badge variant="success">liked</Badge>
                    : <span className="text-xs text-muted-foreground">ok</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}
