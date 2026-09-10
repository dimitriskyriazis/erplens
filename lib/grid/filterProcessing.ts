import {
  type TextFilterModel,
  type NumberFilterModel,
  type DateFilterModel,
  type SetFilterModel,
  type KnownFilterModel,
  type TextCondition,
  type NumberCondition,
  type DateCondition,
  isCompoundFilter,
  getCompoundFilterConditions,
} from './filterTypes';
import { buildTextMatchPredicate, type QueryParam, type TextMatchMode } from './gridFilters';

export type FilterContext = {
  columnExpression: string;
  columnId: string;
  paramBase: string;
  /** Compare full datetimes instead of CAST(... AS date) when the value carries a time. */
  preserveTime?: boolean;
};

type Result = { clause: string; params: QueryParam[] };

const COMPARISON_OPERATORS: Record<string, string> = {
  equals: '=',
  notEqual: '<>',
  lessThan: '<',
  greaterThan: '>',
  lessThanOrEqual: '<=',
  greaterThanOrEqual: '>=',
};

const blankClause = (expr: string) =>
  `(NULLIF(LTRIM(RTRIM(COALESCE(CAST(${expr} AS NVARCHAR(MAX)), ''))), '') IS NULL)`;
const notBlankClause = (expr: string) =>
  `(NULLIF(LTRIM(RTRIM(COALESCE(CAST(${expr} AS NVARCHAR(MAX)), ''))), '') IS NOT NULL)`;

function combine<T>(
  filter: { operator: 'AND' | 'OR'; conditions: T[] },
  context: FilterContext,
  single: (condition: T, context: FilterContext) => Result,
): Result {
  const results = filter.conditions
    .map((condition, idx) => single(condition, { ...context, paramBase: `${context.paramBase}_c${idx}` }))
    .filter((r) => r.clause);
  if (results.length === 0) return { clause: '', params: [] };
  if (results.length === 1) return results[0];
  return {
    clause: `(${results.map((r) => r.clause).join(` ${filter.operator} `)})`,
    params: results.flatMap((r) => r.params),
  };
}

function singleText(condition: TextCondition, context: FilterContext): Result {
  if (condition.type === 'blank') return { clause: blankClause(context.columnExpression), params: [] };
  if (condition.type === 'notBlank') return { clause: notBlankClause(context.columnExpression), params: [] };
  const value = String(condition.filter ?? '');
  if (!value) return { clause: '', params: [] };
  return buildTextMatchPredicate(context.columnExpression, value, {
    paramKey: context.paramBase,
    mode: (condition.type ?? 'contains') as TextMatchMode,
  });
}

function singleNumber(condition: NumberCondition, context: FilterContext): Result {
  if (condition.type === 'blank') return { clause: blankClause(context.columnExpression), params: [] };
  if (condition.type === 'notBlank') return { clause: notBlankClause(context.columnExpression), params: [] };
  const value = condition.filter !== undefined ? Number(condition.filter) : Number.NaN;
  if (Number.isNaN(value)) return { clause: '', params: [] };
  const { columnExpression: col, paramBase: p } = context;
  if (condition.type === 'inRange') {
    const to = condition.filterTo !== undefined ? Number(condition.filterTo) : Number.NaN;
    if (Number.isNaN(to)) return { clause: '', params: [] };
    return {
      clause: `(${col} BETWEEN @${p} AND @${p}_to)`,
      params: [{ key: p, value }, { key: `${p}_to`, value: to }],
    };
  }
  const op = COMPARISON_OPERATORS[condition.type ?? 'equals'];
  if (!op) return { clause: '', params: [] };
  return { clause: `${col} ${op} @${p}`, params: [{ key: p, value }] };
}

function singleDate(condition: DateCondition, context: FilterContext): Result {
  if (condition.type === 'blank') return { clause: blankClause(context.columnExpression), params: [] };
  if (condition.type === 'notBlank') return { clause: notBlankClause(context.columnExpression), params: [] };
  const value = condition.dateFrom || condition.filter;
  if (!value) return { clause: '', params: [] };
  const { columnExpression: col, paramBase: p } = context;
  const isMidnight = (v: string) => v.endsWith(' 00:00:00');
  if (condition.type === 'inRange') {
    const to = condition.dateTo;
    if (!to) return { clause: '', params: [] };
    const withTime = context.preserveTime && (!isMidnight(value) || !isMidnight(to));
    const expr = withTime ? col : `CAST(${col} AS date)`;
    return {
      clause: `(${expr} BETWEEN @${p} AND @${p}_to)`,
      params: [{ key: p, value }, { key: `${p}_to`, value: to }],
    };
  }
  const op = COMPARISON_OPERATORS[condition.type ?? 'equals'];
  if (!op) return { clause: '', params: [] };
  const expr = context.preserveTime && !isMidnight(value) ? col : `CAST(${col} AS date)`;
  return { clause: `${expr} ${op} @${p}`, params: [{ key: p, value }] };
}

function setFilter(filter: SetFilterModel, context: FilterContext): Result {
  const values = filter.values ?? [];
  if (values.length === 0) return { clause: '', params: [] };
  const params: QueryParam[] = [];
  const placeholders = values.map((raw, idx) => {
    const key = `${context.paramBase}_${idx}`;
    const value = raw === true || raw === 'true' ? 1 : raw === false || raw === 'false' ? 0 : raw;
    params.push({ key, value });
    return `@${key}`;
  });
  return { clause: `${context.columnExpression} IN (${placeholders.join(', ')})`, params };
}

export function processFilter(filter: KnownFilterModel, context: FilterContext): Result {
  switch (filter.filterType) {
    case 'text': {
      const f = filter as TextFilterModel;
      return isCompoundFilter(f)
        ? combine(
            { operator: f.operator, conditions: getCompoundFilterConditions(f) as TextCondition[] },
            context,
            singleText,
          )
        : singleText(f, context);
    }
    case 'number': {
      const f = filter as NumberFilterModel;
      return isCompoundFilter(f)
        ? combine(
            { operator: f.operator, conditions: getCompoundFilterConditions(f) as NumberCondition[] },
            context,
            singleNumber,
          )
        : singleNumber(f, context);
    }
    case 'date': {
      const f = filter as DateFilterModel;
      return isCompoundFilter(f)
        ? combine(
            { operator: f.operator, conditions: getCompoundFilterConditions(f) as DateCondition[] },
            context,
            singleDate,
          )
        : singleDate(f, context);
    }
    case 'set':
      return setFilter(filter as SetFilterModel, context);
    default:
      return { clause: '', params: [] };
  }
}
