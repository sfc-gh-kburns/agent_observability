'use client';

import { DataCard, Flag } from '@/components/obs/common';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { arr, bool, num, useFilters, useQ, withDays, type Row } from '@/lib/use-q';
import Link from 'next/link';
import { useState } from 'react';

const main = 'mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8';

// ------------------------------------------------------------------ Config
const CONFIG_FILTERS: { key: string; label: string }[] = [
  { key: 'GOV_WEB_SEARCH_ENABLED', label: 'web search' },
  { key: 'GOV_CODE_EXECUTION_ENABLED', label: 'code execution' },
  { key: 'GOV_OWNER_ACCOUNTADMIN', label: 'owner ACCOUNTADMIN' },
  { key: 'GOV_NO_DESCRIPTION', label: 'no description' },
  { key: 'GOV_NO_SAMPLE_QUESTIONS', label: 'no sample questions' },
  { key: 'GOV_UNBOUNDED_BUDGET', label: 'unbounded budget' },
  { key: 'GOV_NOT_VISIBLE_TO_INGEST', label: 'not visible (no MONITOR)' },
];

export function ConfigView() {
  const { days } = useFilters();
  const q = useQ('config_catalog');
  const changes = useQ('config_changes', { limit: 100 });
  const [flag, setFlag] = useState<string | null>(null);
  const [text, setText] = useState('');
  const filtered = { ...q, data: q.data?.filter((r) => (!flag || bool(r[flag])) && (!text || JSON.stringify(r).toLowerCase().includes(text.toLowerCase()))) };

  return (
    <main className={main}>
      <PageHeader eyebrow="Configuration" title="Agent configuration catalog" description="Every agent from SHOW AGENTS / DESCRIBE AGENT, with capability and governance flags. History is captured as SCD2 snapshots." />
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter…" className="h-8 w-48 rounded-lg border bg-card px-2 text-xs" />
        {CONFIG_FILTERS.map((f) => {
          const n = (q.data ?? []).filter((r) => bool(r[f.key])).length;
          return (
            <button key={f.key} type="button" onClick={() => setFlag(flag === f.key ? null : f.key)}>
              <Badge variant={flag === f.key ? 'default' : 'outline'}>{f.label} · {n}</Badge>
            </button>
          );
        })}
      </div>
      <DataCard title={`Agents (${filtered.data?.length ?? 0})`} query={filtered} contentClassName="p-0" empty="No agents match">
        {(rows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead numeric>Tools</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Bound semantic views / search</TableHead>
                <TableHead numeric>Versions</TableHead>
                <TableHead>Last change</TableHead>
                <TableHead>Governance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r.AGENT_FQN)}>
                  <TableCell className="max-w-[16rem]">
                    <Link href={withDays('/agent', days, { fqn: String(r.AGENT_FQN) })} className="block truncate font-medium hover:underline">{String(r.DISPLAY_NAME)}</Link>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{String(r.DATABASE_NAME)}.{String(r.SCHEMA_NAME)}.{String(r.AGENT_NAME)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{String(r.OWNER)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{String(r.ORCHESTRATION_MODEL ?? 'default')}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.BUDGET_SECONDS ? `${r.BUDGET_SECONDS}s / ${formatNumber(r.BUDGET_TOKENS)}` : '—'}</TableCell>
                  <TableCell numeric className="text-xs" title={`${r.ANALYST_TOOL_COUNT} analyst · ${r.SEARCH_TOOL_COUNT} search · ${r.CUSTOM_TOOL_COUNT} custom`}>
                    {String(r.TOOL_COUNT)} <span className="text-muted-foreground">({String(r.ANALYST_TOOL_COUNT)}/{String(r.SEARCH_TOOL_COUNT)}/{String(r.CUSTOM_TOOL_COUNT)})</span>
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Flag on={bool(r.HAS_WEB_SEARCH)} label="web" tone="secondary" />
                    <Flag on={bool(r.HAS_CODE_EXECUTION)} label="code" tone="secondary" />
                    <Flag on={bool(r.HAS_CHARTS)} label="charts" tone="secondary" />
                    <Flag on={bool(r.HAS_MCP)} label="MCP" tone="secondary" />
                    <Flag on={bool(r.HAS_MEMORY)} label="memory" tone="secondary" />
                    <Flag on={(num(r.SKILL_COUNT) ?? 0) > 0} label={`${r.SKILL_COUNT} skills`} tone="secondary" />
                  </TableCell>
                  <TableCell className="max-w-[18rem] font-mono text-[11px]">
                    {[...arr(r.BOUND_SEMANTIC_VIEWS), ...arr(r.BOUND_SEARCH_SERVICES)].map((x) => (
                      <span key={String(x)} className="block truncate" title={String(x)}>{String(x)}</span>
                    ))}
                  </TableCell>
                  <TableCell numeric>{String(r.VERSION_COUNT ?? '—')}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.LAST_CONFIG_CHANGE)}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Flag on={bool(r.GOV_NO_DESCRIPTION)} label="no desc" />
                    <Flag on={bool(r.GOV_NO_SAMPLE_QUESTIONS)} label="no samples" />
                    <Flag on={bool(r.GOV_UNBOUNDED_BUDGET)} label="unbounded" />
                    <Flag on={bool(r.GOV_OWNER_ACCOUNTADMIN)} label="ACCOUNTADMIN" tone="secondary" />
                    <Flag on={bool(r.GOV_NOT_VISIBLE_TO_INGEST)} label="not visible" tone="destructive" />
                    <Flag on={bool(r.IS_DROPPED)} label="dropped" tone="destructive" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>
      <DataCard title="Config change log" description="Spec / owner / version changes across all agents (most recent 100)" query={changes} contentClassName="p-0" empty="No changes captured yet — history accrues from the first snapshot">
        {(rows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Changed</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>What changed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.CHANGED_AT)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link href={withDays('/agent', days, { fqn: String(r.AGENT_FQN) })} className="hover:underline">{String(r.AGENT_FQN)}</Link>
                  </TableCell>
                  <TableCell className="text-xs">{describeChange(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>
    </main>
  );
}

function describeChange(r: Row) {
  if (bool(r.IS_DROPPED)) return 'agent dropped';
  const parts: string[] = [];
  if (r.ORCHESTRATION_MODEL !== r.PREV_ORCHESTRATION_MODEL) parts.push(`model ${r.PREV_ORCHESTRATION_MODEL ?? '—'} → ${r.ORCHESTRATION_MODEL ?? '—'}`);
  if (r.TOOL_COUNT !== r.PREV_TOOL_COUNT) parts.push(`tools ${r.PREV_TOOL_COUNT} → ${r.TOOL_COUNT}`);
  if (r.OWNER !== r.PREV_OWNER) parts.push(`owner ${r.PREV_OWNER} → ${r.OWNER}`);
  if (r.DEFAULT_VERSION_NAME !== r.PREV_DEFAULT_VERSION_NAME) parts.push(`default version ${r.PREV_DEFAULT_VERSION_NAME ?? '—'} → ${r.DEFAULT_VERSION_NAME ?? '—'}`);
  return parts.length ? parts.join(' · ') : 'instructions / tool spec / profile edited (see agent page diff)';
}

// ------------------------------------------------------------------ Assets
export function AssetsView() {
  const q = useQ('assets');
  const [mode, setMode] = useState<'used' | 'shared' | 'unused' | 'missing' | 'all'>('used');
  const pick = (r: Row) =>
    mode === 'all' ? true : mode === 'used' ? (num(r.CALLS) ?? 0) > 0 : mode === 'shared' ? bool(r.IS_SHARED) : mode === 'unused' ? bool(r.IS_BOUND_UNUSED) : bool(r.IS_BOUND_BUT_MISSING);
  const filtered = { ...q, data: q.data?.filter(pick) };
  const count = (m: typeof mode) => (q.data ?? []).filter((r) => (m === 'all' ? true : m === 'used' ? (num(r.CALLS) ?? 0) > 0 : m === 'shared' ? bool(r.IS_SHARED) : m === 'unused' ? bool(r.IS_BOUND_UNUSED) : bool(r.IS_BOUND_BUT_MISSING))).length;
  return (
    <main className={main}>
      <PageHeader eyebrow="Assets" title="Semantic views & search services" description="Bound in agent configs vs actually used in traces (last 30 days), across all agents." />
      <div className="flex flex-wrap gap-1.5">
        {(['used', 'shared', 'unused', 'missing', 'all'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}>
            <Badge variant={mode === m ? 'default' : 'outline'}>
              {{ used: 'used', shared: 'shared by ≥2 agents', unused: 'bound but unused', missing: 'bound but missing', all: 'all' }[m]} · {count(m)}
            </Badge>
          </button>
        ))}
      </div>
      <DataCard title={`Assets (${filtered.data?.length ?? 0})`} query={filtered} contentClassName="p-0" empty="No assets in this view">
        {(rows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Type</TableHead>
                <TableHead numeric>Agents bound</TableHead>
                <TableHead numeric>Agents using</TableHead>
                <TableHead numeric>Calls</TableHead>
                <TableHead numeric>Users</TableHead>
                <TableHead numeric>SQL err %</TableHead>
                <TableHead numeric>VQ hit %</TableHead>
                <TableHead numeric>Verified queries</TableHead>
                <TableHead numeric>p95</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.ASSET_KEY}-${r.ASSET_TYPE}`}>
                  <TableCell className="max-w-[20rem]">
                    <span className="block truncate font-mono text-xs" title={String(r.ASSET_KEY)}>{String(r.ASSET_KEY)}</span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={arr(r.AGENTS_USING_LIST).join(', ')}>
                      {arr(r.AGENTS_USING_LIST).map((a) => String(a).split('.').pop()?.replaceAll('"', '')).join(', ')}
                    </span>
                  </TableCell>
                  <TableCell><Badge variant="outline">{String(r.ASSET_TYPE ?? '—').toLowerCase().replaceAll('_', ' ')}</Badge></TableCell>
                  <TableCell numeric>{formatNumber(r.AGENTS_BOUND)}</TableCell>
                  <TableCell numeric>{formatNumber(r.AGENTS_USING)}</TableCell>
                  <TableCell numeric>{formatNumber(r.CALLS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.USERS)}</TableCell>
                  <TableCell numeric>{formatPercent(r.SQL_ERROR_RATE)}</TableCell>
                  <TableCell numeric>{formatPercent(r.VQ_HIT_RATE)}</TableCell>
                  <TableCell numeric>{formatNumber(r.VERIFIED_QUERY_COUNT)}</TableCell>
                  <TableCell numeric>{formatDuration(r.P95_MS)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {String(r.OWNER ?? '—')}
                    <Flag on={bool(r.ASSET_DROPPED)} label="dropped" tone="destructive" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>
    </main>
  );
}

// ------------------------------------------------------------------ Admin
export function AdminView() {
  const fresh = useQ('freshness');
  const runs = useQ('pipeline_runs', { limit: 60 });
  const me = useQ('whoami');
  const m = me.data?.[0];
  return (
    <main className={main}>
      <PageHeader eyebrow="Admin" title="Pipeline & access" description="AGENT_OBS ingestion health, data freshness and your access tier." />
      <section className="grid gap-4 lg:grid-cols-3">
        <DataCard title="You" query={me}>
          {() => (
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">User</dt><dd>{String(m?.USER_NAME)}</dd>
              <dt className="text-muted-foreground">Role</dt><dd>{String(m?.ROLE_NAME)}</dd>
              <dt className="text-muted-foreground">Tier</dt>
              <dd>{bool(m?.CAN_VIEW_CONTENT) ? <Badge variant="success">content</Badge> : <Badge variant="secondary">metadata only</Badge>}</dd>
            </dl>
          )}
        </DataCard>
        <DataCard title="Data freshness" query={fresh} className="lg:col-span-2" contentClassName="p-0">
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Data through</TableHead>
                  <TableHead>Last loaded</TableHead>
                  <TableHead numeric>Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={String(r.SOURCE)}>
                    <TableCell className="font-medium">{String(r.SOURCE)}</TableCell>
                    <TableCell>{formatDateTime(r.DATA_THROUGH)}</TableCell>
                    <TableCell>{formatDateTime(r.LAST_LOADED_AT)}</TableCell>
                    <TableCell numeric>{formatNumber(r.ROWS_)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DataCard>
      </section>
      <DataCard title="Pipeline runs" description="ADMIN.LOAD_LOG, last 14 days (task graph runs every 12 h at 00:00 / 12:00 UTC)" query={runs} contentClassName="p-0">
        {(rows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Status</TableHead>
                <TableHead numeric>Seconds</TableHead>
                <TableHead numeric>Inserted</TableHead>
                <TableHead numeric>Updated</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.STARTED_AT)}</TableCell>
                  <TableCell>{String(r.STEP)}</TableCell>
                  <TableCell>
                    <Badge variant={r.STATUS === 'OK' ? 'success' : r.STATUS === 'PARTIAL' ? 'warning' : 'destructive'}>{String(r.STATUS)}</Badge>
                  </TableCell>
                  <TableCell numeric>{formatNumber(r.SECONDS)}</TableCell>
                  <TableCell numeric>{formatNumber(r.ROWS_INSERTED)}</TableCell>
                  <TableCell numeric>{formatNumber(r.ROWS_UPDATED)}</TableCell>
                  <TableCell className="max-w-[24rem] truncate text-xs text-muted-foreground" title={String(r.MESSAGE ?? '')}>{String(r.MESSAGE ?? '')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>
    </main>
  );
}
