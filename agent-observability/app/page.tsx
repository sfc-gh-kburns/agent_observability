import { PortfolioView } from '@/components/obs/portfolio';
import { Suspense } from 'react';

// Required: Snowflake is not reachable during docker build.
export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <Suspense>
      <PortfolioView />
    </Suspense>
  );
}
