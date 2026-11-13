'use client';

import { CHART_COLORS, CHART_THEME, ChartTooltip, formatTick, getYAxisWidth } from '@/components/chart-utils';
import { AgentFilter, DataCard, Delta, Flag, Sparkline, TimeRange } from '@/components/obs/common';
import { FreshnessBanner } from '@/components/obs/freshness';
import { PageHeader } from '@/components/page-header';
import { StatCard, StatCardSkeleton } from '@/components/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCompact, formatDuration, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { arr, bool, num, useFilters, useQ, withDays, type Row } from '@/lib/use-q';
import { Activity, Coins, Gauge, MessageSquare, ThumbsUp, Timer, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function PortfolioView() {
  const { days, agent } = useFilters();
  const p = { days, agent };
  const kpis = useQ('kpis', p);
  const fb = useQ('feedback_kpis', p);

  const cur = kpis.data?.find((r) => r.PERIOD === 'cur') ?? {};
  const prev = kpis.data?.find((r) => r.PERIOD === 'prev') ?? {};
  const fbRow = fb.data?.[0] ?? {};

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="Portfolio"
        title="Agent portfolio"
        description="Every Cortex Agent and CoWork interaction across the account, plus account-wide AI spend and Cortex Code usage."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentFilter />
            <TimeRange />
          </div>
        }
      />
      <FreshnessBanner />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.isPending ? (
          Array.from({ length: 8 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Turns" icon={MessageSquare} value={formatNumber(cur.TURNS)} hint={<Delta cur={num(cur.TURNS)} prev={num(prev.TURNS)} />} />
            <StatCard label="Threads" icon={Activity} value={formatNumber(cur.THREADS)} hint={<Delta cur={num(cur.THREADS)} prev={num(prev.THREADS)} />} />
            <StatCard label="Active users" icon={Users} value={formatNumber(cur.USERS)} hint={<Delta cur={num(cur.USERS)} prev={num(prev.USERS)} />} />
            <StatCard label="AI credits" icon={Coins} value={formatNumber(cur.CREDITS, 2)} hint={<Delta cur={num(cur.CREDITS)} prev={num(prev.CREDITS)} invert />} />
            <StatCard label="Tokens" icon={Zap} value={formatCompact(cur.TOKENS)} hint={`Cache share ${formatPercent(cur.CACHE_SHARE)}`} />
            <StatCard label="Latency p50 / p95" icon={Timer} value={`${formatDuration(cur.P50_MS)} / ${formatDuration(cur.P95_MS)}`} hint={<Delta cur={num(cur.P95_MS)} prev={num(prev.P95_MS)} invert />} />
            <StatCard label="Success rate" icon={Gauge} value={formatPercent(cur.SUCCESS_RATE)} hint={`SQL error rate ${formatPercent(cur.SQL_ERROR_RATE)}`} />
            <StatCard
              label="Positive feedback"
              icon={ThumbsUp}
              value={num(fbRow.N) ? formatPercent((num(fbRow.POSITIVE) ?? 0) / (num(fbRow.N) ?? 1)) : '—'}
              hint={`${formatNumber(fbRow.N ?? 0)} ratings`}
            />
          </>
        )}
      </section>
      {kpis.error && <p className="text-sm text-destructive">{kpis.error.message}</p>}

      <section className="grid gap-4 lg:grid-cols-3">
        <TrendCard className="lg:col-span-2" />
        <InterfaceMix />
      </section>

      <Leaderboard />

      <section className="grid gap-4 lg:grid-cols-3">
        <ModelMix className="lg:col-span-2" />
        <Funnel />
      </section>

      <AiSpend />
      <CortexCode />
    </main>
  );
}

function pivot(rows: Row[], key: string, metric: string) {
  const series = [...new Set(rows.map((r) => String(r[key])))];
  const byDay = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const d = String(r.DAY).slice(0, 10);
    const o = byDay.get(d) ?? { DAY: d };
    o[String(r[key])] = (Number(o[String(r[key])]) || 0) + (num(r[metric]) ?? 0);
    byDay.set(d, o);
  }
  return { series, data: [...byDay.values()].sort((a, b) => String(a.DAY).localeCompare(String(b.DAY))) };
}

