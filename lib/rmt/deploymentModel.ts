/**
 * Pure helpers for the deployment board: the colour system, the week/month columns, and
 * the per-person cells. No React, no fetch, so the page component (server) and the client
 * components share them.
 *
 * Colour rules, from the data-viz method:
 *  - Identity is categorical, so hues are assigned in a fixed order and never cycled.
 *  - The five destination hues were validated as a set against the white card surface on
 *    the all-pairs list (any two cells can touch in a grid): worst normal-vision dE 15.1,
 *    worst CVD dE 6.1. A CVD figure in the 6-8 band is only legal with secondary encoding,
 *    and a sub-3:1 swatch needs visible relief; both hold here, because every cell prints
 *    its project code and location code, the legend names each colour, and the hover card
 *    spells the engagement out in full. Colour is never the only carrier.
 *  - "At base" is deliberately neutral: grey means Athens or the workshop, colour means
 *    travel. That is the question the board exists to answer.
 */
import type { DeploymentCell, DeploymentResource } from './deploymentQueries';
import { addDays, parseIso } from './availabilityModel';

export const SPAN_OPTIONS = [4, 8, 13, 26] as const;
export type Span = (typeof SPAN_OPTIONS)[number];
/** Longest span still readable one column per week; past it the board steps by month. */
export const WEEKLY_UP_TO = 13;

export type Granularity = 'week' | 'month';
export type ColourBy = 'place' | 'project';

export type Swatch = { fill: string; ink: string; /** The 'nothing booked' swatch: drawn as a dashed outline, not a fill. */ empty?: true };

const NEUTRAL: Swatch = { fill: '#94a3b8', ink: '#0f172a' };
/** Nothing booked: the surface itself, drawn with a hairline so the cell still reads. */
const EMPTY_SWATCH: Swatch = { fill: 'transparent', ink: '#94a3b8', empty: true };

/**
 * The five validated destination hues, in fixed order. Locations get them by standing
 * volume (Greece outside Athens, Brussels, Other EU, Ethiopia, Strasbourg), not by anything
 * the current filters compute, so a swatch always means the same place.
 */
const DESTINATION_HUES: Swatch[] = [
  { fill: '#2a78d6', ink: '#ffffff' },
  { fill: '#d95926', ink: '#ffffff' },
  { fill: '#1baf7a', ink: '#0b0c0e' },
  { fill: '#4a3aa7', ink: '#ffffff' },
  { fill: '#e87ba4', ink: '#0b0c0e' },
];

/** Location code -> swatch. Athens and the workshop are base, so they stay neutral. */
const LOCATION_SWATCH: Record<string, Swatch> = {
  ATH: { fill: '#475569', ink: '#ffffff' },
  TLM: { fill: '#cbd5e1', ink: '#0f172a' },
  OGR: DESTINATION_HUES[0],
  BRX: DESTINATION_HUES[1],
  OEU: DESTINATION_HUES[2],
  ETH: DESTINATION_HUES[3],
  STR: DESTINATION_HUES[4],
};

/** Athens and the workshop are base; everything else costs a trip. */
const isAway = (locationCode: string): boolean => locationCode !== 'ATH' && locationCode !== 'TLM';

const locationSwatch = (code: string): Swatch => LOCATION_SWATCH[code] ?? NEUTRAL;

/**
 * Project code -> swatch, from the company-wide ranking the query returns. The first five
 * take the hues in order; everything past them shares one neutral, because a sixth hue
 * cannot clear the separation floors and a cycled palette would lie about identity. The
 * cell prints the code either way, so the tail is still identifiable.
 */
export function projectSwatches(rank: string[]): Map<string, Swatch> {
  const map = new Map<string, Swatch>();
  rank.forEach((code, i) => {
    if (i < DESTINATION_HUES.length) map.set(code, DESTINATION_HUES[i]);
  });
  return map;
}

const OTHER_PROJECTS_LABEL = 'Other projects';

const pad2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type BoardColumn = {
  key: string;
  label: string;
  /** Year suffix on month columns, '' on week columns. */
  sub: string;
  /** Week indices from the window start that this column covers. */
  weeks: number[];
  /** 'yyyy-MM-dd' of the first Monday in the column, for the hover card. */
  start: string;
};

/** Week columns, or month columns grouping the weeks by the month their Monday falls in. */
export function buildColumns(start: string, weeks: number, gran: Granularity): BoardColumn[] {
  const all = Array.from({ length: weeks }, (_, i) => ({ i, iso: addDays(start, i * 7) }));
  if (gran === 'week') {
    return all.map((w) => ({
      key: w.iso,
      label: `${w.iso.slice(8, 10)}/${w.iso.slice(5, 7)}`,
      sub: '',
      weeks: [w.i],
      start: w.iso,
    }));
  }
  const byMonth = new Map<string, BoardColumn>();
  all.forEach((w) => {
    const d = parseIso(w.iso);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const existing = byMonth.get(key);
    if (existing) existing.weeks.push(w.i);
    else byMonth.set(key, { key, label: MONTHS[d.getMonth()], sub: String(d.getFullYear()).slice(2), weeks: [w.i], start: w.iso });
  });
  return Array.from(byMonth.values());
}

