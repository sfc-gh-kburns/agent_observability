import { ThreadView } from '@/components/obs/thread';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function ThreadPage() {
  return (
    <Suspense>
      <ThreadView />
    </Suspense>
  );
}
