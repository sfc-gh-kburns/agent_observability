'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export type Row = Record<string, unknown>;

/** Fetch a named MART query (see lib/queries.ts) through /api/q/<name>. */
export function useQ(name: string, params: Record<string, string | number | null | undefined> = {}, enabled = true) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v));
  const qs = sp.toString();
  return useQuery<Row[]>({
    queryKey: ['q', name, qs],
    enabled,
    queryFn: async () => {
      const r = await fetch(`/api/q/${name}${qs ? `?${qs}` : ''}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
      return body.rows as Row[];
    },
  });
}

/** Global filters live in the URL so every view is a shareable deep link. */
export function useFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const days = Number(sp.get('days') ?? 30) || 30;
  const agent = sp.get('agent');
  const set = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return { days, agent, set, sp };
}

/** Build a link that keeps the current time range. */
export function withDays(href: string, days: number, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams({ days: String(days), ...extra });
  return `${href}?${sp.toString()}`;
}

export const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
export const bool = (v: unknown) => v === true || String(v).toLowerCase() === 'true';
export const arr = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};
export const obj = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return p && typeof p === 'object' ? p : null;
    } catch {
      return null;
    }
  }
  return null;
};