/** "COT.1147" -> "C·1147", so a code fits a 26-column board. */
const shortCode = (code: string): string => {
  if (!code || code === '-') return '—';
  const [head, tail] = code.split('.');
  return tail ? `${head.slice(0, 1)}·${tail}` : code.slice(0, 6);
};

export type Engagement = {
  projectCode: string;
  projectName: string;
  locationCode: string;
  locationName: string;
  days: number;
};

export type BoardCell = {
  column: string;
  /** The engagement holding most of the column; null when nothing is booked. */
  top: Engagement | null;
  /** Every engagement in the column, most days first, for the hover card. */
  all: Engagement[];
  swatch: Swatch;
  code: string;
  sub: string;
  away: boolean;
};

export type BoardRow = {
  resource: DeploymentResource;
  cells: BoardCell[];
  /** Weeks in the window spent away from Athens and the workshop. */
  awayWeeks: number;
  bookedWeeks: number;
};

export type BoardTeam = { name: string; rows: BoardRow[]; awayWeeks: number };

/** Key for the colour lookup and the legend, per colour mode. */
const keyOf = (e: Engagement, by: ColourBy): string => (by === 'place' ? e.locationName : e.projectCode);

function swatchFor(e: Engagement, by: ColourBy, projects: Map<string, Swatch>): Swatch {
  if (by === 'place') return locationSwatch(e.locationCode);
  return projects.get(e.projectCode) ?? NEUTRAL;
}

/**
 * The board: one row per person, one cell per column, grouped by team. A cell takes the
 * engagement with the most days in the column and marks the rest with "+N more".
 */
export function buildBoard(
  resources: DeploymentResource[],
  cells: DeploymentCell[],
  columns: BoardColumn[],
  by: ColourBy,
  projects: Map<string, Swatch>,
): BoardTeam[] {
  // (resource, week) -> engagements, already ordered most days first by the query.
  const byResourceWeek = new Map<string, Engagement[]>();
  cells.forEach((c) => {
    const key = `${c.rsrc}|${c.week}`;
    const list = byResourceWeek.get(key);
    const e: Engagement = {
      projectCode: c.projectCode,
      projectName: c.projectName,
      locationCode: c.locationCode,
      locationName: c.locationName,
      days: c.days,
    };
    if (list) list.push(e);
    else byResourceWeek.set(key, [e]);
  });

  const rows: BoardRow[] = resources.map((resource) => {
    let awayWeeks = 0;
    let bookedWeeks = 0;
    const rowCells = columns.map((col) => {
      // Merge the column's weeks, adding up days per engagement so the dominant one wins.
      const merged = new Map<string, Engagement>();
      col.weeks.forEach((w) => {
        (byResourceWeek.get(`${resource.rsrc}|${w}`) ?? []).forEach((e) => {
          const k = `${e.projectCode}|${e.locationCode}`;
          const seen = merged.get(k);
          if (seen) seen.days += e.days;
          else merged.set(k, { ...e });
        });
      });
      const all = Array.from(merged.values()).sort((a, b) => b.days - a.days || a.projectCode.localeCompare(b.projectCode));
      const top = all[0] ?? null;
      if (top) {
        bookedWeeks += col.weeks.length;
        if (isAway(top.locationCode)) awayWeeks += col.weeks.length;
      }
      if (!top) {
        return { column: col.key, top: null, all, swatch: EMPTY_SWATCH, code: '—', sub: '', away: false } satisfies BoardCell;
      }
      return {
        column: col.key,
        top,
        all,
        swatch: swatchFor(top, by, projects),
        code: shortCode(top.projectCode),
        sub: all.length > 1 ? `+${all.length - 1} more` : top.locationCode === '-' ? '' : top.locationCode,
        away: isAway(top.locationCode),
      } satisfies BoardCell;
    });
    return { resource, cells: rowCells, awayWeeks, bookedWeeks };
  });

  // Group by team, keeping the query's name order inside each and putting the people with
  // no team ("Subcontractors" in practice) last.
  const teams = new Map<string, BoardRow[]>();
  rows.forEach((r) => {
    const name = r.resource.team ?? 'No team';
    const list = teams.get(name);
    if (list) list.push(r);
    else teams.set(name, [r]);
  });
  return Array.from(teams.entries())
    .map(([name, teamRows]) => ({ name, rows: teamRows, awayWeeks: teamRows.reduce((s, r) => s + r.awayWeeks, 0) }))
    .sort((a, b) => Number(a.name === 'No team') - Number(b.name === 'No team') || a.name.localeCompare(b.name));
}

export type LegendEntry = { key: string; label: string; swatch: Swatch; weeks: number };

