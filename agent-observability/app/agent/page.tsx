import { AgentView } from '@/components/obs/agent';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function AgentPage() {
  return (
    <Suspense>
      <AgentView />
    </Suspense>
  );
}
