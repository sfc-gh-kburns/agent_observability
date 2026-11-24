'use client';

import { Button } from '@/components/ui/button';
import {
  ERD_DIAGRAMS, ERD_SIZE, anchorY, entityColumns, layoutDiagram,
  type Box, type ErdDiagram, type ErdEntity, type ErdRelation,
} from '@/lib/erd';
import { cn } from '@/lib/utils';
import { Check, ClipboardCopy, Download, Maximize2, Minimize2, Minus, Plus, Scan, Tag, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';

type View = { x: number; y: number; k: number };
const MIN_K = 0.12;
const MAX_K = 3;
const PAD = 60;

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Cubic path between two boxes, leaving and entering on the facing sides. */
function edgeGeometry(a: Box, ay: number, b: Box, by: number) {
  let x1: number, x2: number, s1: number, s2: number;
  if (b.x > a.x + a.w) { x1 = a.x + a.w; x2 = b.x; s1 = 1; s2 = -1; }
  else if (b.x + b.w < a.x) { x1 = a.x; x2 = b.x + b.w; s1 = -1; s2 = 1; }
  else { x1 = a.x + a.w; x2 = b.x + b.w; s1 = 1; s2 = 1; } // same column: loop out to the right
  const dx = s1 === s2 ? 70 + Math.abs(by - ay) * 0.15 : Math.max(50, Math.abs(x2 - x1) / 2);
  const c1 = { x: x1 + s1 * dx, y: ay };
  const c2 = { x: x2 + s2 * dx, y: by };
  const mid = { x: (x1 + 3 * c1.x + 3 * c2.x + x2) / 8, y: (ay + 3 * ay + 3 * by + by) / 8 };
  return { d: `M${x1},${ay} C${c1.x},${c1.y} ${c2.x},${c2.y} ${x2},${by}`, x1, x2, y1: ay, y2: by, s1, s2, mid };
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {done ? 'Copied' : label}
    </Button>
  );
}

