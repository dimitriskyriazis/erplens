/**
 * Pure helpers for the availability screen: week arithmetic on 'yyyy-MM-dd' strings, the
 * free-days summary per window, and the colour level of a heat cell. No React, no fetch,
 * so the page component (server) and the client components share them.
 */
import type { AvailabilityBooking, AvailabilityDay, AvailabilityResource, AvailabilityWeek } from './availabilityQueries';
import { granFor } from './timeScale';

export { spanLabel } from './timeScale';

/** The spans the table offers, in weeks: the same set, in the same words, as the board. */
export const SPAN_OPTIONS = [1, 2, 4, 8, 13, 26] as const;
/** Past this many weeks the strip cells go narrow, so half a year still fits a screen. */
export const TIGHT_FROM = 13;
/**
 * The strip steps by day over a span of one or two weeks and by week beyond it, by the same
 * rule the deployment board uses, because "3.5 free days next week" hides which days they
 * are. Only those first two weeks come back day by day.
 */
export const isDaySpan = (weeks: number): boolean => granFor(weeks) === 'day';
/** Monday to Friday, so a span of whole weeks is five cells each. */
export const DAYS_PER_WEEK = 5;
/** UTBL01 codes for SODTYPE 25, with the labels the screen uses instead of the Greek names. */
export const TYPE_OPTIONS = [
  { code: '', label: 'All' },
  { code: 'Telm', label: 'Internal' },
  { code: 'Ext', label: 'External' },
  { code: 'Gen', label: 'Generic' },
] as const;

export type HeatMode = 'free' | 'booked';
export const HEAT_LEVELS = 5;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'yyyy-MM-dd' of a local Date. */
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 'yyyy-MM-dd' as a local Date at midnight. */
export const parseIso = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (iso: string, n: number): string => {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

/** The Monday of the week holding the date. */
export const mondayOf = (iso: string): string => {
  const d = parseIso(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
};

/** 'dd/MM' from 'yyyy-MM-dd' or 'yyyy-MM-dd HH:mm'. */
export const fmtDM = (v: string | null): string => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : '');
export const fmtDMY = (v: string | null): string => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '');
/** '5 January 2026'. */
export const fmtLong = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseIso(iso));

/** Up to one decimal, no trailing zero: 3.5, 2, 0.3. */
export const fmtDays = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** Only meaningful for a named person: a pool placeholder has no one week to exceed. */
export const isOverbooked = (w: AvailabilityWeek): boolean => w.booked > w.workDays + 0.01;

/** Ramp step for a number of days out of `full`: 0 for nothing, 1..HEAT_LEVELS by share. */
export function levelOf(days: number, full: number): number {
  if (days <= 0.005) return 0;
  const share = days / Math.max(1, full);
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil(share * HEAT_LEVELS - 1e-9)));
}

/**
 * A generic placeholder stands for a whole pool, so its week is not one person's 5 days:
 * 10.8 person-days of commissioning demand is roughly two people, out of the 60 who carry
 * the specialty. These two helpers keep placeholder rows off the person scale.
 */
export const peopleNeeded = (w: AvailabilityWeek): number => w.booked / Math.max(1, w.workDays);

/**
 * The busiest generic cell inside the span: the top of the ramp placeholder rows are shaded
 * against. Taken over what is on screen, so narrowing the span rescales the placeholder rows
 * with it rather than flattening them against a peak nobody can see.
 */
export const demandPeak = (resources: AvailabilityResource[], weeks: number): number =>
  resources.reduce((peak, r) => (r.generic ? r.weeks.slice(0, weeks).reduce((m, w) => Math.max(m, w.booked), peak) : peak), 0);

export const demandPeakDays = (resources: AvailabilityResource[], days: number): number =>
  resources.reduce((peak, r) => (r.generic ? r.days.slice(0, days).reduce((m, d) => Math.max(m, d.booked), peak) : peak), 0);

/**
 * Colour class of a heat cell: 0 = nothing on this side (no room, or nothing booked),
 * 1..HEAT_LEVELS = the one-hue ramp by share of the week, 'over' = demand above the week.
 */
export function heatLevel(w: AvailabilityWeek, mode: HeatMode): number | 'over' {
  if (isOverbooked(w)) return 'over';
  return levelOf(mode === 'free' ? w.free : w.booked, w.workDays);
}

