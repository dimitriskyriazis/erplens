import { readQuerySets } from '@/lib/sql';
import { DEPLOYMENT_SQL } from './deploymentSql';

/**
 * Where people are: for every named resource in scope, which project and which location
 * holds them in each week of a window that starts on a Monday.
 *
 * One booking line (dbo.PRJLINES with SOPLTYPE = 12, CCCCLRMTESTIMATE = 0) is expanded over
 * the Monday-to-Friday days it covers and counted per week, so a week split between two
 * projects comes back as two rows and the board can show the dominant one with a "+1 more"
 * marker. The location is the one on the parent task (CCCCLPRJLINELOCATION), because that is
 * where the work happens; bookings themselves carry only a travel flag.
 *
 * Generic placeholders are excluded: a placeholder is demand, not a person, so it cannot be
 * deployed anywhere. Inactive resources are excluded because they cannot be sent out.
 */

export type DeploymentFilters = {
  company: number;
  /** 'yyyy-MM-dd', the Monday the window starts on. */
  start: string;
  weeks: number;
  /** RSRCTYPE id, 0 = all teams. */
  team: number;
  /** UTBL01 code for SODTYPE 25 ('Telm', 'Ext'), '' = all. */
  type: string;
  /** CCCCLRMTEIDIKOTITA id, 0 = all specialties. */
  specialty: number;
  /**
   * How finely the window is cut. 'week' is one row per person per week; 'day' is one row
   * per person per working day, which is five times the rows and is only asked for on the
   * one- and two-week windows the board draws day by day.
   */
  grain: DeploymentGrain;
};

export type DeploymentGrain = 'week' | 'day';

/** One project/location engagement holding a person for part of one slot. */
export type DeploymentCell = {
  rsrc: number;
  /** Slot index from the window start, 0-based: a week index, or a day offset at day grain. */
  slot: number;
  projectCode: string;
  projectName: string;
  locationCode: string;
  locationName: string;
  /** Monday-to-Friday days of that slot spent on this engagement: 1..5, or always 1 by day. */
  days: number;
};

export type DeploymentResource = {
  rsrc: number;
  name: string;
  initials: string | null;
  team: string | null;
  type: string | null;
  typeCode: string | null;
  specialties: string | null;
};

export type DeploymentOptions = {
  teams: Array<{ id: number; code: string; name: string }>;
  specialties: Array<{ id: number; code: string; name: string }>;
  types: Array<{ code: string; name: string }>;
};

export type Deployment = {
  start: string;
  weeks: number;
  grain: DeploymentGrain;
  resources: DeploymentResource[];
  cells: DeploymentCell[];
  /** Named, active resources in the company: the denominator for "showing N of M". */
  totalResources: number;
  /**
   * Project codes over the window ranked by person-days across the whole company, before
   * the team/type/specialty filters. Colour slots are handed out in this order so that
   * narrowing the filters never repaints the projects still on screen.
   */
  projectRank: string[];
  options: DeploymentOptions;
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function getDeployment(f: DeploymentFilters): Promise<Deployment> {
  const sets = await readQuerySets(DEPLOYMENT_SQL, [
    { key: 'company', value: f.company },
    { key: 'start', value: f.start },
    { key: 'days', value: f.weeks * 7 },
    { key: 'team', value: f.team },
    { key: 'type', value: f.type },
    { key: 'spec', value: f.specialty },
    { key: 'grain', value: f.grain === 'day' ? 1 : 0 },
  ]);

  return {
    start: f.start,
    weeks: f.weeks,
    grain: f.grain,
    cells: (sets[0] ?? []).map((r) => ({
      rsrc: Number(r.RSRC),
      slot: num(r.slot),
      projectCode: String(r.project_code ?? '-'),
      projectName: String(r.project_name ?? '').trim(),
      locationCode: String(r.location_code ?? '-'),
      locationName: String(r.location_name ?? 'No location').trim(),
      days: num(r.days_booked),
    })),
    resources: (sets[1] ?? []).map((r) => ({
      rsrc: Number(r.RSRC),
      name: String(r.NAME ?? '').trim(),
      initials: str(r.CODE1)?.trim() || null,
      team: str(r.RSRCTYPE_NAME),
      type: str(r.UTBL01_NAME),
      typeCode: str(r.UTBL01_CODE),
      specialties: str(r.specialties),
    })),
    totalResources: num(sets[5]?.[0]?.total),
    projectRank: (sets[6] ?? []).map((r) => String(r.project_code ?? '-')),
    options: {
      teams: (sets[2] ?? []).map((r) => ({ id: Number(r.RSRCTYPE), code: String(r.CODE ?? ''), name: String(r.NAME ?? '') })),
      specialties: (sets[3] ?? []).map((r) => ({ id: Number(r.CCCCLRMTEIDIKOTITA), code: String(r.CODE ?? ''), name: String(r.NAME ?? '') })),
      types: (sets[4] ?? []).map((r) => ({ code: String(r.CODE ?? ''), name: String(r.NAME ?? '') })),
    },
  };
}
