import { describe, expect, it } from 'vitest';
import { DOC_SECTIONS, VARIABLES_SQL } from '../../lib/docs';
import { NAV_ITEMS } from '../../lib/constants';

describe('docs content', () => {
  const queries = DOC_SECTIONS.flatMap((s) => s.queries);

  it('has unique section and query ids', () => {
    const ids = DOC_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const qids = queries.map((q) => q.id);
    expect(new Set(qids).size).toBe(qids.length);
  });

  it('documents every page in the nav', () => {
    const titles = DOC_SECTIONS.map((s) => s.title.toLowerCase()).join(' | ');
    for (const page of NAV_ITEMS.filter((n) => n.href !== '/docs')) {
      const name = page.label.toLowerCase().replace('trends', 'conversation trends').replace('threads', 'threads & traces');
      expect(titles).toContain(name);
    }
  });

  it('only uses variables that the variables block sets', () => {
    const declared = new Set([...VARIABLES_SQL.matchAll(/SET\s+(\w+)\s*=/g)].map((m) => m[1]));
    for (const q of queries) {
      const local = new Set([...q.sql.matchAll(/SET\s+(\w+)\s*=/g)].map((m) => m[1]));
      for (const m of q.sql.matchAll(/\$([a-z_]+)\b/g)) {
        expect(declared.has(m[1]) || local.has(m[1]), `${q.id} uses $${m[1]}`).toBe(true);
      }
    }
  });

  it('core queries read Snowflake metadata, not the mart', () => {
    for (const q of queries.filter((x) => x.source === 'core')) {
      expect(q.sql, q.id).not.toMatch(/AGENT_OBS\.(MART|CORE|RAW)\./);
    }
  });
});
