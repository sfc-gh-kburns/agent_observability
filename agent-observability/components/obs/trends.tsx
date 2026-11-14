'use client';

import { CHART_COLORS, CHART_THEME, ChartTooltip, formatTick } from '@/components/chart-utils';
import { AgentFilter, DataCard, Hidden, Sparkline, TimeRange } from '@/components/obs/common';
import { PageHeader } from '@/components/page-header';
import { StatCard, StatCardSkeleton } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDuration, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { arr, bool, num, useFilters, useQ, withDays, type Row } from '@/lib/use-q';
import { cn } from '@/lib/utils';
import { BookOpen, Check, ClipboardCopy, FileBarChart, HelpCircle, Layers, MessageSquareText, Repeat, TrendingUp, Users, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const INTENT_LABEL: Record<string, string> = {
  metric_lookup: 'Metric lookup', breakdown: 'Breakdown', ranking: 'Ranking / top N', trend: 'Trend over time',
  comparison: 'Comparison', diagnostic: 'Why / diagnostic', forecast_whatif: 'Forecast / what-if',
  entity_lookup: 'Record lookup', list_records: 'List records', definition_help: 'Definition / how-to',
  data_discovery: 'What can I ask?', report_build: 'Build report / chart', document_qa: 'Documents',
  action_request: 'Action request', followup_refinement: 'Follow-up', problem_report: 'Problem report', other: 'Other',
};
const intentLabel = (v: unknown) => INTENT_LABEL[String(v)] ?? String(v ?? '—');
const domainLabel = (v: unknown) => String(v ?? 'other').replaceAll('_', ' ');

type Tab = 'vqr' | 'report' | 'gap' | 'onboarding' | 'rising';
const TABS: { id: Tab; flag: string; label: string; icon: typeof Wrench; action: string; rule: string }[] = [
  { id: 'vqr', flag: 'FLAG_VQR', label: 'Add verified queries', icon: Check,
    action: 'Add a verified query to the semantic view so these answers are fast and consistent.',
    rule: 'Asked 3+ times, answered with SQL, verified query used in under half of them.' },
  { id: 'report', flag: 'FLAG_REPORT', label: 'Build reports', icon: FileBarChart,
    action: 'Recurring metric questions: a scheduled report or dashboard would answer them without a chat.',
    rule: 'Asked 3+ times across 2+ weeks, or 3+ times by the same person, for a metric, breakdown, ranking, trend or comparison.' },
  { id: 'gap', flag: 'FLAG_GAP', label: 'Fix gaps', icon: Wrench,
    action: 'Users are not getting good answers: check the semantic model, instructions or data coverage.',
    rule: 'Problem reports, or asked 2+ times with success under 80%, SQL errors over 25%, or negative feedback.' },
  { id: 'onboarding', flag: 'FLAG_ONBOARDING', label: 'Help users', icon: BookOpen,
    action: 'Users are asking what they can ask or what terms mean: add sample questions, descriptions or a glossary.',
    rule: 'Asked 2+ times with a "what can I ask" or definition / how-to intent.' },
  { id: 'rising', flag: 'FLAG_RISING', label: 'Rising', icon: TrendingUp,
    action: 'New or growing demand worth watching.',
    rule: 'Asked 3+ times in the last 7 days and at least double the 7 days before.' },
];

export function TrendsView() {
  const { days, agent } = useFilters();
  const p = { days, agent };
  const me = useQ('whoami');
  const canView = bool(me.data?.[0]?.CAN_VIEW_CONTENT);
  const summary = useQ('trend_summary', p);
  const themes = useQ('trend_themes', p);
  const [selected, setSelected] = useState<Row | null>(null);

  const s = summary.data?.[0] ?? {};
  const rows = themes.data ?? [];
  const repeatAsks = rows.filter((r) => (num(r.ASKS) ?? 0) >= 2).reduce((a, r) => a + (num(r.ASKS) ?? 0), 0);
  const totalAsks = rows.reduce((a, r) => a + (num(r.ASKS) ?? 0), 0);
  const count = (flag: string) => rows.filter((r) => bool(r[flag])).length;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="Insights"
        title="Conversation trends"
        description="What people ask each agent, grouped into themes, with the outcome of each so you can decide what to build next."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentFilter />
            <TimeRange />
          </div>
        }
      />
      <p className="text-xs text-muted-foreground">
        Questions are classified once with AI_COMPLETE ({String(s.MODEL ?? '…')}) and grouped into themes by embedding similarity.
        {' '}{formatNumber(s.CLASSIFIED)} distinct questions classified · last run {formatRelative(s.LAST_CLASSIFIED_AT)}.
        {' '}System-generated and test prompts ({formatNumber(s.NOISE ?? 0)} in range) are excluded.
        {!canView && ' Theme labels and question text need AGENT_OBS_CONTENT_ROLE; intent and domain are shown instead.'}
      </p>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.isPending || themes.isPending ? (
          Array.from({ length: 8 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Questions asked" icon={MessageSquareText} value={formatNumber(s.QUESTIONS)} hint={`${formatNumber(s.FOLLOWUPS ?? 0)} follow-ups`} />
            <StatCard label="Distinct themes" icon={Layers} value={formatNumber(s.THEMES)} hint={`${formatNumber(s.ASKERS)} people asking`} />
            <StatCard label="Repeat demand" icon={Repeat} value={formatPercent(totalAsks ? repeatAsks / totalAsks : null)} hint="Share of questions in themes asked 2+ times" />
            <StatCard label="Answer success" icon={Users} value={formatPercent(s.SUCCESS_RATE)} hint="Turns completed without an unrecovered error" />
            <StatCard label="Verified query candidates" icon={Check} value={formatNumber(count('FLAG_VQR'))} hint="Frequent SQL answers without a verified query" />
            <StatCard label="Report candidates" icon={FileBarChart} value={formatNumber(count('FLAG_REPORT'))} hint="Recurring metric questions" />
            <StatCard label="Gaps" icon={Wrench} value={formatNumber(count('FLAG_GAP'))} hint="Failing, erroring or disliked answers" />
            <StatCard label="Onboarding signals" icon={HelpCircle} value={formatNumber(count('FLAG_ONBOARDING'))} hint="“What can I ask?” and definitions" />
          </>
        )}
      </section>

      <Opportunities query={themes} canView={canView} onSelect={setSelected} />

      <section className="grid gap-4 lg:grid-cols-3">
        <IntentMix className="lg:col-span-2" />
        <DomainMix />
      </section>
      <IntentTrend />
      <Terms />
      <ThemeTable query={themes} canView={canView} onSelect={setSelected} />

      <ThemeSheet theme={selected} canView={canView} onClose={() => setSelected(null)} />
    </main>
  );
}