/** The assign table's cell: free days still ahead, red when the week is overbooked. */
export const aheadLevel = (w: AvailabilityWeek): number | 'over' => (isOverbooked(w) ? 'over' : levelOf(w.freeAhead, w.workDays));

/** The same for one day, in either mode: out of the single day, red when double-booked. */
export const dayLevel = (d: AvailabilityDay, mode: HeatMode): number | 'over' =>
  d.booked > 1.01 ? 'over' : levelOf(mode === 'free' ? d.freeAhead : d.booked, 1);

export type SpanStats = {
  /** Free days still ahead over the span (days already past do not count). */
  free: number;
  /** Person-days booked over the span, uncapped. */
  booked: number;
  nextFree: string | null;
};

/** Room left and work booked on one resource over the first `weeks` weeks, from today on. */
export function spanStats(r: AvailabilityResource, weeks: number): SpanStats {
  const slice = r.weeks.slice(0, weeks);
  return {
    free: slice.reduce((s, w) => s + w.freeAhead, 0),
    booked: slice.reduce((s, w) => s + w.booked, 0),
    nextFree: slice.find((w) => w.firstFree)?.firstFree ?? null,
  };
}

/**
 * The two sides of the assignment decision over the window: room left on the named people in
 * view, and the person-days still sitting on the placeholders waiting to be given to someone.
 *
 * Deliberately not netted off. Pool demand has not been assigned to anybody, so taking it out
 * of a person's free days would mean inventing a split across everyone who carries the
 * specialty. Side by side the pair still answers the question the screen is for: whether the
 * capacity on show can absorb what is coming.
 */
export type CoverStats = { free: number; demand: number; people: number; pools: number };

export function coverStats(resources: AvailabilityResource[], weeks: number): CoverStats {
  const cover: CoverStats = { free: 0, demand: 0, people: 0, pools: 0 };
  for (const r of resources) {
    if (r.generic) {
      cover.pools += 1;
      cover.demand += r.weeks.slice(0, weeks).reduce((s, w) => s + w.booked, 0);
    } else {
      cover.people += 1;
      cover.free += r.weeks.slice(0, weeks).reduce((s, w) => s + w.freeAhead, 0);
    }
  }
  return cover;
}

/**
 * Unassigned person-days per person carrying the specialty. This is the number that ranks
 * pools against each other: 426 days across 76 electricians is a quieter pool than 164 days
 * across 10 designers, though the raw total says the opposite.
 */
export const perHead = (demand: number, pool: number): number | null => (pool > 0 ? demand / pool : null);

/** The week's Monday for each column, from the window start. */
export const weekStarts = (start: string, weeks: number): string[] => Array.from({ length: weeks }, (_, i) => addDays(start, i * 7));

/** Bookings by resource, in the API's date order. */
export function groupBookings(bookings: AvailabilityBooking[]): Map<number, AvailabilityBooking[]> {
  const map = new Map<number, AvailabilityBooking[]>();
  for (const b of bookings) {
    const list = map.get(b.rsrc);
    if (list) list.push(b);
    else map.set(b.rsrc, [b]);
  }
  return map;
}

/** Bookings that touch the Monday-to-Sunday span of the week. */
export function bookingsInWeek(all: AvailabilityBooking[], weekStart: string): AvailabilityBooking[] {
  const end = addDays(weekStart, 7);
  return all.filter((b) => b.from.slice(0, 10) < end && b.to.slice(0, 10) >= weekStart);
}

/** Bookings covering one day. */
export function bookingsOnDay(all: AvailabilityBooking[], date: string): AvailabilityBooking[] {
  return all.filter((b) => b.from.slice(0, 10) <= date && b.to.slice(0, 10) >= date);
}

export const typeLabel = (code: string | null, name: string | null): string =>
  TYPE_OPTIONS.find((t) => t.code && t.code === code)?.label ?? name ?? 'No type';

/** "PM Team · External · Project Manager", with the blanks named. */
export const describeResource = (r: AvailabilityResource): string =>
  `${r.team ?? 'No team'} · ${typeLabel(r.typeCode, r.type)} · ${r.specialties ?? 'No specialty'}`;
