/**
 * Pure helpers for the availability screen: week arithmetic on 'yyyy-MM-dd' strings, the
 * capacity check behind "Fits?", and the colour level of a heat cell. No React, no fetch,
 * so the page component (server) and the client components share them.
 */
import type { AvailabilityBooking, AvailabilityResource, AvailabilityWeek } from './availabilityQueries';

/** Weeks the heatmap always shows; the assign table looks at the first 2, 4 or 8 of them. */
export const HEATMAP_WEEKS = 14;
export const WINDOW_OPTIONS = [2, 4, 8] as const;
export const NEED_OPTIONS = [1, 2, 3, 5] as const;
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

export const isOverbooked = (w: AvailabilityWeek): boolean => w.booked > w.workDays + 0.01;

/** Ramp step for a number of days out of the week: 0 for nothing, 1..HEAT_LEVELS by share. */
export function levelOf(days: number, workDays: number): number {
  if (days <= 0.005) return 0;
  const share = days / Math.max(1, workDays);
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil(share * HEAT_LEVELS - 1e-9)));
}

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

export type WindowStats = {
  /** Free days still ahead over the window (days already past do not count). */
  free: number;
  nextFree: string | null;
  /** Days missing against the need, 0 when it fits. */
  short: number;
  fits: boolean;
};

/** Capacity of one resource over the first `weeks` weeks against `need` days, from today on. */
export function windowStats(r: AvailabilityResource, weeks: number, need: number): WindowStats {
  const slice = r.weeks.slice(0, weeks);
  const free = slice.reduce((s, w) => s + w.freeAhead, 0);
  const nextFree = slice.find((w) => w.firstFree)?.firstFree ?? null;
  const short = Math.max(0, Math.round((need - free) * 10) / 10);
  return { free, nextFree, short, fits: short <= 0 };
}

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

export const typeLabel = (code: string | null, name: string | null): string =>
  TYPE_OPTIONS.find((t) => t.code && t.code === code)?.label ?? name ?? 'No type';

/** "PM Team · External · Project Manager", with the blanks named. */
export const describeResource = (r: AvailabilityResource): string =>
  `${r.team ?? 'No team'} · ${typeLabel(r.typeCode, r.type)} · ${r.specialties ?? 'No specialty'}`;
