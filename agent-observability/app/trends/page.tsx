import { TrendsView } from '@/components/obs/trends';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense>
      <TrendsView />
    </Suspense>
  );
}