/** Legend entries over what is actually on the board, heaviest first, plus "Not booked". */
export function buildLegend(teams: BoardTeam[], by: ColourBy, projects: Map<string, Swatch>, columns: BoardColumn[]): LegendEntry[] {
  const tally = new Map<string, LegendEntry>();
  let bookedCells = 0;
  let totalCells = 0;
  teams.forEach((t) =>
    t.rows.forEach((r) =>
      r.cells.forEach((c, i) => {
        const span = columns[i]?.weeks.length ?? 1;
        totalCells += span;
        if (!c.top) return;
        bookedCells += span;
        // Only the projects holding a hue are named in the legend; the long tail shares one
        // grey and one entry, because 40 identical swatches would be a worse lie than "other".
        const tail = by === 'project' && !projects.has(c.top.projectCode);
        const key = tail ? '~other' : keyOf(c.top, by);
        const label = tail
          ? OTHER_PROJECTS_LABEL
          : by === 'place'
            ? c.top.locationName
            : c.top.projectCode === '-'
              ? 'No project'
              : c.top.projectCode;
        const swatch = swatchFor(c.top, by, projects);
        const seen = tally.get(key);
        if (seen) seen.weeks += span;
        else tally.set(key, { key, label, swatch, weeks: span });
      }),
    ),
  );
  const entries = Array.from(tally.values()).sort((a, b) => b.weeks - a.weeks || a.label.localeCompare(b.label));
  entries.push({ key: '~none', label: 'Not booked', swatch: EMPTY_SWATCH, weeks: totalCells - bookedCells });
  return entries;
}

export type RollCallGroup = { name: string; swatch: Swatch; people: Array<{ name: string; code: string }> };

/** Who is where in one column: people grouped by location, biggest group first. */
export function rollCall(teams: BoardTeam[], columnIndex: number): RollCallGroup[] {
  const groups = new Map<string, RollCallGroup>();
  teams.forEach((t) =>
    t.rows.forEach((r) => {
      const cell = r.cells[columnIndex];
      const name = cell?.top ? cell.top.locationName : 'Not booked';
      const swatch = cell?.top ? locationSwatch(cell.top.locationCode) : EMPTY_SWATCH;
      const entry = groups.get(name) ?? { name, swatch, people: [] };
      entry.people.push({ name: r.resource.name, code: cell?.top && cell.top.projectCode !== '-' ? cell.top.projectCode : '' });
      groups.set(name, entry);
    }),
  );
  return Array.from(groups.values()).sort(
    (a, b) => Number(a.name === 'Not booked') - Number(b.name === 'Not booked') || b.people.length - a.people.length || a.name.localeCompare(b.name),
  );
}

export type TravelTeam = { name: string; weeks: number; segments: Array<{ location: string; weeks: number; swatch: Swatch }> };

/** Person-weeks away from base per team, split by destination, heaviest team first. */
export function travelLoad(teams: BoardTeam[], columns: BoardColumn[]): TravelTeam[] {
  return teams
    .map((t) => {
      const byPlace = new Map<string, { location: string; weeks: number; swatch: Swatch }>();
      t.rows.forEach((r) =>
        r.cells.forEach((c, i) => {
          if (!c.top || !c.away) return;
          const span = columns[i]?.weeks.length ?? 1;
          const seen = byPlace.get(c.top.locationName);
          if (seen) seen.weeks += span;
          else byPlace.set(c.top.locationName, { location: c.top.locationName, weeks: span, swatch: locationSwatch(c.top.locationCode) });
        }),
      );
      const segments = Array.from(byPlace.values()).sort((a, b) => b.weeks - a.weeks);
      return { name: t.name, weeks: segments.reduce((s, g) => s + g.weeks, 0), segments };
    })
    .sort((a, b) => b.weeks - a.weeks || a.name.localeCompare(b.name));
}

export type ColumnTotal = {
  column: BoardColumn;
  booked: number;
  away: number;
  capacity: number;
  idle: number;
  segments: Array<{ key: string; weeks: number; swatch: Swatch }>;
};

/** Column headers for the summary strip: person-weeks booked and away per column. */
export function columnTotals(teams: BoardTeam[], columns: BoardColumn[]): ColumnTotal[] {
  return columns.map((col, i) => {
    const segments = new Map<string, { key: string; weeks: number; swatch: Swatch }>();
    let booked = 0;
    let away = 0;
    let capacity = 0;
    teams.forEach((t) =>
      t.rows.forEach((r) => {
        capacity += col.weeks.length;
        const c = r.cells[i];
        if (!c?.top) return;
        booked += col.weeks.length;
        if (c.away) away += col.weeks.length;
        const key = c.swatch.fill;
        const seen = segments.get(key);
        if (seen) seen.weeks += col.weeks.length;
        else segments.set(key, { key, weeks: col.weeks.length, swatch: c.swatch });
      }),
    );
    return {
      column: col,
      booked,
      away,
      capacity,
      idle: capacity - booked,
      segments: Array.from(segments.values()).sort((a, b) => b.weeks - a.weeks),
    };
  });
}
