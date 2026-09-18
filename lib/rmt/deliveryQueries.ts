import { readQuerySets } from '@/lib/sql';
import { formatDbDate, formatDbDateTime } from '@/lib/dbDates';
import { DELIVERY_SQL } from './deliverySql';

/**
 * Three figures per project and per task, all in hours at 8 hours a person-day:
 *
 *  - estimate: person-days written on estimate lines, normally against a generic placeholder,
 *    before anyone was picked. An intention, not a schedule.
 *  - planned: person-days of the named bookings under the task. What went in a calendar.
 *  - done: hours logged in the RMT portal.
 *
 * They are three different acts, not three versions of one number, and each can be missing:
 * plenty of work is booked without an estimate, and a task can absorb logged hours far beyond
 * either figure because a booking is a day in a calendar, not a budget. The screen shows the
 * three side by side and leaves the reading to the person, rather than declaring an overrun
 * against whichever of them happens to exist.
 */

export type DeliveryTask = {
  prjc: number;
  /** CCCID, the task's global id. */
  id: number;
  name: string;
  start: string | null;
  end: string | null;
  estimateHours: number;
  plannedHours: number;
  loggedHours: number;
};

export type DeliveryProject = {
  prjc: number;
  code: string;
  name: string;
  tasks: number;
  estimateHours: number;
  plannedHours: number;
  loggedHours: number;
  /** Last day anything was logged on the project, 'yyyy-MM-dd'. */
  lastLogged: string | null;
};

export type DeliveryTotals = {
  tasksWithWork: number;
  tasksWithEstimate: number;
  estimateHours: number;
  plannedHours: number;
  loggedHours: number;
  orphanActions: number;
  orphanHours: number;
};

export type Delivery = {
  projects: DeliveryProject[];
  tasks: DeliveryTask[];
  totals: DeliveryTotals;
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getDelivery(company: number, limit = 40): Promise<Delivery> {
  const sets = await readQuerySets(DELIVERY_SQL, [
    { key: 'company', value: company },
    { key: 'limit', value: Math.max(1, Math.min(200, limit)) },
  ]);

  const totals = sets[2]?.[0] ?? {};
  const orphan = sets[3]?.[0] ?? {};

  return {
    projects: (sets[0] ?? []).map((r) => ({
      prjc: Number(r.PRJC),
      code: String(r.CODE ?? '').trim(),
      name: String(r.NAME ?? '').trim(),
      tasks: num(r.tasks),
      estimateHours: round1(num(r.est_hours)),
      plannedHours: round1(num(r.planned_hours)),
      loggedHours: round1(num(r.logged_hours)),
      lastLogged: formatDbDate(r.last_logged),
    })),
    tasks: (sets[1] ?? []).map((r) => ({
      prjc: Number(r.PRJC),
      id: Number(r.CCCID),
      name: String(r.NAME ?? '').trim(),
      start: formatDbDateTime(r.fromdate),
      end: formatDbDateTime(r.finaldate),
      estimateHours: round1(num(r.est_hours)),
      plannedHours: round1(num(r.planned_hours)),
      loggedHours: round1(num(r.logged_hours)),
    })),
    totals: {
      tasksWithWork: num(totals.tasks_with_work),
      tasksWithEstimate: num(totals.tasks_with_estimate),
      estimateHours: round1(num(totals.est_hours)),
      plannedHours: round1(num(totals.planned_hours)),
      loggedHours: round1(num(totals.logged_hours)),
      orphanActions: num(orphan.orphan_actions),
      orphanHours: round1(num(orphan.orphan_hours)),
    },
  };
}
