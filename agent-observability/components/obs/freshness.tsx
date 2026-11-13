'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatRelative } from '@/lib/format';
import { bool, useQ } from '@/lib/use-q';
import { Clock, EyeOff } from 'lucide-react';

/** Data freshness + content-tier status (R-ING-6). */
export function FreshnessBanner() {
  const f = useQ('freshness');
  const me = useQ('whoami');
  const by = new Map((f.data ?? []).map((r) => [String(r.SOURCE), r]));
  const canView = bool(me.data?.[0]?.CAN_VIEW_CONTENT);
  if (f.isPending) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Alert className="flex-1 py-2">
        <Clock className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Usage data through {formatRelative(by.get('usage')?.DATA_THROUGH)} · events through{' '}
          {formatRelative(by.get('events')?.DATA_THROUGH)} · config snapshot {formatRelative(by.get('agent_config')?.DATA_THROUGH)}.
          Pipeline runs every 12 h; usage views lag ~1 h at source.
        </AlertDescription>
      </Alert>
      {me.data && !canView && (
        <Alert className="py-2 sm:max-w-sm">
          <EyeOff className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Metadata view: questions, responses and SQL are hidden. Ask an admin for AGENT_OBS_CONTENT_ROLE.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
