import { AssetsView } from '@/components/obs/catalogs';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense>
      <AssetsView />
    </Suspense>
  );
}
