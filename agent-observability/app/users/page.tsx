import { EndUsersView } from '@/components/obs/users';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense>
      <EndUsersView />
    </Suspense>
  );
}
