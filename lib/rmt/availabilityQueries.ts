import { readQuerySets } from '@/lib/sql';
import { formatDbDate, formatDbDateTime } from '@/lib/dbDates';
import { AVAILABILITY_SQL } from './availabilitySql';

/**
 * Who is available: free working days per resource per week, over a window that starts
 * on a Monday. A day is booked to the extent booking lines (dbo.PRJLINES with SOPLTYPE = 12)
 * cover it: a multi-day booking takes the whole day, a same-day booking takes hours / 8,
 * and overlapping bookings never take more than one day. Free days in a week = 5 minus the
 * booked share of each Monday to Friday. The uncapped sum is returned as well, so a week
 * whose demand exceeds its working days can be flagged as overbooked.
 *
 * Named people count their planned lines (CCCCLRMTESTIMATE = 0). Generic placeholders
 * (RSRC.CCCCLISGENERIC = 1) are included and flagged: their lines are estimates, so their
 * "booked" days are demand, not capacity. Inactive resources are excluded because they
 * cannot be assigned. The bookings behind every cell come back in a second result set.
 *
 * Column names follow the database (see docs/rmt-views-changes.md). The resource and
 * booking sources are inlined in availabilitySql.ts from the bodies of dbo.eqrRMTResources
 * and dbo.eqrRMTActions until that script has been run on TELDB2.
 */

export type AvailabilityFilters = {
  company: number;
  /** 'yyyy-MM-dd', the Monday the window starts on. */
  start: string;
  weeks: number;
  /** RSRCTYPE id, 0 = all teams. */
  team: number;
  /** UTBL01 code for SODTYPE 25 ('Telm', 'Ext', 'Gen'), '' = all. */
  type: string;
  /** CCCCLRMTEIDIKOTITA id, 0 = all specialties. */
  specialty: number;
  /** Only people with a booking in the 365 days before the window or inside it. */
  history: boolean;
};

export type AvailabilityWeek = {
  /** 'yyyy-MM-dd', the Monday. */
  start: string;
  /** Monday to Friday days in the week, normally 5. */
  workDays: number;
  /** Working days with room left over the whole week, after capping each day at one booking. */
  free: number;
  /** The part of `free` that falls on today or later: what can still be assigned. */
  freeAhead: number;
  /** Person-days demanded, uncapped. More than workDays means overbooked. */
  booked: number;
  /** First 'yyyy-MM-dd' in the week, today or later, with room left; null if none. */
  firstFree: string | null;
};

export type AvailabilityResource = {
  rsrc: number;
  name: string;
  initials: string | null;
  team: string | null;
  type: string | null;
  typeCode: string | null;
  /** A placeholder such as "_Installer Generic": demand, not a person. */
  generic: boolean;
  /** Specialty names, comma separated, in lookup order. */
  specialties: string | null;
  weeks: AvailabilityWeek[];
};

export type AvailabilityBooking = {
  rsrc: number;
  /** CCCID, the booking's global id. */
  id: number;
  /** 'yyyy-MM-dd HH:mm' as stored. */
  from: string;
  to: string;
  project: string | null;
  projectName: string | null;
  task: string | null;
  remarks: string | null;
  travel: boolean;
  estimate: boolean;
  /** Person-days typed on an estimate line, null on named bookings. */
  personDays: number | null;
};

export type AvailabilityOptions = {
  teams: Array<{ id: number; code: string; name: string }>;
  specialties: Array<{ id: number; code: string; name: string }>;
  types: Array<{ code: string; name: string }>;
};

export type Availability = {
  start: string;
  weeks: number;
  /** Sorted by name; the screen orders them as it needs. */
  resources: AvailabilityResource[];
  /** Every booking line touching the window for the resources returned. */
  bookings: AvailabilityBooking[];
  /** Active resources in the company, the denominator for "showing N of M". */
  totalResources: number;
  options: AvailabilityOptions;
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getAvailability(f: AvailabilityFilters): Promise<Availability> {
  const sets = await readQuerySets(AVAILABILITY_SQL, [
    { key: 'company', value: f.company },
    { key: 'start', value: f.start },
    { key: 'days', value: f.weeks * 7 },
    { key: 'team', value: f.team },
    { key: 'type', value: f.type },
    { key: 'spec', value: f.specialty },
    { key: 'history', value: f.history ? 1 : 0 },
  ]);

  const byRsrc = new Map<number, AvailabilityResource>();
  for (const r of sets[0] ?? []) {
    const rsrc = Number(r.RSRC);
    let entry = byRsrc.get(rsrc);
    if (!entry) {
      entry = {
        rsrc,
        name: String(r.NAME ?? '').trim(),
        initials: str(r.CODE1)?.trim() || null,
        team: str(r.RSRCTYPE_NAME),
        type: str(r.UTBL01_NAME),
        typeCode: str(r.UTBL01_CODE),
        generic: Number(r.generic) === 1,
        specialties: str(r.specialties),
        weeks: [],
      };
      byRsrc.set(rsrc, entry);
    }
    entry.weeks.push({
      start: formatDbDate(r.week_start) ?? '',
      workDays: num(r.work_days),
      free: round2(num(r.free_days)),
      freeAhead: round2(num(r.free_ahead)),
      booked: round2(num(r.booked_days)),
      firstFree: formatDbDate(r.first_free),
    });
  }

  return {
    start: f.start,
    weeks: f.weeks,
    resources: Array.from(byRsrc.values()),
    bookings: (sets[1] ?? []).map((r) => ({
      rsrc: Number(r.RSRC),
      id: Number(r.CCCID),
      from: formatDbDateTime(r.fromdate) ?? '',
      to: formatDbDateTime(r.finaldate) ?? '',
      project: str(r.PRJC_CODE),
      projectName: str(r.PRJC_NAME),
      task: str(r.TASK_NAME)?.trim() || null,
      remarks: str(r.CCCCLRMTREMARKS)?.trim() || null,
      travel: Number(r.CCCCLISTRAVEL) === 1,
      estimate: Number(r.CCCCLRMTESTIMATE) === 1,
      personDays: numOrNull(r.CCCCLNUMBEROFRSRC),
    })),
    totalResources: num(sets[5]?.[0]?.total),
    options: {
      teams: (sets[2] ?? []).map((r) => ({ id: Number(r.RSRCTYPE), code: String(r.CODE ?? ''), name: String(r.NAME ?? '') })),
      specialties: (sets[3] ?? []).map((r) => ({ id: Number(r.CCCCLRMTEIDIKOTITA), code: String(r.CODE ?? ''), name: String(r.NAME ?? '') })),
      types: (sets[4] ?? []).map((r) => ({ code: String(r.CODE ?? ''), name: String(r.NAME ?? '') })),
    },
  };
}