function TrendCard({ className }: { className?: string }) {
  const { days, agent } = useFilters();
  const q = useQ('trend', { days, agent });
  return (
    <DataCard title="Daily turns by interface" description="Stacked by interaction surface" query={q} className={className}>
      {(rows) => {
        const { series, data } = pivot(rows, 'INTERFACE', 'TURNS');
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

function InterfaceMix() {
  const { days, agent } = useFilters();
  const q = useQ('interface_mix', { days, agent });
  return (
    <DataCard title="Interface mix" description="Share of turns" query={q}>
      {(rows) => {
        const data = rows.map((r) => ({ name: String(r.INTERFACE), value: num(r.TURNS) ?? 0 }));
        return (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % 5]} />
                  ))}
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

function Leaderboard() {
  const { days } = useFilters();
  const q = useQ('leaderboard', { days });
  return (
    <DataCard
      title="Agent leaderboard"
      description="Flags: idle = no use in range · cost outlier = >2× median credits/turn (30d) · regression = success rate −10 pts vs prior 30d"
      query={q}
      contentClassName="p-0"
    >
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead numeric>Turns</TableHead>
              <TableHead numeric>Users</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead numeric>Credits/turn</TableHead>
              <TableHead numeric>Success</TableHead>
              <TableHead numeric>SQL err</TableHead>
              <TableHead numeric>Feedback +</TableHead>
              <TableHead numeric>p95</TableHead>
              <TableHead>Trend</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const fqn = String(r.AGENT_FQN);
              const linkable = !fqn.startsWith('(');   // "(CoWork default agent)" / "(inline API agent)" have no object
              return (
                <TableRow key={fqn}>
                  <TableCell className="max-w-[16rem]">
                    {linkable ? (
                      <Link href={withDays('/agent', days, { fqn })} className="block truncate font-medium hover:underline" title={fqn}>
                        {String(r.DISPLAY_NAME)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground" title={NO_AGENT_HELP[fqn] ?? 'No agent object'}>
                        {fqn}
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric>{formatNumber(r.TURNS ?? 0)}</TableCell>
                  <TableCell numeric>{formatNumber(r.USERS ?? 0)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CREDITS, 3)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CREDITS_PER_TURN, 4)}</TableCell>
                  <TableCell numeric>{formatPercent(r.SUCCESS_RATE)}</TableCell>
                  <TableCell numeric>{formatPercent(r.SQL_ERROR_RATE)}</TableCell>
                  <TableCell numeric>{formatPercent(r.FEEDBACK_POSITIVE_RATE)}</TableCell>
                  <TableCell numeric>{formatDuration(r.P95_MS)}</TableCell>
                  <TableCell>
                    <Sparkline points={arr(r.SPARK).map((x) => Number((x as Row).t) || 0)} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(r.LAST_USED_UTC ? `${r.LAST_USED_UTC}Z` : null)}</TableCell>
                  <TableCell className="space-x-1">
                    <Flag on={bool(r.FLAG_IDLE)} label="idle" tone="secondary" />
                    <Flag on={bool(r.FLAG_COST_OUTLIER)} label="cost outlier" />
                    <Flag on={bool(r.FLAG_QUALITY_REGRESSION)} label="regression" tone="destructive" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

function ModelMix({ className }: { className?: string }) {
  const { days, agent } = useFilters();
  const q = useQ('model_mix', { days, agent });
  return (
    <DataCard title="Credits by model" description="Authoritative usage-view credits by service type × model" query={q} className={className}>
      {(rows) => {
        const data = rows.slice(0, 12).map((r) => ({ name: `${r.MODEL} · ${r.SERVICE_TYPE}`, Credits: num(r.CREDITS) ?? 0 }));
        return (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={CHART_THEME.grid} horizontal={false} />
                <XAxis type="number" tick={CHART_THEME.tick} axisLine={false} tickLine={false} tickFormatter={formatTick} />
                <YAxis type="category" dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={190} />
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

function Funnel() {
  const q = useQ('funnel');
  return (
    <DataCard title="Adoption funnel" description="Last 30 days" query={q}>
      {(rows) => {
        const r = rows[0];
        const steps = [
          { name: 'Provisioned', v: num(r.PROVISIONED) ?? 0 },
          { name: 'Used', v: num(r.USED) ?? 0 },
          { name: '≥ 5 users', v: num(r.USED_BY_5_PLUS) ?? 0 },
          { name: 'Weekly use', v: num(r.USED_WEEKLY) ?? 0 },
        ];
        return (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={steps}>
                <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={getYAxisWidth(steps, 'v')} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="v" name="Agents" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }}
    </DataCard>
  );
}

const NO_AGENT_HELP: Record<string, string> = {
  '(CoWork default agent)': "CoWork chats that didn't pick an agent run on CoWork's built-in agent, which isn't a schema object",
  '(inline API agent)': 'agent:run API calls that pass their config inline instead of naming an agent object',
};

/** Account-wide AI credits by product. Ignores the agent filter: CoCo and AI functions have no agent. */
function AiSpend() {
  const { days } = useFilters();
  const trend = useQ('ai_spend_trend', { days });
  const totals = useQ('ai_spend_by_product', { days });
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <DataCard
        title="AI spend by product"
        description="Credits per day across Cortex Agents, CoWork, Cortex Code and AI functions (whole account)"
        query={trend}
        className="lg:col-span-2"
      >
        {(rows) => {
          const { series, data } = pivot(rows, 'PRODUCT', 'CREDITS');
          return (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                  <XAxis dataKey="DAY" tick={CHART_THEME.tick} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={40} tickFormatter={formatTick} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {series.map((s, i) => (
                    <Bar key={s} dataKey={s} name={s} stackId="1" fill={CHART_COLORS[i % 5]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        }}
      </DataCard>
      <DataCard title="Credits by product" description={`Last ${days} days vs prior ${days}`} query={totals} contentClassName="p-0">
        {(rows) => {
          const total = rows.reduce((s, r) => s + (num(r.CREDITS) ?? 0), 0);
          return (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead numeric>Credits</TableHead>
                  <TableHead numeric>Share</TableHead>
                  <TableHead numeric>vs prior</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={String(r.PRODUCT)}>
                    <TableCell className="font-medium">{String(r.PRODUCT)}</TableCell>
                    <TableCell numeric>{formatNumber(r.CREDITS, 2)}</TableCell>
                    <TableCell numeric>{formatPercent(total ? (num(r.CREDITS) ?? 0) / total : null)}</TableCell>
                    <TableCell numeric>
                      <Delta cur={num(r.CREDITS)} prev={num(r.PREV_CREDITS)} invert />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          );
        }}
      </DataCard>
    </section>
  );
}

/** Cortex Code (CoCo) usage from the CoCo usage views. CoCo owns no agent object, so it isn't in the turn metrics above. */
function CortexCode() {
  const { days } = useFilters();
  const surfaces = useQ('code_by_surface', { days });
  const models = useQ('code_models', { days });
  const users = useQ('code_top_users', { days });
  return (
    <section className="space-y-4">
      <DataCard
        title="Cortex Code"
        description="Requests and credits by surface (Desktop, Snowsight, CLI). Not counted as agent turns."
        query={surfaces}
        contentClassName="p-0"
      >
        {(rows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surface</TableHead>
                <TableHead numeric>Requests</TableHead>
                <TableHead numeric>Threads</TableHead>
                <TableHead numeric>Users</TableHead>
                <TableHead numeric>Credits</TableHead>
                <TableHead numeric>Credits/request</TableHead>
                <TableHead numeric>Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r.SURFACE)}>
                  <TableCell className="font-medium">{String(r.SURFACE)}</TableCell>
                  <TableCell numeric>{formatNumber(r.REQUESTS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.THREADS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.USERS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CREDITS, 2)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CREDITS_PER_REQUEST, 4)}</TableCell>
                  <TableCell numeric>{formatCompact(r.TOKENS)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>
      <section className="grid gap-4 lg:grid-cols-3">
        <DataCard title="Cortex Code credits by model" description="From the per-model credit breakdown" query={models} className="lg:col-span-2">
          {(rows) => {
            const data = rows.map((r) => ({ name: String(r.MODEL), Credits: num(r.CREDITS) ?? 0 }));
            return (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid stroke={CHART_THEME.grid} horizontal={false} />
                    <XAxis type="number" tick={CHART_THEME.tick} axisLine={false} tickLine={false} tickFormatter={formatTick} />
                    <YAxis type="category" dataKey="name" tick={CHART_THEME.tick} axisLine={false} tickLine={false} width={150} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Credits" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          }}
        </DataCard>
        <DataCard title="Top Cortex Code users" description="By credits" query={users} contentClassName="p-0">
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead numeric>Requests</TableHead>
                  <TableHead numeric>Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={String(r.USER_NAME)}>
                    <TableCell className="max-w-[10rem] truncate" title={arr(r.SURFACES).join(', ')}>
                      {String(r.USER_NAME ?? '—')}
                    </TableCell>
                    <TableCell numeric>{formatNumber(r.REQUESTS)}</TableCell>
                    <TableCell numeric>{formatNumber(r.CREDITS, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DataCard>
      </section>
    </section>
  );
}