export function ErdExplorer() {
  const [active, setActive] = useState(ERD_DIAGRAMS[0].id);
  const [full, setFull] = useState(false);
  const d = ERD_DIAGRAMS.find((x) => x.id === active) ?? ERD_DIAGRAMS[0];
  const tabs = (
    <div role="tablist" aria-label="Diagrams" className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1">
      {ERD_DIAGRAMS.map((x) => (
        <button
          key={x.id}
          role="tab"
          aria-selected={x.id === active}
          onClick={() => setActive(x.id)}
          className={cn('rounded-md px-3 py-1.5 text-sm', x.id === active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {x.title}
        </button>
      ))}
    </div>
  );
  return (
    <div className="space-y-3">
      {!full && tabs}
      <p className="text-sm text-muted-foreground">{d.description}</p>
      <ErdCanvas key={d.id} diagram={d} full={full} setFull={setFull} tabs={full ? tabs : null} />
    </div>
  );
}

function ErdCanvas({ diagram, full, setFull, tabs }: { diagram: ErdDiagram; full: boolean; setFull: (f: boolean | ((v: boolean) => boolean)) => void; tabs: ReactNode }) {
  const boxes = useMemo(() => layoutDiagram(diagram), [diagram]);
  const byId = useMemo(() => new Map(diagram.entities.map((e) => [e.id, e])), [diagram]);
  const color = useMemo(() => new Map(diagram.groups.map((g) => [g.id, g.color])), [diagram]);
  const bounds = useMemo(() => {
    const all = [...boxes.values()];
    const minX = Math.min(...all.map((b) => b.x)) - PAD;
    const minY = Math.min(...all.map((b) => b.y)) - PAD - (diagram.columns ? 30 : 0);
    const maxX = Math.max(...all.map((b) => b.x + b.w)) + PAD + 90; // room for same-column loops
    const maxY = Math.max(...all.map((b) => b.y + b.h)) + PAD;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [boxes, diagram.columns]);

  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 620 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [labels, setLabels] = useState(false);
  const fitted = useRef(false);

  // Leave room for the toolbar (top) and legend (bottom) when fitting.
  const fit = useCallback(() => {
    const top = 56, bottom = 44;
    const h = Math.max(100, size.h - top - bottom);
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(size.w / bounds.w, h / bounds.h)));
    setView({ k, x: (size.w - bounds.w * k) / 2 - bounds.x * k, y: top + (h - bounds.h * k) / 2 - bounds.y * k });
  }, [bounds, size]);

  const focusOn = useCallback((id: string) => {
    const b = boxes.get(id);
    if (!b) return;
    setView((v) => {
      const k = Math.max(v.k, 0.8);
      return { k, x: size.w / 2 - (b.x + b.w / 2) * k, y: size.h / 2 - (b.y + b.h / 2) * k };
    });
  }, [boxes, size]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (!fitted.current && size.w > 0) { fit(); fitted.current = true; } }, [fit, size]);
  useEffect(() => { fit(); }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zooms around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top;
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { if (full) setFull(false); else setSelected(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, setFull]);

  const zoomBy = (f: number) => setView((v) => {
    const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
    const cx = size.w / 2, cy = size.h / 2;
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  });

  // Drag to pan; a click that didn't move selects.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; hit: string | null } | null>(null);
  const onDown = (ev: RPointerEvent) => {
    if ((ev.target as Element).closest('[data-overlay]')) return;
    const hit = (ev.target as Element).closest('[data-entity]')?.getAttribute('data-entity') ?? null;
    drag.current = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false, hit };
    try { (ev.currentTarget as Element).setPointerCapture(ev.pointerId); } catch { /* pointer already released */ }
  };
  const onMove = (ev: RPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    if (g.moved) setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
  };
  const onUp = () => {
    const g = drag.current;
    drag.current = null;
    if (!g || g.moved) return;
    setSelected(g.hit);
  };

  // What to emphasise: the selection and its neighbours, or search matches.
  const q = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return new Set(diagram.entities.filter((e) =>
      e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
      || entityColumns(e).some(([n]) => n.toLowerCase().includes(q)) || e.keys.some((k) => k.c.toLowerCase().includes(q))).map((e) => e.id));
  }, [q, diagram]);
  const neighbours = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const r of diagram.relations) {
      if (r.from.e === selected) s.add(r.to.e);
      if (r.to.e === selected) s.add(r.from.e);
    }
    return s;
  }, [selected, diagram]);
  const lit = neighbours ?? matches;
  const edgeLit = (r: ErdRelation, i: number) => hoverEdge === i || (selected ? r.from.e === selected || r.to.e === selected : !!matches && matches.has(r.from.e) && matches.has(r.to.e));

  const downloadSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    clone.setAttribute('width', String(Math.round(bounds.w)));
    clone.setAttribute('height', String(Math.round(bounds.h)));
    clone.querySelector('[data-viewport]')?.removeAttribute('transform');
    const css = getComputedStyle(document.documentElement);
    const body = new XMLSerializer().serializeToString(clone)
      .replace(/var\((--[\w-]+)\)/g, (_, name: string) => css.getPropertyValue(name).trim() || '#888');
    const bg = css.getPropertyValue('--background').trim() || '#fff';
    const out = body.replace('<svg', `<svg style="background:${bg}"`);
    const url = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-observability-${diagram.id}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sel = selected ? byId.get(selected) : undefined;
  const columnHeads = useMemo(() => {
    if (!diagram.columns) return [];
    const xs = new Map<number, Box>();
    for (const e of diagram.entities) { const b = boxes.get(e.id)!; if (!xs.has(e.col)) xs.set(e.col, b); }
    const top = Math.min(...[...boxes.values()].map((b) => b.y));
    return [...xs.entries()].map(([c, b]) => ({ c, x: b.x + b.w / 2, y: top - 26, text: diagram.columns![c] ?? '' }));
  }, [boxes, diagram]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-background',
        full ? 'fixed inset-0 z-50 rounded-none border-0' : 'h-[720px]',
      )}
    >
      <div
        ref={wrap}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      >
        <svg ref={svgRef} width={size.w} height={size.h} xmlns="http://www.w3.org/2000/svg" fontFamily="ui-sans-serif, system-ui, sans-serif" role="img" aria-label={`${diagram.title} diagram`}>
          <defs>
            <marker id={`arrow-${diagram.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          <g data-viewport transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {columnHeads.map((h) => (
              <text key={h.c} x={h.x} y={h.y} textAnchor="middle" fontSize={13} fontWeight={600} letterSpacing={0.6} fill="var(--muted-foreground)">
                {h.text.toUpperCase()}
              </text>
            ))}

            {/* Edges under boxes */}
            {diagram.relations.map((r, i) => {
              const a = byId.get(r.from.e), b = byId.get(r.to.e);
              const ba = boxes.get(r.from.e), bb = boxes.get(r.to.e);
              if (!a || !b || !ba || !bb) return null;
              const g = edgeGeometry(ba, anchorY(a, ba, r.from.c), bb, anchorY(b, bb, r.to.c));
              const on = edgeLit(r, i);
              const dim = !!lit && !on;
              return (
                <g key={i} opacity={dim ? 0.12 : 1} onPointerEnter={() => setHoverEdge(i)} onPointerLeave={() => setHoverEdge((h) => (h === i ? null : h))}>
                  <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} />
                  <path
                    d={g.d}
                    fill="none"
                    stroke={on ? 'var(--foreground)' : 'var(--muted-foreground)'}
                    strokeOpacity={on ? 0.9 : 0.55}
                    strokeWidth={on ? 2 : 1.25}
                    strokeDasharray={r.kind === 'loose' ? '6 5' : undefined}
                    markerEnd={r.kind === 'flow' ? `url(#arrow-${diagram.id})` : undefined}
                  />
                  {r.card && (
                    <>
                      <text x={g.x1 + g.s1 * 10} y={g.y1 - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--muted-foreground)">{r.card[0]}</text>
                      <text x={g.x2 + g.s2 * 10} y={g.y2 - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--muted-foreground)">{r.card[1]}</text>
                    </>
                  )}
                  {(labels || hoverEdge === i || (selected && on)) && (
                    <text x={g.mid.x} y={g.mid.y - 6} textAnchor="middle" fontSize={11} fill="var(--foreground)" stroke="var(--background)" strokeWidth={4} paintOrder="stroke">
                      {shorten(r.label, 70)}
                    </text>
                  )}
                </g>
              );
            })}

            {diagram.entities.map((e) => {
              const b = boxes.get(e.id)!;
              const c = color.get(e.group) ?? 'var(--muted-foreground)';
              const dim = !!lit && !lit.has(e.id);
              return (
                <EntityBox key={e.id} e={e} b={b} color={c} dim={dim} selected={selected === e.id} match={!!matches?.has(e.id)} q={q} />
              );
            })}
          </g>
        </svg>
      </div>

      {/* Toolbar */}
      <div data-overlay className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card/95 p-1.5 shadow-sm backdrop-blur">
        <input
          aria-label="Find a table or column"
          placeholder="Find table or column…"
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && matches?.size) focusOn([...matches][0]); }}
          className="h-8 w-48 rounded-md border bg-background px-2 text-xs"
        />
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus className="h-4 w-4" /></Button>
        <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">{Math.round(view.k * 100)}%</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={fit} title="Fit the whole diagram"><Scan className="h-4 w-4" /> Fit</Button>
        <Button size="sm" variant={labels ? 'secondary' : 'ghost'} className="h-8" onClick={() => setLabels((v) => !v)} title="Show every join label"><Tag className="h-4 w-4" /> Labels</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Download SVG" title="Download as SVG" onClick={downloadSvg}><Download className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFull((v) => !v)}>
          {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      {tabs && <div data-overlay className="absolute right-3 top-3">{tabs}</div>}

      {/* Legend */}
      <div data-overlay className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
        {diagram.groups.filter((g) => diagram.entities.some((e) => e.group === g.id)).map((g) => (
          <span key={g.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />{g.label}</span>
        ))}
        {diagram.relations.some((r) => r.kind === 'join') && <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" /></svg>join on key</span>}
        {diagram.relations.some((r) => r.kind === 'loose') && <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" /></svg>matched by time / parsed text</span>}
        {diagram.relations.some((r) => r.kind === 'flow') && <span className="inline-flex items-center gap-1.5"><svg width="22" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="1.5" /><path d="M16,0 L22,4 L16,8 z" fill="currentColor" /></svg>feeds</span>}
        {diagram.relations.some((r) => r.card) && <span>N / 1 = cardinality</span>}
        <span className="hidden sm:inline">· Scroll to zoom · drag to pan · click a table</span>
      </div>

      {sel && <DetailPanel e={sel} diagram={diagram} onSelect={(id) => { setSelected(id); focusOn(id); }} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EntityBox({ e, b, color, dim, selected, match, q }: { e: ErdEntity; b: Box; color: string; dim: boolean; selected: boolean; match: boolean; q: string }) {
  const cols = entityColumns(e);
  const types = new Map(cols);
  const more = cols.length - e.keys.length;
  const schema = e.fqn ? e.fqn.split('.').slice(0, -1).join('.') : e.id.includes('.') ? e.id.split('.').slice(0, -1).join('.') : '';
  return (
    <g data-entity={e.id} transform={`translate(${b.x},${b.y})`} opacity={dim ? 0.2 : 1} style={{ cursor: 'pointer' }}>
      <title>{`${e.fqn ?? e.label}\n${e.description}`}</title>
      <rect width={b.w} height={b.h} rx={10} fill="var(--card)" stroke={selected || match ? color : 'var(--border)'} strokeWidth={selected ? 2.5 : match ? 2 : 1} />
      <rect width={b.w} height={e.compact ? b.h : ERD_SIZE.header - 6} rx={10} fill={color} fillOpacity={0.12} />
      {!e.compact && <rect y={ERD_SIZE.header - 16} width={b.w} height={10} fill={color} fillOpacity={0.12} />}
      <rect width={5} height={b.h} rx={2} fill={color} />
      <text x={14} y={e.compact ? 17 : 19} fontSize={e.compact ? 12.5 : 13.5} fontWeight={700} fill="var(--foreground)">{shorten(e.label, e.compact ? 30 : 32)}</text>
      <text x={14} y={e.compact ? 31 : 34} fontSize={10.5} fill="var(--muted-foreground)">
        {shorten([e.kind, schema].filter(Boolean).join(' · '), e.compact ? 40 : 46)}
      </text>
      {!e.compact && e.keys.map((k, i) => {
        const y = ERD_SIZE.header + i * ERD_SIZE.row;
        const t = k.path ? 'json path' : (types.get(k.c) ?? '').toLowerCase().replace('timestamp_', 'ts_');
        const hit = !!q && k.c.toLowerCase().includes(q);
        return (
          <g key={k.c} transform={`translate(0,${y})`}>
            {hit && <rect x={6} y={1} width={b.w - 12} height={ERD_SIZE.row - 2} rx={4} fill={color} fillOpacity={0.18} />}
            {k.r && (
              <>
                <rect x={12} y={5} width={22} height={13} rx={3} fill={k.r === 'pk' ? color : 'none'} fillOpacity={k.r === 'pk' ? 0.85 : 0} stroke={color} />
                <text x={23} y={15} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={k.r === 'pk' ? 'var(--card)' : color}>{k.r.toUpperCase()}</text>
              </>
            )}
            <text x={42} y={15} fontSize={12} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontStyle={k.path ? 'italic' : undefined} fill="var(--foreground)">
              {shorten(k.c, t.length > 10 ? 22 : 26)}
            </text>
            <text x={b.w - 10} y={15} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{shorten(t, 12)}</text>
          </g>
        );
      })}
      {!e.compact && more > 0 && (
        <text x={14} y={b.h - 8} fontSize={10.5} fill="var(--muted-foreground)">+ {more} more column{more === 1 ? '' : 's'} · click for all</text>
      )}
    </g>
  );
}

function DetailPanel({ e, diagram, onSelect, onClose }: { e: ErdEntity; diagram: ErdDiagram; onSelect: (id: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const cols = entityColumns(e);
  const keyRole = new Map(e.keys.map((k) => [k.c, k.r]));
  const rels = diagram.relations.filter((r) => r.from.e === e.id || r.to.e === e.id);
  const label = (id: string) => diagram.entities.find((x) => x.id === id)?.label ?? id;
  const f = filter.trim().toLowerCase();
  return (
    <aside data-overlay className="absolute bottom-3 right-3 top-3 flex w-[22rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border bg-card shadow-lg" onPointerDown={(ev) => ev.stopPropagation()}>
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{e.label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{e.fqn ?? e.id}</p>
          <p className="text-[11px] text-muted-foreground">{e.kind}</p>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        <p className="text-muted-foreground">{e.description}</p>
        {e.fqn && !e.fqn.includes('*') && (
          <div className="flex flex-wrap gap-1.5">
            <CopyText label="Copy name" text={e.fqn} />
            <CopyText label="Copy SELECT" text={`SELECT * FROM ${e.fqn} LIMIT 100;`} />
          </div>
        )}
        {e.exposedAs && e.exposedAs.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exposed to the app as</p>
            <p className="font-mono text-xs">{e.exposedAs.join(', ')}</p>
          </div>
        )}
        {rels.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{diagram.relations[0]?.kind === 'flow' ? 'Feeds / fed by' : 'Relationships'} ({rels.length})</p>
            <ul className="space-y-1.5">
              {rels.map((r, i) => {
                const other = r.from.e === e.id ? r.to.e : r.from.e;
                const out = r.from.e === e.id;
                return (
                  <li key={i} className="text-xs">
                    <button type="button" className="font-medium hover:underline" onClick={() => onSelect(other)}>
                      {r.kind === 'flow' ? (out ? '→ ' : '← ') : ''}{label(other)}
                    </button>
                    <span className="block text-muted-foreground">{r.card ? `${out ? r.card[0] : r.card[1]}:${out ? r.card[1] : r.card[0]} · ` : ''}{r.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {cols.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns ({cols.length})</p>
              <input aria-label="Filter columns" placeholder="filter" value={filter} onChange={(ev) => setFilter(ev.target.value)} className="h-6 w-28 rounded border bg-background px-1.5 text-xs" />
            </div>
            <table className="w-full text-xs">
              <tbody>
                {cols.filter(([n]) => !f || n.toLowerCase().includes(f)).map(([n, t]) => (
                  <tr key={n} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono">
                      {keyRole.get(n) && <span className="mr-1 rounded bg-muted px-1 text-[9px] font-bold">{keyRole.get(n)!.toUpperCase()}</span>}
                      {n}
                    </td>
                    <td className="py-1 text-right text-muted-foreground">{t.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {e.keys.some((k) => k.path) && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">JSON paths used</p>
            <ul className="space-y-1 font-mono text-[11px] text-muted-foreground">
              {e.keys.filter((k) => k.path).map((k) => <li key={k.c} className="break-all">{k.path}</li>)}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