function themeTitle(r: Row, canView: boolean) {
  if (r.THEME_LABEL) return <span>{String(r.THEME_LABEL)}</span>;
  return canView ? <span>{intentLabel(r.INTENT)}</span> : <Hidden label={`${intentLabel(r.INTENT)} · ${domainLabel(r.DOMAIN)}`} />;
}

function Opportunities({ query, canView, onSelect }: { query: { data?: Row[]; error: Error | null; isPending: boolean }; canView: boolean; onSelect: (r: Row) => void }) {
  const [tab, setTab] = useState<Tab>('vqr');
  const t = TABS.find((x) => x.id === tab)!;
  const items = (query.data ?? []).filter((r) => bool(r[t.flag])).slice(0, 15);
  return (
    <DataCard title="Opportunities" description="Themes that point to a concrete next step, ranked by asks, people and recurrence" query={query} contentClassName="space-y-3">
      {() => (
        <>
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((x) => {
              const n = (query.data ?? []).filter((r) => bool(r[x.flag])).length;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.id}
                  onClick={() => setTab(x.id)}
                  className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
                    tab === x.id ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  <x.icon className="h-3.5 w-3.5" /> {x.label} <span className="tabular-nums opacity-80">{n}</span>
                </button>
              );
            })}
          </div>
          <p className="text-sm">{t.action} <span className="text-xs text-muted-foreground">Rule: {t.rule}</span></p>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing matches this rule in the selected range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Theme</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead numeric>Asks</TableHead>
                  <TableHead numeric>People</TableHead>
                  <TableHead numeric>Weeks</TableHead>
                  <TableHead numeric>Success</TableHead>
                  <TableHead numeric>Verified query</TableHead>
                  <TableHead numeric>SQL err</TableHead>
                  <TableHead>Last asked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={`${r.AGENT_KEY}|${r.THEME_ID}`} className="cursor-pointer" onClick={() => onSelect(r)}>
                    <TableCell className="max-w-[24rem] truncate font-medium">{themeTitle(r, canView)}</TableCell>
                    <TableCell className="max-w-[10rem] truncate text-muted-foreground">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_KEY)}</TableCell>
                    <TableCell numeric>{formatNumber(r.ASKS)}</TableCell>
                    <TableCell numeric>{formatNumber(r.USERS)}</TableCell>
                    <TableCell numeric>{formatNumber(r.ACTIVE_WEEKS)}</TableCell>
                    <TableCell numeric>{formatPercent(r.SUCCESS_RATE)}</TableCell>
                    <TableCell numeric>{num(r.SQL_TURNS) ? formatPercent(r.VQ_HIT_RATE) : '—'}</TableCell>
                    <TableCell numeric>{formatPercent(r.SQL_ERROR_RATE)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(r.LAST_ASKED_UTC ? `${r.LAST_ASKED_UTC}Z` : null)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </DataCard>
  );
}

