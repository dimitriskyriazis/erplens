/**
 * The time vocabulary every RMT screen shares, so the same idea is never called two names.
 *
 * Span: how far ahead a view reaches, always counted in weeks and written "2w".
 * Step: how wide one column is inside that span, day, week or month.
 *
 * Only the span is ever chosen: the step follows from it (granFor), the same way on every
 * screen, so no view can be asked for a shape it cannot draw and the two words always mean
 * the same thing.
 */

export type Granularity = 'day' | 'week' | 'month';

/** Longest span worth one column per working day: 5 or 10 columns. */
export const DAILY_UP_TO = 2;
/** Longest span still readable one column per week; past it a view steps by month. */
export const WEEKLY_UP_TO = 13;

/**
 * The step a span takes: a week or two is worth seeing day by day, a quarter is not
 * readable that way, and half a year only works stepped by month.
 */
export const granFor = (span: number): Granularity => (span <= DAILY_UP_TO ? 'day' : span <= WEEKLY_UP_TO ? 'week' : 'month');

/** The button label for a span: "1w", "13w". */
export const spanLabel = (weeks: number): string => `${weeks}w`;

/**
 * What one column unit is worth, so the panels can say "person-days" on a day board and
 * "person-weeks" on a week or month one. A month column is several week slots, so the unit
 * there is still the week.
 */
export type Unit = { one: string; short: string; long: string };
export const unitOf = (gran: Granularity): Unit =>
  gran === 'day' ? { one: 'day', short: 'd', long: 'person-days' } : { one: 'week', short: 'w', long: 'person-weeks' };

/** "3 days", "1 week". */
export const unitCount = (n: number, unit: Unit): string => `${n} ${unit.one}${n === 1 ? '' : 's'}`;
