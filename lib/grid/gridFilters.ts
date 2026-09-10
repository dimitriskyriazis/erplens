/**
 * Translates AG Grid server-side row model requests into parameterised T-SQL.
 *
 * Every column id that reaches SQL text is resolved through a whitelist
 * (ColumnExpressions). An unknown id is dropped, never bracketed: `[` plus an
 * attacker-chosen string closes the identifier and appends statements. Values
 * always travel as parameters.
 */
import type { QueryParam } from '../sql';
import type { KnownFilterModel } from './filterTypes';
import { processFilter } from './filterProcessing';
import { collateSearch } from './textSearch';

export type { QueryParam };

/** colId -> SQL expression valid in WHERE and ORDER BY of the relation being queried. */
export type ColumnExpressions = Record<string, string>;

export type QuickFilterColumn = { colId: string; expression: string };

export type SortModelItem = { colId: string; sort: 'asc' | 'desc' };

export type TextMatchMode = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith' | 'notEqual';

/**
 * NVARCHAR(4000), not MAX: casting to MAX makes every UPPER/LIKE a LOB operation,
 * which FastQuote measured at roughly 45% of quick-search CPU.
 */
const TEXT_MATCH_MAX_CHARS = 4000;

const safeText = (expression: string) =>
  `LTRIM(RTRIM(COALESCE(CAST(${expression} AS NVARCHAR(${TEXT_MATCH_MAX_CHARS})), '')))`;

export function buildTextMatchPredicate(
  expression: string,
  term: string,
  options: { paramKey: string; mode?: TextMatchMode },
): { clause: string; params: QueryParam[] } {
  const mode = options.mode ?? 'contains';
  const upper = term.trim().toUpperCase();
  if (!upper) return { clause: '', params: [] };
  const ciExpr = collateSearch(`UPPER(${safeText(expression)})`);

  let value = upper;
  if (mode === 'contains' || mode === 'notContains') value = `%${upper}%`;
  if (mode === 'startsWith') value = `${upper}%`;
  if (mode === 'endsWith') value = `%${upper}`;

  const operator =
    mode === 'equals' ? '=' : mode === 'notEqual' ? '<>' : mode === 'notContains' ? 'NOT LIKE' : 'LIKE';

  return {
    clause: `${ciExpr} ${operator} @${options.paramKey}`,
    params: [{ key: options.paramKey, value }],
  };
}

/**
 * One predicate for the grid's free-text box: every whitespace-separated term must
 * match at least one of the given columns. Returns '' when there is nothing to do.
 */
export function buildQuickFilterClause(
  quickFilterText: string | null | undefined,
  columns: QuickFilterColumn[],
  paramPrefix = 'qf',
): { clause: string; params: QueryParam[] } {
  const terms = (quickFilterText ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0 || columns.length === 0) return { clause: '', params: [] };

  const params: QueryParam[] = [];
  const perTerm = terms.map((term, termIdx) => {
    const perColumn = columns.map((col, colIdx) => {
      const { clause, params: p } = buildTextMatchPredicate(col.expression, term, {
        paramKey: `${paramPrefix}_${termIdx}_${colIdx}`,
        mode: 'contains',
      });
      params.push(...p);
      return clause;
    });
    return `(${perColumn.join(' OR ')})`;
  });
  return { clause: `(${perTerm.join(' AND ')})`, params };
}

/** Column filters from the grid, one predicate per whitelisted column. */
export function buildFilterPredicates(
  filterModel: Record<string, unknown> | null | undefined,
  columns: ColumnExpressions,
  options?: { preserveTime?: boolean },
): { predicates: string[]; params: QueryParam[] } {
  const predicates: string[] = [];
  const params: QueryParam[] = [];
  if (!filterModel) return { predicates, params };

  Object.entries(filterModel).forEach(([colId, model], idx) => {
    const columnExpression = columns[colId];
    if (!columnExpression || !model || typeof model !== 'object') return;
    const result = processFilter(model as KnownFilterModel, {
      columnExpression,
      columnId: colId,
      paramBase: `f${idx}`,
      preserveTime: options?.preserveTime,
    });
    if (result.clause) {
      predicates.push(result.clause);
      params.push(...result.params);
    }
  });
  return { predicates, params };
}

/** ORDER BY from the grid's sort model; falls back to `fallback` (already an expression list). */
export function buildOrderBy(
  sortModel: SortModelItem[] | null | undefined,
  columns: ColumnExpressions,
  fallback: string,
): string {
  const parts = (sortModel ?? []).flatMap((s) => {
    const expression = columns[s.colId];
    if (!expression) return [];
    return [`${expression} ${s.sort === 'desc' ? 'DESC' : 'ASC'}`];
  });
  return `ORDER BY ${parts.length ? parts.join(', ') : fallback}`;
}

export function composeWhere(predicates: string[]): string {
  const live = predicates.map((p) => p.trim()).filter(Boolean);
  return live.length ? `WHERE ${live.join(' AND ')}` : '';
}