function IntentMix({ className }: { className?: string }) {
  const { days, agent } = useFilters();
  const q = useQ('trend_intents', { days, agent });
  return (
    <DataCard title="What kind of questions" description="Questions by intent; the tooltip shows answer success" query={q} className={className}>
      {(rows) => {
        const data = rows.map((r) => ({ name: intentLabel(r.INTENT), Asks: num(r.ASKS) ?? 0, Success: Math.round((num(r.SUCCESS_RATE) ?? 0) * 100) }));
        return (
          <div style={{ height: Math.max(220, data.length * 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={CHART_THEME.grid} horizontal={false} />
                <XAxis type="number" tick={CHART_THEME.tick} axisLine={false} tickLine={false} tickFormatter={formatTick} />
                <YAxis type="category" dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={140} interval={0} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Asks" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function DomainMix() {
  const { days, agent } = useFilters();
  const q = useQ('trend_domains', { days, agent });
  return (
    <DataCard title="Business domain" description="Share of questions" query={q}>
      {(rows) => {
        const data = rows.map((r) => ({ name: domainLabel(r.DOMAIN), value: num(r.ASKS) ?? 0 }));
        return (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % 5]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function IntentTrend() {
  const { days, agent } = useFilters();
  const q = useQ('trend_intent_weekly', { days, agent });
  return (
    <DataCard title="Questions per week by intent" description="How demand shifts over time" query={q}>
      {(rows) => {
        const series = [...new Set(rows.map((r) => intentLabel(r.INTENT)))];
        const byWeek = new Map<string, Record<string, number | string>>();
        for (const r of rows) {
          const d = String(r.DAY).slice(0, 10);
          const o = byWeek.get(d) ?? { DAY: d };
          o[intentLabel(r.INTENT)] = (Number(o[intentLabel(r.INTENT)]) || 0) + (num(r.ASKS) ?? 0);
          byWeek.set(d, o);
        }
        const data = [...byWeek.values()].sort((a, b) => String(a.DAY).localeCompare(String(b.DAY)));
        return (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="DAY" tick={CHART_THEME.tick} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={40} tickFormatter={formatTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.map((s, i) => (
                  <Area key={s} dataKey={s} name={s} stackId="1" type="monotone" stroke={CHART_COLORS[i % 5]} fill={CHART_COLORS[i % 5]} fillOpacity={0.35} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

function Terms() {
  const { days, agent } = useFilters();
  const q = useQ('trend_terms', { days, agent });
  const block = (rows: Row[], kind: string, title: string, color: string) => {
    const data = rows.filter((r) => r.KIND === kind).map((r) => ({
      name: String(r.TERM), Asks: num(r.ASKS) ?? 0, vq: num(r.VQ_HIT_RATE), agents: num(r.AGENTS) ?? 0,
    }));
    return (
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        <div style={{ height: Math.max(200, data.length * 22) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid stroke={CHART_THEME.grid} horizontal={false} />
              <XAxis type="number" tick={CHART_THEME.tick} axisLine={false} tickLine={false} tickFormatter={formatTick} />
              <YAxis type="category" dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={140} interval={0} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="Asks" fill={color} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };
  return (
    <DataCard
      title="Most requested metrics and dimensions"
      description="Check these are well described in your semantic views and covered by verified queries"
      query={q}
    >
      {(rows) => (
        <div className="grid gap-6 lg:grid-cols-2">
          {block(rows, 'metric', 'Metrics', CHART_COLORS[1])}
          {block(rows, 'dimension', 'Dimensions', CHART_COLORS[2])}
        </div>
      )}
    </DataCard>
  );
}

function ThemeTable({ query, canView, onSelect }: { query: { data?: Row[]; error: Error | null; isPending: boolean }; canView: boolean; onSelect: (r: Row) => void }) {
  const [filter, setFilter] = useState('');
  const [intent, setIntent] = useState('');
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (query.data ?? []).filter((r) =>
      (!intent || r.INTENT === intent)
      && (!f || [r.THEME_LABEL, r.THEME_TOPIC, r.AGENT_DISPLAY_NAME, r.DOMAIN, ...arr(r.METRICS)].some((v) => String(v ?? '').toLowerCase().includes(f))));
  }, [query.data, filter, intent]);
  const intents = [...new Set((query.data ?? []).map((r) => String(r.INTENT)))].sort();
  return (
    <DataCard
      title={`All themes (${rows.length})`}
      description="Click a theme to see how people phrase it, example threads and a verified-query starter"
      query={query}
      contentClassName="p-0"
      actions={
        <div className="flex gap-2">
          <select aria-label="Intent" value={intent} onChange={(e) => setIntent(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-xs">
            <option value="">All intents</option>
            {intents.map((i) => <option key={i} value={i}>{intentLabel(i)}</option>)}
          </select>
          <input
            aria-label="Filter themes"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-40 rounded-lg border bg-card px-2 text-xs"
          />
        </div>
      }
    >
      {() => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Theme</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead numeric>Asks</TableHead>
              <TableHead numeric>Phrasings</TableHead>
              <TableHead numeric>People</TableHead>
              <TableHead>Weekly</TableHead>
              <TableHead numeric>Success</TableHead>
              <TableHead numeric>Verified query</TableHead>
              <TableHead numeric>p50</TableHead>
              <TableHead>Signals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.AGENT_KEY}|${r.THEME_ID}`} className="cursor-pointer" onClick={() => onSelect(r)}>
                <TableCell className="max-w-[22rem] truncate font-medium">{themeTitle(r, canView)}</TableCell>
                <TableCell className="max-w-[10rem] truncate text-muted-foreground">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_KEY)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{intentLabel(r.INTENT)}</TableCell>
                <TableCell numeric>{formatNumber(r.ASKS)}</TableCell>
                <TableCell numeric>{formatNumber(r.PHRASINGS)}</TableCell>
                <TableCell numeric>{formatNumber(r.USERS)}</TableCell>
                <TableCell><Sparkline points={arr(r.SPARK).map((x) => Number(x) || 0)} /></TableCell>
                <TableCell numeric>{formatPercent(r.SUCCESS_RATE)}</TableCell>
                <TableCell numeric>{num(r.SQL_TURNS) ? formatPercent(r.VQ_HIT_RATE) : '—'}</TableCell>
                <TableCell numeric>{formatDuration(r.P50_MS)}</TableCell>
                <TableCell className="space-x-1 whitespace-nowrap">
                  <Signals r={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function Signals({ r }: { r: Row }) {
  return (
    <>
      {bool(r.FLAG_VQR) && <Badge variant="warning">verified query</Badge>}
      {bool(r.FLAG_REPORT) && <Badge variant="secondary">report</Badge>}
      {bool(r.FLAG_GAP) && <Badge variant="destructive">gap</Badge>}
      {bool(r.FLAG_ONBOARDING) && <Badge variant="secondary">onboarding</Badge>}
      {bool(r.FLAG_RISING) && <Badge variant="success">rising</Badge>}
    </>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'verified_query';
}

function ThemeSheet({ theme, canView, onClose }: { theme: Row | null; canView: boolean; onClose: () => void }) {
  const { days } = useFilters();
  const key = theme ? { days, agent: String(theme.AGENT_KEY), theme: String(theme.THEME_ID) } : {};
  const phrasings = useQ('trend_theme_phrasings', key, !!theme && canView);
  const sql = useQ('trend_theme_sql', key, !!theme && canView);
  const [copied, setCopied] = useState(false);
  const best = sql.data?.[0];
  // Phrase the verified query the way people most often ask it.
  const question = String(phrasings.data?.[0]?.USER_QUESTION ?? best?.USER_QUESTION ?? theme?.THEME_LABEL ?? '');
  const yaml = best && theme
    ? `- name: ${slug(String(theme.THEME_LABEL ?? 'question'))}\n  question: "${question.replaceAll('"', '\\"')}"\n  sql: |\n${String(best.FINAL_SQL).split('\n').map((l) => `    ${l}`).join('\n')}\n  use_as_onboarding_question: false`
    : '';
  return (
    <Sheet open={!!theme} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {theme && (
          <>
            <SheetHeader>
              <SheetTitle>{themeTitle(theme, canView)}</SheetTitle>
              <SheetDescription>
                {String(theme.AGENT_DISPLAY_NAME ?? theme.AGENT_KEY)} · {intentLabel(theme.INTENT)} · {domainLabel(theme.DOMAIN)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6 text-sm">
              <div className="flex flex-wrap gap-1"><Signals r={theme} /></div>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                {[
                  ['Asks', formatNumber(theme.ASKS)], ['People', formatNumber(theme.USERS)], ['Active weeks', formatNumber(theme.ACTIVE_WEEKS)],
                  ['Success', formatPercent(theme.SUCCESS_RATE)], ['Verified query used', num(theme.SQL_TURNS) ? formatPercent(theme.VQ_HIT_RATE) : '—'],
                  ['SQL error rate', formatPercent(theme.SQL_ERROR_RATE)], ['Median latency', formatDuration(theme.P50_MS)],
                  ['Credits', formatNumber(theme.CREDITS, 3)], ['Feedback +/−', `${formatNumber(theme.FEEDBACK_POSITIVE ?? 0)} / ${formatNumber(theme.FEEDBACK_NEGATIVE ?? 0)}`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border p-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-base font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {arr(theme.METRICS).filter(Boolean).length > 0 && (
                <p className="text-xs text-muted-foreground">Metrics: {arr(theme.METRICS).filter(Boolean).join(', ')}</p>
              )}

              {!canView ? (
                <Hidden label="Phrasings and SQL need AGENT_OBS_CONTENT_ROLE" />
              ) : (
                <>
                  <section className="space-y-2">
                    <h3 className="font-medium">How people ask it</h3>
                    {phrasings.isPending ? <p className="text-xs text-muted-foreground">Loading…</p> : (
                      <ul className="divide-y rounded-md border">
                        {(phrasings.data ?? []).map((r, i) => (
                          <li key={i} className="flex items-start justify-between gap-3 p-2">
                            <span className="min-w-0 break-words">{String(r.USER_QUESTION ?? '—')}</span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                              {formatNumber(r.ASKS)}×
                              {r.LAST_THREAD_ID ? (
                                <Link className="underline" href={withDays('/thread', days, { id: String(r.LAST_THREAD_ID) })}>thread</Link>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-medium">Verified query starter</h3>
                      {yaml && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => { await navigator.clipboard.writeText(yaml); setCopied(true); }}
                        >
                          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy YAML'}
                        </Button>
                      )}
                    </div>
                    {sql.isPending ? <p className="text-xs text-muted-foreground">Loading…</p> : !best ? (
                      <p className="text-xs text-muted-foreground">No successful SQL answer for this theme yet.</p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          From the latest successful answer{best.SEMANTIC_MODEL ? ` on ${String(best.SEMANTIC_MODEL)}` : ''}
                          {bool(best.VERIFIED_QUERY_USED) ? ' (already used a verified query)' : ''}.
                          This is the SQL the agent ran: review it and rewrite it against the semantic view&apos;s logical tables before adding it as a verified query.
                        </p>
                        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{yaml}</pre>
                      </>
                    )}
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
