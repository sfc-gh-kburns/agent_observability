import { ThreadsView } from '@/components/obs/threads';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function ThreadsPage() {
  return (
    <Suspense>
      <ThreadsView />
    </Suspense>
  );
}
