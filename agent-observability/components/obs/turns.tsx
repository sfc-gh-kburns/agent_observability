'use client';

import { DataCard, Hidden } from '@/components/obs/common';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { bool, num, useFilters, useQ, withDays } from '@/lib/use-q';
import Link from 'next/link';

export function TurnTable({
  title,
  agent,
  failed = false,
  limit = 50,
  q,
}: {
  title: string;
  agent?: string | null;
  failed?: boolean;
  limit?: number;
  q?: string | null;
}) {
  const { days } = useFilters();
  const query = useQ('turns', { days, agent, failed: failed ? 1 : 0, limit, q });
  return (
    <DataCard title={title} query={query} contentClassName="p-0" empty={failed ? 'No failed turns in this range' : 'No turns'}>
      {(rows) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started (UTC)</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>User</TableHead>
              {!agent && <TableHead>Agent</TableHead>}
              <TableHead>Interface</TableHead>
              <TableHead numeric>Credits</TableHead>
              <TableHead numeric>Latency</TableHead>
              <TableHead numeric>Steps</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.TURN_ID)}>
                <TableCell className="whitespace-nowrap">{formatDateTime(r.START_TIME_UTC)}</TableCell>
                <TableCell className="max-w-[22rem]">
                  <Link href={withDays('/thread', days, { id: String(r.THREAD_ID), turn: String(r.TURN_ID) })} className="block truncate hover:underline">
                    {r.QUESTION ? String(r.QUESTION) : <Hidden label={`turn ${r.TURN_NUMBER ?? ''}`} />}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{String(r.USER_NAME ?? '—')}</TableCell>
                {!agent && <TableCell className="max-w-[12rem] truncate">{String(r.AGENT_DISPLAY_NAME ?? r.AGENT_FQN ?? '(no agent object)')}</TableCell>}
                <TableCell><Badge variant="outline">{String(r.INTERFACE)}</Badge></TableCell>
                <TableCell numeric>{formatNumber(r.COMBINED_CREDITS, 4)}</TableCell>
                <TableCell numeric>{formatDuration(r.DURATION_MS)}</TableCell>
                <TableCell numeric>{formatNumber(r.PLANNING_STEPS)}</TableCell>
                <TableCell className="space-x-1 whitespace-nowrap">
                  {bool(r.IS_SUCCESS) ? <Badge variant="success">ok</Badge> : <Badge variant="destructive">failed</Badge>}
                  {(num(r.SQL_ERRORS) ?? 0) > 0 && <Badge variant="warning">{String(r.SQL_ERRORS)} SQL err</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}
