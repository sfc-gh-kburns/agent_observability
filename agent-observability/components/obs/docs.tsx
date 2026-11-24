'use client';

import { ErdExplorer } from '@/components/obs/erd';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DOC_SECTIONS, VARIABLES_SQL, type DocQuery, type DocSection } from '@/lib/docs';
import { Check, ClipboardCopy } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {done ? 'Copied' : label}
    </Button>
  );
}

function SqlBlock({ sql }: { sql: string }) {
  return <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{sql}</pre>;
}

function QueryCard({ q }: { q: DocQuery }) {
  return (
    <div id={`q-${q.id}`} className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={q.source === 'core' ? 'success' : 'secondary'} title={q.source === 'core' ? 'Reads Snowflake’s own metadata' : 'Reads the AGENT_OBS data mart'}>
              {q.source === 'core' ? 'Core Snowflake' : 'Data mart'}
            </Badge>
            <h4 className="text-sm font-semibold">{q.title}</h4>
          </div>
          <p className="text-xs text-muted-foreground">{q.description}</p>
        </div>
        <CopyButton text={q.source === 'core' && q.sql.includes('$') ? `${VARIABLES_SQL}\n\n${q.sql}` : q.sql} />
      </div>
      <SqlBlock sql={q.sql} />
    </div>
  );
}

function TocLink({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <a href={`#${id}`} className="flex items-center justify-between rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
      <span>{title}</span>
      {count !== undefined && <span className="text-xs tabular-nums">{count}</span>}
    </a>
  );
}

function DataModel() {
  return (
    <section id="data-model" className="scroll-mt-20 space-y-4">
      <div className="border-b pb-2">
        <h2 className="text-xl font-semibold tracking-tight">Data model (ERD)</h2>
      </div>
      <div className="space-y-2 text-sm leading-relaxed">
        <p>
          Three diagrams: the Snowflake metadata this app is built on, the AGENT_OBS model the app queries, and how data flows
          from one to the other. Boxes list the key columns (PK / FK) with their types; click a box for every column, its
          relationships and a ready-made SELECT. Scroll to zoom, drag to pan, and use Full screen for the big picture.
        </p>
        <p className="text-muted-foreground">
          Columns come from INFORMATION_SCHEMA and the data-flow arrows from SNOWFLAKE.CORE.GET_LINEAGE (see “Admin, pipeline &amp; lineage” below to run it yourself).
        </p>
      </div>
      <ErdExplorer />
    </section>
  );
}

function DocSectionBlock({ s, after }: { s: DocSection; after?: ReactNode }) {
  return (
    <>
      <section id={s.id} className="scroll-mt-20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
          {s.queries.length > 0 && (
            <CopyButton
              label={`Copy all ${s.queries.length} queries`}
              text={[VARIABLES_SQL, ...s.queries.map((q) => `-- ${q.title} (${q.source})\n-- ${q.description}\n${q.sql}`)].join('\n\n')}
            />
          )}
        </div>
        <div className="space-y-2 text-sm leading-relaxed">
          {s.intro.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        {s.definitions && s.definitions.length > 0 && (
          <dl className="grid gap-x-4 gap-y-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-[12rem_1fr]">
            {s.definitions.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-medium">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="space-y-3">
          {s.queries.map((q) => <QueryCard key={q.id} q={q} />)}
        </div>
      </section>
      {after}
    </>
  );
}

export function DocsView() {
  const [search, setSearch] = useState('');
  const [onlyCore, setOnlyCore] = useState(false);
  const sections = useMemo(() => {
    const f = search.trim().toLowerCase();
    return DOC_SECTIONS.map((s) => {
      const sectionHit = !f || [s.title, ...s.intro, ...(s.definitions ?? []).flat()].some((t) => t.toLowerCase().includes(f));
      const queries = s.queries.filter((q) => (!onlyCore || q.source === 'core')
        && (sectionHit || [q.title, q.description, q.sql].some((t) => t.toLowerCase().includes(f))));
      return { ...s, queries, visible: sectionHit || queries.length > 0 };
    }).filter((s) => s.visible);
  }, [search, onlyCore]);
  const total = DOC_SECTIONS.reduce((a, s) => a + s.queries.length, 0);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="Docs"
        title="How this app works"
        description={`What each page shows, how every metric is defined, and ${total} ready-to-run queries against Snowflake’s own metadata, so you can check any number or take it further yourself.`}
      />

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav className="space-y-3 lg:sticky lg:top-20 lg:self-start" aria-label="Docs sections">
          <input
            aria-label="Search docs"
            placeholder="Search docs and SQL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border bg-card px-2 text-xs"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={onlyCore} onChange={(e) => setOnlyCore(e.target.checked)} /> Core Snowflake queries only
          </label>
          <ul className="space-y-0.5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <TocLink id={s.id} title={s.title} count={s.queries.length} />
                {s.id === 'getting-started' && !search && <TocLink id="data-model" title="Data model (ERD)" />}
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          <section className="space-y-2 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Variables used by every core query</h3>
              <CopyButton text={VARIABLES_SQL} />
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this into a Snowsight worksheet first and set the values. The Copy button on each core query includes this block,
              so a copied query runs as-is. Event-table timestamps are UTC; ACCOUNT_USAGE timestamps are in your session time zone.
            </p>
            <SqlBlock sql={VARIABLES_SQL} />
          </section>

          {sections.map((s) => (
            <DocSectionBlock key={s.id} s={s} after={s.id === 'getting-started' && !search ? <DataModel /> : null} />
          ))}
          {sections.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches “{search}”.</p>}
        </div>
      </div>
    </main>
  );
}
