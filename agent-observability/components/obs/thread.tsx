'use client';

import { DataCard, Hidden } from '@/components/obs/common';
import { Markdown } from '@/components/obs/markdown';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { copyText } from '@/lib/clipboard';
import { formatCompact, formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { arr, bool, num, obj, useFilters, useQ, type Row } from '@/lib/use-q';
import { cn } from '@/lib/utils';
import { Bot, ChevronDown, ChevronRight, Download, Link2, ThumbsDown, ThumbsUp, User } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function ThreadView() {
  const { sp } = useFilters();
  const id = sp.get('id');
  const focus = sp.get('turn');
  const turns = useQ('thread_turns', { thread: id }, !!id);
  const feedback = useQ('thread_feedback', { thread: id }, !!id);

  if (!id) return <Shell><EmptyState title="No thread selected" /></Shell>;
  const rows = turns.data ?? [];
  const first = rows[0];
  const total = rows.reduce((s, r) => s + (num(r.COMBINED_CREDITS) ?? 0), 0);
  const versions = [...new Set(rows.map((r) => r.AGENT_VERSION_NAME).filter(Boolean))];
  const fbByTurn = new Map<string, Row[]>();
  for (const f of feedback.data ?? []) fbByTurn.set(String(f.TURN_ID), [...(fbByTurn.get(String(f.TURN_ID)) ?? []), f]);

  const exportThread = () => {
    const blob = new Blob([JSON.stringify({ thread_id: id, turns: rows, feedback: feedback.data ?? [] }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thread-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Shell>
      <PageHeader
        eyebrow="Thread"
        title={first ? String(first.AGENT_DISPLAY_NAME ?? first.AGENT_FQN ?? 'Agent thread') : `Thread ${id}`}
        description={
          first
            ? `${id} · ${String(first.USER_NAME ?? '—')} · ${rows.length} turns · ${formatNumber(total, 4)} credits · ${String(first.INTERFACE)}${
                versions.length > 1 ? ` · versions ${versions.join(', ')}` : ''
              }`
            : id
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => copyText(window.location.href)}><Link2 className="h-4 w-4" /> Copy link</Button>
            <Button variant="outline" size="sm" onClick={exportThread} disabled={!rows.length}><Download className="h-4 w-4" /> Export JSON</Button>
          </div>
        }
      />
      {turns.isPending && <Skeleton className="h-40 w-full" />}
      {turns.error && <EmptyState variant="error" title="Could not load thread" description={turns.error.message} />}
      {!turns.isPending && !rows.length && !turns.error && <EmptyState title="Thread not found in this mart" />}
      {first && first.THREAD_ID_SOURCE !== 'EVENT' && (
        <p className="text-xs text-muted-foreground">
          No trace thread id for this conversation; turns are grouped by {String(first.THREAD_ID_SOURCE)} (fallback).
        </p>
      )}
      {rows.map((r) => (
        <TurnCard key={String(r.TURN_ID)} r={r} feedback={fbByTurn.get(String(r.TURN_ID)) ?? []} defaultOpen={focus === r.TURN_ID || rows.length === 1} />
      ))}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">{children}</main>;
}

function TurnCard({ r, feedback, defaultOpen }: { r: Row; feedback: Row[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const suggestions = arr(r.SUGGESTED_QUERIES);
  return (
    <Card id={String(r.TURN_ID)} className="min-w-0">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge>Turn {String(r.TURN_NUMBER)}</Badge>
          <span className="text-muted-foreground">{formatDateTime(r.START_TIME_UTC)} UTC</span>
          <Badge variant="outline">{formatNumber(r.COMBINED_CREDITS, 4)} credits</Badge>
          <Badge variant="outline">{formatCompact(r.TOKENS)} tokens</Badge>
          <Badge variant="outline">{formatDuration(r.DURATION_MS ?? r.AGENT_DURATION_MS)}</Badge>
          {r.AGENT_VERSION_NAME ? <Badge variant="outline">{String(r.AGENT_VERSION_NAME)}</Badge> : null}
          {r.ROLE_NAME ? <Badge variant="outline">role {String(r.ROLE_NAME)}</Badge> : null}
          {bool(r.IS_SUCCESS) ? <Badge variant="success">ok</Badge> : <Badge variant="destructive">failed {String(r.STATUS_CODE ?? '')}</Badge>}
          {(num(r.SQL_ERRORS) ?? 0) > 0 && <Badge variant="warning">{String(r.SQL_ERRORS)} SQL errors</Badge>}
          {(num(r.VERIFIED_QUERY_HITS) ?? 0) > 0 && <Badge variant="secondary">verified query</Badge>}
          {!bool(r.HAS_TRACE) && <Badge variant="outline">no trace</Badge>}
          {!bool(r.HAS_USAGE) && <Badge variant="outline">not yet billed</Badge>}
          {feedback.map((f, i) => (
            <Badge key={i} variant={bool(f.IS_POSITIVE) ? 'success' : 'destructive'} title={String(f.FEEDBACK_TEXT ?? '')}>
              {bool(f.IS_POSITIVE) ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
              {f.FEEDBACK_TEXT ? ` ${String(f.FEEDBACK_TEXT).slice(0, 40)}` : ''}
            </Badge>
          ))}
        </div>
        <Message who="user" text={r.QUESTION} />
        <Message who="agent" text={r.RESPONSE} />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-9">
            {suggestions.map((s, i) => (
              <Badge key={i} variant="outline" className="font-normal">{typeof s === 'string' ? s : JSON.stringify(s)}</Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Trace, SQL &amp; cost
        </Button>
        {open && (
          <div className="space-y-4">
            <TimeSplit r={r} />
            {r.TRACE_ID ? <Waterfall trace={String(r.TRACE_ID)} window={bool(r.IS_SHARED_TRACE) ? { from: String(r.START_TIME_UTC), to: String(r.END_TIME_UTC) } : undefined} /> : <EmptyState title="No trace for this turn" description="Event delivery is best-effort; cost is still shown from usage views." />}
            {r.TRACE_ID ? <SqlPanel trace={String(r.TRACE_ID)} /> : null}
            {r.REQUEST_ID ? <CostPanel request={String(r.REQUEST_ID)} r={r} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Message({ who, text }: { who: 'user' | 'agent'; text: unknown }) {
  const Icon = who === 'user' ? User : Bot;
  return (
    <div className="flex min-w-0 gap-3">
      <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', who === 'user' ? 'bg-muted' : 'bg-primary/10 text-primary')}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {!text ? (
          <Hidden label={who === 'user' ? 'Question hidden' : 'Response hidden'} />
        ) : who === 'user' ? (
          <p className="whitespace-pre-wrap break-words text-sm font-medium">{String(text)}</p>
        ) : (
          <Markdown text={String(text)} collapsible />
        )}
      </div>
    </div>
  );
}

function TimeSplit({ r }: { r: Row }) {
  const parts = [
    { k: 'Planning', v: num(r.PLANNING_MS) ?? 0, c: 'bg-chart-1' },
    { k: 'Tools', v: num(r.TOOL_MS) ?? 0, c: 'bg-chart-2' },
    { k: 'Response', v: num(r.RESPONSE_MS) ?? 0, c: 'bg-chart-3' },
  ];
  const total = Math.max(1, parts.reduce((s, p) => s + p.v, 0));
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((p) => <div key={p.k} className={p.c} style={{ width: `${(p.v / total) * 100}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {parts.map((p) => (
          <span key={p.k} className="flex items-center gap-1"><span className={cn('h-2 w-2 rounded-sm', p.c)} />{p.k} {formatDuration(p.v)}</span>
        ))}
        <span>· {formatNumber(r.PLANNING_STEPS)} planning steps · {formatNumber(r.TOOL_CALLS)} tool calls</span>
      </div>
    </div>
  );
}

const CAT_COLOR: Record<string, string> = {
  root: 'bg-muted-foreground/40', turn_info: 'bg-muted-foreground/40', planning: 'bg-chart-1', response: 'bg-chart-3',
  sql: 'bg-chart-2', sql_exec: 'bg-chart-2/60', analyst: 'bg-chart-4', semantic_context: 'bg-chart-4', search: 'bg-chart-5',
  chart: 'bg-chart-5', code_exec: 'bg-warning', skill: 'bg-chart-4', custom: 'bg-warning', web_search: 'bg-chart-5',
};

/** Gantt-style span waterfall with a detail sheet per span (parity with Snowsight's trace view). */
function Waterfall({ trace, window }: { trace: string; window?: { from: string; to: string } }) {
  const q = useQ('trace_spans', { trace, from: window?.from, to: window?.to });
  const [sel, setSel] = useState<Row | null>(null);
  const spans = useMemo(() => q.data ?? [], [q.data]);
  const total = useMemo(
    () => Math.max(1, ...spans.map((s) => (num(s.OFFSET_MS) ?? 0) + (num(s.DURATION_MS) ?? 0))),
    [spans],
  );
  return (
    <DataCard title={`Trace ${trace}`} description={`${spans.length} spans · ${formatDuration(total)} · click a span for attributes${window ? ' · trace id shared across turns; showing this turn’s time window' : ''}`} query={q} contentClassName="space-y-1">
      {(rows) => (
        <>
          {rows.map((s) => {
            const left = ((num(s.OFFSET_MS) ?? 0) / total) * 100;
            const width = Math.max(0.5, ((num(s.DURATION_MS) ?? 0) / total) * 100);
            const err = bool(s.IS_ERROR) || bool(s.IS_SQL_ERROR);
            return (
              <button
                key={String(s.EVENT_HASH)}
                type="button"
                onClick={() => setSel(s)}
                className="grid w-full grid-cols-[minmax(0,15rem)_1fr_4.5rem] items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
              >
                <span className="truncate" style={{ paddingLeft: `${(num(s.DEPTH) ?? 0) * 12}px` }} title={String(s.SPAN_NAME)}>
                  {err && <span className="mr-1 text-destructive">●</span>}
                  {String(s.SPAN_NAME)}
                  {bool(s.IS_ORPHAN) && <span className="ml-1 text-muted-foreground" title="Parent span not delivered / external">↰</span>}
                </span>
                <span className="relative h-3.5 rounded bg-muted/50">
                  <span
                    className={cn('absolute top-0 h-full rounded', CAT_COLOR[String(s.SPAN_CATEGORY)] ?? 'bg-muted-foreground/60', err && 'ring-1 ring-destructive')}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{formatDuration(s.DURATION_MS)}</span>
              </button>
            );
          })}
          <SpanSheet span={sel} onClose={() => setSel(null)} />
        </>
      )}
    </DataCard>
  );
}

const META_FIELDS = [
  'SPAN_CATEGORY', 'TOOL_NAME', 'RESOURCE_FQN', 'MODEL', 'STEP_NUMBER', 'TOOL_SELECTED_NAME', 'TOOL_SELECTED_TYPE',
  'START_TS_UTC', 'DURATION_MS', 'SPAN_STATUS_CODE', 'TOOL_STATUS_CODE', 'VERIFIED_QUERY_USED', 'QUERY_ID',
  'TOKENS_INPUT', 'TOKENS_OUTPUT', 'TOKENS_CACHE_READ', 'TOKENS_CACHE_WRITE', 'TOKENS_TOTAL', 'SPAN_ID', 'PARENT_SPAN_ID',
];

/** Attributes worth surfacing above the raw JSON, by span family. */
const KEY_ATTRS = [
  'snow.ai.observability.agent.planning.thinking_response',
  'snow.ai.observability.agent.planning.tool_selection.argument.value',
  'snow.ai.observability.agent.planning.response',
  'snow.ai.observability.agent.tool.sql_execution.final_sql',
  'snow.ai.observability.agent.tool.sql_execution.query',
  'snow.ai.observability.agent.tool.sql_execution.execution_status',
  'snow.ai.observability.agent.tool.sql_execution.validation_error.0.message',
  'snow.ai.observability.agent.tool.sql_execution.error_correction',
  'snow.ai.observability.agent.tool.cortex_search.query',
  'snow.ai.observability.agent.tool.cortex_search.results',
  'snow.ai.observability.agent.tool.chart_generation.input_chart_spec',
  'snow.ai.observability.agent.response',
];

function SpanSheet({ span, onClose }: { span: Row | null; onClose: () => void }) {
  const [raw, setRaw] = useState(false);
  useEffect(() => setRaw(false), [span]);
  const attrs = span ? obj(span.ATTRS) : null;
  return (
    <Sheet open={!!span} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {span && (
          <>
            <SheetHeader>
              <SheetTitle className="break-all">{String(span.SPAN_NAME)}</SheetTitle>
              <SheetDescription>{String(span.SPAN_CATEGORY)} span · {formatDuration(span.DURATION_MS)}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-xs">
                {META_FIELDS.filter((f) => span[f] !== null && span[f] !== undefined && span[f] !== '').map((f) => (
                  <div key={f} className="contents">
                    <dt className="text-muted-foreground">{f.toLowerCase()}</dt>
                    <dd className="break-all font-mono">{String(span[f])}</dd>
                  </div>
                ))}
              </dl>
              {span.QUERY_ID ? (
                <p className="text-xs text-muted-foreground">
                  Open the query profile in Snowsight: Monitoring → Query History → query id <span className="font-mono">{String(span.QUERY_ID)}</span>
                </p>
              ) : null}
              {!attrs ? (
                <Hidden label="Span inputs/outputs hidden (content tier)" />
              ) : (
                <>
                  {KEY_ATTRS.filter((k) => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '').map((k) => (
                    <div key={k} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">{k.replace('snow.ai.observability.agent.', '')}</p>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs">{pretty(attrs[k])}</pre>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setRaw((v) => !v)}>{raw ? 'Hide' : 'Show'} raw JSON</Button>
                  {raw && <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(attrs, null, 2)}</pre>}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function pretty(v: unknown) {
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
}

function SqlPanel({ trace }: { trace: string }) {
  const q = useQ('trace_sql', { trace });
  if (!q.isPending && !q.error && !q.data?.length) return null;
  return (
    <DataCard title="SQL executions" description="Generated SQL, verified-query use, validation and warehouse metrics" query={q} contentClassName="space-y-3">
      {(rows) =>
        rows.map((s, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="outline">{String(s.TOOL_NAME ?? 'sql')}</Badge>
              <span className="truncate font-mono text-muted-foreground">{String(s.SEMANTIC_MODEL ?? '')}</span>
              {bool(s.IS_ERROR) ? <Badge variant="destructive">error {String(s.STATUS_CODE ?? '')}</Badge> : <Badge variant="success">executed</Badge>}
              {bool(s.VERIFIED_QUERY_USED) && <Badge variant="secondary">verified query</Badge>}
              {bool(s.HAS_VALIDATION_ISSUE) && <Badge variant="warning">validation issues</Badge>}
              <span className="text-muted-foreground">{formatDuration(s.DURATION_MS)} · {formatNumber(s.RESULT_ROWS)} rows</span>
              {s.QH_TOTAL_ELAPSED_MS ? <span className="text-muted-foreground">· warehouse {String(s.QH_WAREHOUSE_SIZE ?? '')} {formatDuration(s.QH_TOTAL_ELAPSED_MS)}</span> : null}
              {s.QUERY_ID ? <span className="font-mono text-muted-foreground">· {String(s.QUERY_ID)}</span> : null}
            </div>
            {s.FINAL_SQL ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{String(s.FINAL_SQL)}</pre>
            ) : (
              <Hidden label="SQL hidden" />
            )}
            {s.EXECUTION_STATUS ? <p className="text-xs text-muted-foreground">{String(s.EXECUTION_STATUS)}</p> : null}
            {arr(s.VALIDATION_ERRORS).map((v, j) => <p key={j} className="text-xs text-warning">⚠ {String(v)}</p>)}
          </div>
        ))
      }
    </DataCard>
  );
}

function CostPanel({ request, r }: { request: string; r: Row }) {
  const q = useQ('turn_cost', { request });
  const traceTok = num(r.TRACE_TOKENS_TOTAL);
  const billedTok = num(r.TOKENS);
  return (
    <DataCard
      title="Authoritative cost"
      description={`From usage views (source of truth). Token credits ${formatNumber(r.TOKEN_CREDITS, 6)} · AI functions ${formatNumber(r.AI_FUNCTIONS_CREDITS ?? 0, 6)} · SQL ${formatNumber(r.SQL_QUERY_CREDITS ?? 0, 6)}`}
      query={q}
      contentClassName="p-0"
      empty="Not billed yet (usage views lag ~1 h) or agentless call"
    >
      {(rows) => (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Model</TableHead>
                <TableHead numeric>Steps</TableHead>
                <TableHead numeric>Input</TableHead>
                <TableHead numeric>Output</TableHead>
                <TableHead numeric>Cache read</TableHead>
                <TableHead numeric>Cache write</TableHead>
                <TableHead numeric>Credits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{String(c.SERVICE_TYPE)}</TableCell>
                  <TableCell className="font-mono text-xs">{String(c.MODEL)}</TableCell>
                  <TableCell numeric>{formatNumber(c.STEPS)}</TableCell>
                  <TableCell numeric>{formatNumber(c.TOKENS_INPUT)}</TableCell>
                  <TableCell numeric>{formatNumber(c.TOKENS_OUTPUT)}</TableCell>
                  <TableCell numeric>{formatNumber(c.TOKENS_CACHE_READ)}</TableCell>
                  <TableCell numeric>{formatNumber(c.TOKENS_CACHE_WRITE)}</TableCell>
                  <TableCell numeric>{formatNumber(c.CREDITS, 6)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {traceTok !== null && billedTok !== null && traceTok !== billedTok && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Event-table tokens ({formatNumber(traceTok)}) differ from billed tokens ({formatNumber(billedTok)}); events are best-effort.
            </p>
          )}
        </>
      )}
    </DataCard>
  );
}

