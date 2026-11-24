import { describe, expect, it } from 'vitest';
import { ERD_DIAGRAMS, entityColumns, layoutDiagram } from '../../lib/erd';

describe('ERD diagrams', () => {
  for (const d of ERD_DIAGRAMS) {
    describe(d.title, () => {
      const ids = new Set(d.entities.map((e) => e.id));

      it('has unique entities and every relation points at one', () => {
        expect(ids.size).toBe(d.entities.length);
        for (const r of d.relations) {
          expect(ids.has(r.from.e), `${r.from.e}`).toBe(true);
          expect(ids.has(r.to.e), `${r.to.e}`).toBe(true);
        }
      });

      it('only lists key columns that exist on the object', () => {
        for (const e of d.entities) {
          const cols = new Set(entityColumns(e).map(([n]) => n));
          for (const k of e.keys) {
            if (k.path) {
              // JSON paths must start from a real VARIANT column (or an agent_spec field for DESCRIBE output).
              const base = k.path.split(':')[0];
              if (cols.size) expect(cols.has(base), `${e.id}: ${k.path}`).toBe(true);
            } else if (cols.size) {
              expect(cols.has(k.c), `${e.id}.${k.c}`).toBe(true);
            }
          }
        }
      });

      it('anchors each join on a listed key column', () => {
        const byId = new Map(d.entities.map((e) => [e.id, e]));
        for (const r of d.relations) {
          for (const end of [r.from, r.to]) {
            if (end.c) expect(byId.get(end.e)!.keys.some((k) => k.c === end.c), `${end.e}.${end.c}`).toBe(true);
          }
        }
      });

      it('lays out without overlapping boxes', () => {
        const boxes = [...layoutDiagram(d).values()];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap).toBe(false);
          }
        }
      });
    });
  }

  it('real objects in the model diagrams have column metadata', () => {
    for (const d of ERD_DIAGRAMS.filter((x) => x.id !== 'flow')) {
      for (const e of d.entities.filter((x) => x.fqn)) expect(entityColumns(e).length, e.fqn).toBeGreaterThan(0);
    }
  });
});
