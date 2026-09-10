// AG Grid filter model shapes as they arrive from the server-side row model.

export type TextCondition = {
  filterType: 'text';
  type?: 'contains' | 'notContains' | 'equals' | 'notEqual' | 'startsWith' | 'endsWith' | 'blank' | 'notBlank';
  filter?: string;
};

export type NumberCondition = {
  filterType: 'number';
  type?:
    | 'equals'
    | 'notEqual'
    | 'lessThan'
    | 'greaterThan'
    | 'lessThanOrEqual'
    | 'greaterThanOrEqual'
    | 'inRange'
    | 'blank'
    | 'notBlank';
  filter?: number;
  filterTo?: number;
};

export type DateCondition = {
  filterType: 'date';
  type?:
    | 'equals'
    | 'notEqual'
    | 'lessThan'
    | 'greaterThan'
    | 'lessThanOrEqual'
    | 'greaterThanOrEqual'
    | 'inRange'
    | 'blank'
    | 'notBlank';
  dateFrom?: string;
  dateTo?: string;
  filter?: string;
};

export type SetFilterModel = {
  filterType: 'set';
  values?: Array<string | number | boolean>;
};

type CompoundOperator = 'AND' | 'OR';

export type CompoundTextFilter = { filterType: 'text'; operator: CompoundOperator; conditions: TextCondition[] };
export type CompoundNumberFilter = { filterType: 'number'; operator: CompoundOperator; conditions: NumberCondition[] };
export type CompoundDateFilter = { filterType: 'date'; operator: CompoundOperator; conditions: DateCondition[] };

export type AnyCompoundFilter = CompoundTextFilter | CompoundNumberFilter | CompoundDateFilter;

export type TextFilterModel = TextCondition | CompoundTextFilter;
export type NumberFilterModel = NumberCondition | CompoundNumberFilter;
export type DateFilterModel = DateCondition | CompoundDateFilter;

export type KnownFilterModel = TextFilterModel | NumberFilterModel | DateFilterModel | SetFilterModel;

export function isCompoundFilter(filter: KnownFilterModel): filter is AnyCompoundFilter {
  return 'operator' in filter && 'conditions' in filter && Array.isArray(filter.conditions);
}

export function getCompoundFilterConditions(
  filter: AnyCompoundFilter,
): Array<TextCondition | NumberCondition | DateCondition> {
  return filter.conditions;
}
