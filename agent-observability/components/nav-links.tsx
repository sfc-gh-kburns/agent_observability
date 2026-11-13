'use client';

import { NAV_ITEMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** Header nav; carries the current time range across pages. */
export function NavLinks() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const days = sp.get('days');
  return (
    <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
      {NAV_ITEMS.map((n) => {
        const active = n.href === '/' ? pathname === '/' || pathname === '/agent' : pathname.startsWith(n.href) || (n.href === '/threads' && pathname === '/thread');
        return (
          <Link
            key={n.href}
            href={days ? `${n.href}?days=${days}` : n.href}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-sm transition-colors',
              active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
