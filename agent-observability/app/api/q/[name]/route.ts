/**
 * GET /api/q/<name>?days=30&agent=...  — runs one named query from lib/queries.ts.
 *
 * Every query runs with CALLER'S RIGHTS so the AGENT_OBS masking policies
 * evaluate against the viewer (metadata vs content tier). Failures propagate;
 * there is no owner's-rights fallback.
 */
import { CONTENT_QUERIES, QUERIES, parseParams } from '@/lib/queries';
import { withCaller } from '@/lib/run-as';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const def = Object.hasOwn(QUERIES, name) ? QUERIES[name] : undefined;
  if (!def) return Response.json({ error: `Unknown query '${name}'` }, { status: 404 });

  const params = parseParams(new URL(request.url).searchParams);
  try {
    const { sql, binds } = def(params);
    const result = await withCaller(async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(sql, { binds });
      // Content-tier audit: log when the viewer actually received content.
      if (CONTENT_QUERIES.has(name) && rows.length > 0) {
        const visible = await client.query<{ V: unknown }>('SELECT AGENT_OBS.MART.CAN_VIEW_CONTENT() AS V');
        if (String(visible.rows[0]?.V).toLowerCase() === 'true') {
          await client.query('CALL AGENT_OBS.MART.SP_LOG_CONTENT_VIEW(NULL, ?, ?, PARSE_JSON(?))', {
            binds: [name, params.thread ?? params.trace ?? '', JSON.stringify({ rows: rows.length })],
          });
        }
      }
      return { rows };
    });
    return Response.json(result);
  } catch (e) {
    console.error(new Date().toISOString(), `[api/q/${name}] failed`, e);
    // Snowflake's own message is on the innermost `cause`.
    let err: unknown = e;
    while (err instanceof Error && err.cause instanceof Error) err = err.cause;
    return Response.json(
      { error: err instanceof Error ? err.message : 'Query failed' },
      { status: 500 },
    );
  }
}
