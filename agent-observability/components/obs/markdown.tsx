'use client';

import { cn } from '@/lib/utils';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Agent responses embed result tables as `[table] ```json {columns, data} ``` [/table]`; render them as GFM tables. */
export function agentMarkdown(text: string): string {
  return text.replace(/\[table\]\s*```(?:json)?\s*([\s\S]*?)```\s*\[\/table\]/g, (whole, json: string) => {
    try {
      const t = JSON.parse(json) as { columns?: string[]; data?: unknown[][] };
      if (!t.columns?.length || !Array.isArray(t.data)) return whole;
      const esc = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const rows = t.data.slice(0, 50).map((r) => `| ${r.map(esc).join(' | ')} |`);
      const more = t.data.length > 50 ? `\n\n_${t.data.length - 50} more rows_` : '';
      return `\n| ${t.columns.map(esc).join(' | ')} |\n|${t.columns.map(() => '---').join('|')}|\n${rows.join('\n')}${more}\n`;
    } catch {
      return whole;
    }
  });
}

export function Markdown({ text, collapsible = false }: { text: string; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible || text.length < 1200);
  return (
    <div className="min-w-0">
      <div
        className={cn(
          'prose-obs min-w-0 break-words text-sm',
          !open && 'max-h-48 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]',
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentMarkdown(text)}</ReactMarkdown>
      </div>
      {collapsible && text.length >= 1200 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-xs font-medium text-primary hover:underline">
          {open ? 'Show less' : 'Show full response'}
        </button>
      )}
    </div>
  );
}
