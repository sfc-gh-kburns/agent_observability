import { describe, expect, it } from 'vitest';
import { QUERIES, parseParams } from '../../lib/queries';

const p = parseParams(new URLSearchParams('days=30&agent="DB"."S"."A"&thread=1&trace=t&request=r&q=x&failed=1'));

describe('named MART queries', () => {
  for (const [name, def] of Object.entries(QUERIES)) {
    it(`${name}: placeholder count matches binds`, () => {
      const { sql, binds } = def(p);
      expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
      expect(sql).toContain('AGENT_OBS.MART');
    });
  }

  it('never interpolates user input into SQL', () => {
    const evil = parseParams(new URLSearchParams("q=x' OR 1=1 --&agent=a';DROP TABLE t"));
    for (const def of Object.values(QUERIES)) {
      const { sql } = def(evil);
      expect(sql).not.toContain('OR 1=1');
      expect(sql).not.toContain('DROP TABLE');
    }
  });

  it('clamps numeric params', () => {
    const c = parseParams(new URLSearchParams('days=99999&limit=-5'));
    expect(c.days).toBe(730);
    expect(c.limit).toBe(1);
  });
});
