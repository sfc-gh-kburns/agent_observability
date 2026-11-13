'use client';

import { AgentFilter, DataCard, Hidden, TimeRange } from '@/components/obs/common';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatNumber } from '@/lib/format';
import { arr, bool, num, useFilters, useQ, withDays } from '@/lib/use-q';
import { Layers, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export function ThreadsView() {
  const { days, agent, sp, set } = useFilters();
  const q = sp.get('q');
  const failed = sp.get('failed') === '1';
  const [text, setText] = useState(q ?? '');
  const threads = useQ('threads', { days, agent, q, failed: failed ? 1 : 0, limit: 200 });

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="Forensic"
        title="Threads & traces"
        description="Search by thread id, request id, user, or question text. Open a thread for the transcript and full span trace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentFilter />
            <TimeRange />
          </div>
        }
      />
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text.trim() || null });
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="thread id, request id, user, or text…"
            className="h-9 w-full rounded-lg border bg-card pl-8 pr-3 text-sm"
          />
        </div>
        <Button type="submit" size="sm">Search</Button>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={failed} onChange={(e) => set({ failed: e.target.checked ? '1' : null })} />
          problems only
        </label>
      </form>

      <DataCard title="Threads" description="Newest first (max 200)" query={threads} contentClassName="p-0" empty="No threads match">
        {(rows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Last updated (UTC)</TableHead>
                <TableHead>First message</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>User</TableHead>
                <TableHead numeric>Turns</TableHead>
                <TableHead numeric>Credits</TableHead>
                <TableHead>Feedback</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r.THREAD_ID)}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.LAST_UPDATED_UTC)}</TableCell>
                  <TableCell className="max-w-[24rem]">
                    <Link href={withDays('/thread', days, { id: String(r.THREAD_ID) })} className="block truncate hover:underline">
                      {r.FIRST_QUESTION ? String(r.FIRST_QUESTION) : <Hidden label={`thread ${r.THREAD_ID}`} />}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate">{String(r.AGENT_DISPLAY_NAME ?? r.FIRST_AGENT_FQN ?? '(no agent object)')}</TableCell>
                  <TableCell className="whitespace-nowrap">{String(r.USER_NAME ?? '—')}</TableCell>
                  <TableCell numeric>
                    {formatNumber(r.TURNS)}
                    {bool(r.IS_MULTI_VERSION) && (
                      <Layers className="ml-1 inline h-3.5 w-3.5 text-warning" aria-label={`versions: ${arr(r.AGENT_VERSIONS).join(', ')}`} />
                    )}
                  </TableCell>
                  <TableCell numeric>{formatNumber(r.COMBINED_CREDITS, 4)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {(num(r.FEEDBACK_POSITIVE) ?? 0) > 0 && <span className="text-success">▲{String(r.FEEDBACK_POSITIVE)} </span>}
                    {(num(r.FEEDBACK_NEGATIVE) ?? 0) > 0 && <span className="text-destructive">▼{String(r.FEEDBACK_NEGATIVE)}</span>}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    {(num(r.FAILED_TURNS) ?? 0) > 0 ? <Badge variant="destructive">{String(r.FAILED_TURNS)} failed</Badge> : <Badge variant="success">ok</Badge>}
                    {(num(r.SQL_ERRORS) ?? 0) > 0 && <Badge variant="warning">{String(r.SQL_ERRORS)} SQL err</Badge>}
                    {r.THREAD_ID_SOURCE !== 'EVENT' && <Badge variant="outline" title="No trace thread id; grouped by fallback key">fallback</Badge>}
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
