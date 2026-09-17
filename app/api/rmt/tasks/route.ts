import { readQuery } from '@/lib/sql';
import { formatDbDateTime } from '@/lib/dbDates';
import { readGridRequest, pageWindow } from '@/lib/grid/gridRequest';
import { buildFilterPredicates, buildOrderBy, buildQuickFilterClause, composeWhere } from '@/lib/grid/gridFilters';
import {
  RMT_TASKS_COLUMNS,
  RMT_TASKS_DEFAULT_ORDER,
  RMT_TASKS_QUICK_FILTER,
  RMT_TASKS_RELATION,
} from '@/lib/rmt/tasksRelation';

type Row = Record<string, unknown> & { __total?: number | bigint };

const DATE_COLUMNS = ['TaskStart', 'TaskEnd'];

/**
 * Server-side row model endpoint for the RMT tasks grid. Validates the request,
 * composes WHERE / ORDER BY / OFFSET FETCH against the task relation and streams one
 * page back. No business logic lives here: derived columns come from the relation.
 */
export async function POST(req: Request) {
  const parsed = await readGridRequest(req);
  if (!parsed.ok) return parsed.response;
  const request = parsed.request;
  const company = request.company ?? Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1);
  const { offset, limit } = pageWindow(request);

  const filters = buildFilterPredicates(request.filterModel, RMT_TASKS_COLUMNS, { preserveTime: true });
  const quick = buildQuickFilterClause(request.quickFilterText, RMT_TASKS_QUICK_FILTER);
  const where = composeWhere(['v.COMPANY = @company', ...filters.predicates, quick.clause]);
  const orderBy = buildOrderBy(request.sortModel, RMT_TASKS_COLUMNS, RMT_TASKS_DEFAULT_ORDER);

  const text = `
SELECT COUNT_BIG(1) OVER () AS __total, v.*
FROM ${RMT_TASKS_RELATION}
${where}
${orderBy}
OFFSET @__offset ROWS FETCH NEXT @__limit ROWS ONLY`;

  try {
    const rows = await readQuery<Row>(text, [
      { key: 'company', value: company },
      ...filters.params,
      ...quick.params,
      { key: '__offset', value: offset },
      { key: '__limit', value: limit },
    ]);
    const rowCount = rows.length ? Number(rows[0].__total ?? 0) : 0;
    const data = rows.map((row) => {
      const { __total, ...rest } = row;
      void __total;
      for (const col of DATE_COLUMNS) rest[col] = formatDbDateTime(rest[col]);
      return rest;
    });
    return Response.json({ ok: true, rows: data, rowCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/rmt/tasks] query failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Query failed' : message;
    return Response.json({ ok: false, error: exposed }, { status: 500 });
  }
}

