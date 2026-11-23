import { AutomationsView } from '@/components/obs/automations';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense>
      <AutomationsView />
    </Suspense>
  );
}
