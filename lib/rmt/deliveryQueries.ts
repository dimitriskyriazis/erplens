import { readQuerySets } from '@/lib/sql';
import { formatDbDateTime } from '@/lib/dbDates';
import { DELIVERY_SQL } from './deliverySql';

/**
 * Estimates against logged work: what was scheduled for named people on a task (person-days
 * at 8 hours) against what they actually logged in the RMT portal.
 *
 * Generic estimate lines are deliberately out of scope. They say "N person-days of an
 * installer somewhere in this span" and nobody logs against them, so including them would
 * make every project look permanently under plan.
 *
 * Delta is logged minus planned hours. A project still running reads negative until the work
 * is done, which is why the screen shows the task dates beside it.
 */

export type DeliveryTask = {
  prjc: number;
  /** CCCID, the task's global id. */
  id: number;
  name: string;
  start: string | null;
  end: string | null;
  plannedHours: number;
  loggedHours: number;
};

export type DeliveryProject = {
  prjc: number;
  code: string;
  name: string;
  tasks: number;
  plannedHours: number;
  loggedHours: number;
};

/** Tasks bucketed by logged hours as a share of planned hours. */
export type DeliveryBucket = { bucket: number; label: string; tasks: number; over: boolean };

export type DeliveryAttention = {
  id: number;
  name: string;
  projectCode: string;
  end: string | null;
  plannedHours: number;
  loggedHours: number;
  /** Why it is here: past its plan, or past its end date with nothing logged. */
  reason: 'over' | 'stalled';
};

export type DeliveryTotals = {
  tasksWithWork: number;
  plannedHours: number;
  loggedHours: number;
  over120: number;
  orphanActions: number;
  orphanHours: number;
};

export type Delivery = {
  projects: DeliveryProject[];
  tasks: DeliveryTask[];
  buckets: DeliveryBucket[];
  attention: DeliveryAttention[];
  totals: DeliveryTotals;
};

const BUCKET_LABELS = ['under 60%', '60–90%', '90–110%', '110–120%', '120–150%', 'over 150%'];
/** Past 120% of plan a task is either an underestimate or late scope, so it reads as a problem. */
const OVER_FROM = 4;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getDelivery(company: number, limit = 40): Promise<Delivery> {
  const sets = await readQuerySets(DELIVERY_SQL, [
    { key: 'company', value: company },
    { key: 'limit', value: Math.max(1, Math.min(200, limit)) },
  ]);

  const counts = new Map<number, number>();
  (sets[2] ?? []).forEach((r) => counts.set(num(r.bucket), num(r.tasks)));

  const totals = sets[4]?.[0] ?? {};
  const orphan = sets[5]?.[0] ?? {};

  return {
    projects: (sets[0] ?? []).map((r) => ({
      prjc: Number(r.PRJC),
      code: String(r.CODE ?? '').trim(),
      name: String(r.NAME ?? '').trim(),
      tasks: num(r.tasks),
      plannedHours: round1(num(r.planned_hours)),
      loggedHours: round1(num(r.logged_hours)),
    })),
    tasks: (sets[1] ?? []).map((r) => ({
      prjc: Number(r.PRJC),
      id: Number(r.CCCID),
      name: String(r.NAME ?? '').trim(),
      start: formatDbDateTime(r.fromdate),
      end: formatDbDateTime(r.finaldate),
      plannedHours: round1(num(r.planned_hours)),
      loggedHours: round1(num(r.logged_hours)),
    })),
    buckets: BUCKET_LABELS.map((label, bucket) => ({
      bucket,
      label,
      tasks: counts.get(bucket) ?? 0,
      over: bucket >= OVER_FROM,
    })),
    attention: (sets[3] ?? []).map((r) => {
      const plannedHours = round1(num(r.planned_hours));
      const loggedHours = round1(num(r.logged_hours));
      return {
        id: Number(r.CCCID),
        name: String(r.NAME ?? '').trim(),
        projectCode: String(r.project_code ?? '').trim(),
        end: formatDbDateTime(r.finaldate),
        plannedHours,
        loggedHours,
        reason: loggedHours === 0 ? ('stalled' as const) : ('over' as const),
      };
    }),
    totals: {
      tasksWithWork: num(totals.tasks_with_work),
      plannedHours: round1(num(totals.planned_hours)),
      loggedHours: round1(num(totals.logged_hours)),
      over120: num(totals.over_120),
      orphanActions: num(orphan.orphan_actions),
      orphanHours: round1(num(orphan.orphan_hours)),
    },
  };
}
