import { readQuery, readQuerySets } from '@/lib/sql';
import { formatDbDateTime } from '@/lib/dbDates';
import { RMT_TASKS_RELATION } from './tasksRelation';

/**
 * Planned and estimate actions: dbo.PRJLINES lines with SOPLTYPE = 12, one row per
 * resource per interval, hanging off a task through PRJLINESS (unique within the project,
 * so always filter on PRJC as well). CCCCLRMTESTIMATE 0 = a named technician (planned),
 * 1 = a generic effort estimate such as "_Installer Generic", surfaced as IsEstimate.
 *
 * Decision 2026-09-17: read the base table instead of the legacy pair
 * dbo.eqrRMTActionsPlanned / dbo.eqrRMTActionsEstimate, which belong to Soft1's own
 * reports. Every column below was verified against those views on 2026-09-17 with zero
 * differences. One behaviour change: the views hardcoded COMPANY = 1 and so hid 31
 * company-2 bookings. That filter is gone, because callers filter on COMPANY themselves.
 *
 * EstimatePersonDays stays raw CCCCLNUMBEROFRSRC on estimate lines and NULL on planned
 * ones, which is what the plan screen expects. It is a typed total for the whole span,
 * not a per-day figure: availabilitySql.ts is what spreads it across working days.
 */
export const RMT_ACTIONS_RELATION = `(
SELECT  pl.COMPANY,
        pl.PRJC,
        pl.PRJLINESS                    AS TaskLineID,
        pl.PRJLINES                     AS ActionLineID,
        pl.CCCID                        AS ActionID,
        r.NAME                          AS ResourceName,
        r.CODE1                         AS ResourceInitials,
        pl.fromdate                     AS ActionStart,
        pl.finaldate                    AS ActionEnd,
        ISNULL(pl.CCCCLRMTESTIMATE, 0)  AS IsEstimate,
        ISNULL(pl.CCCCLISTRAVEL, 0)     AS IsTravel,
        pl.CCCCLRMTREMARKS              AS Remarks,
        CASE WHEN ISNULL(pl.CCCCLRMTESTIMATE, 0) = 1
             THEN CAST(pl.CCCCLNUMBEROFRSRC AS float) END AS EstimatePersonDays
FROM    dbo.PRJLINES pl
LEFT JOIN dbo.RSRC r ON r.RSRC = pl.RSRC
WHERE   pl.SOPLTYPE = 12
) AS a`;

/**
 * Actions done: dbo.SOACTION rows with SOSOURCE = 2021, the only value the table holds.
 * The resource comes from the actor through RSRC.CCCCLUSERS, because SOACTION.RSRC is
 * never filled; no user has two RSRC rows today, so that join cannot fan out.
 *
 * Decision 2026-09-17: read the base table instead of dbo.eqrRMTActionsDone. Two
 * deliberate changes from that view, both improvements rather than faithful copies:
 *
 *   TaskLineID now resolves through NUM03 (the task's global CCCID, which the RMT portal
 *   fills) and falls back to SOACTION.PRJLINES. The view used PRJLINES alone, which is
 *   empty on 23,388 of 42,717 rows, so over half of all logged work never attached to a
 *   task in the timeline. NUM03 resolves 41,819 of them.
 *
 *   HoursActual is span minus break, unrounded, with the 14 backwards-dated rows clamped
 *   to 0. The view rounded to one decimal, so about 3,100 rows shift by up to 0.05 h.
 *
 * The view also INNER JOINed RSRC, dropping 7 actions whose actor has no resource row.
 * They are kept here with a NULL resource rather than silently lost.
 */
export const RMT_ACTIONS_DONE_RELATION = `(
SELECT  s.COMPANY,
        s.PRJC,
        COALESCE(t3.PRJLINES, t2.PRJLINES) AS TaskLineID,
        r.RSRC                          AS ResourceID,
        r.NAME                          AS ResourceName,
        r.CODE1                         AS ResourceInitials,
        s.FROMDATE                      AS ActionStart,
        s.FINALDATE                     AS ActionEnd,
        CAST(CASE WHEN b.mins < 0 THEN 0 ELSE b.mins / 60.0 END AS float) AS HoursActual,
        s.COMMENTS                      AS Description,
        s.REMARKS                       AS UserRemarks
FROM    dbo.SOACTION s
LEFT JOIN dbo.PRJLINES t3 ON t3.CCCID = TRY_CONVERT(int, s.NUM03) AND t3.SOPLTYPE = 11
LEFT JOIN dbo.PRJLINES t2 ON t2.COMPANY = s.COMPANY AND t2.PRJC = s.PRJC
                         AND t2.PRJLINES = s.PRJLINES AND t2.SOPLTYPE = 11
LEFT JOIN dbo.RSRC r ON r.CCCCLUSERS = s.ACTOR
-- CCCCLBREAKTIMEH is a time-of-day; it never disagrees with the numeric CCCCLBREAKTIME
-- on any of the 3,397 rows that carry a break.
CROSS APPLY (SELECT DATEDIFF(minute, s.FROMDATE, s.FINALDATE)
                    - ISNULL(DATEPART(hour,   s.CCCCLBREAKTIMEH) * 60
                           + DATEPART(minute, s.CCCCLBREAKTIMEH), 0) AS mins) AS b
WHERE   s.SOSOURCE = 2021
  AND   s.FROMDATE  IS NOT NULL
  AND   s.FINALDATE IS NOT NULL
) AS d`;

export type TimelineProject = { prjc: number; company: number; code: string; name: string };

export type TimelineTask = {
  taskLineId: number;
  taskId: number;
  name: string;
  start: string | null;
  end: string | null;
  phase: string | null;
  status: string | null;
};

export type TimelineAction = {
  kind: 'planned' | 'estimate';
  taskLineId: number;
  actionId: number;
  resource: string | null;
  initials: string | null;
  start: string | null;
  end: string | null;
  isTravel: boolean;
  remarks: string | null;
  estimatePersonDays: number | null;
};

export type TimelineDone = {
  taskLineId: number;
  resourceId: number | null;
  resource: string | null;
  initials: string | null;
  start: string | null;
  end: string | null;
  hours: number | null;
  description: string | null;
  remarks: string | null;
};

export type ProjectTimeline = {
  project: TimelineProject | null;
  tasks: TimelineTask[];
  actions: TimelineAction[];
  done: TimelineDone[];
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Everything the project timeline needs, in one round trip: header, tasks, actions, done. */
export async function getProjectTimeline(company: number, prjc: number): Promise<ProjectTimeline> {
  const sets = await readQuerySets(
    `
SELECT p.PRJC, p.COMPANY, p.CODE, p.NAME FROM dbo.PRJC p WHERE p.COMPANY = @company AND p.PRJC = @prjc;
SELECT v.TaskLineID, v.TaskID, v.TaskName, v.TaskStart, v.TaskEnd, v.TaskPhaseName, v.TaskStatusName
FROM ${RMT_TASKS_RELATION}
WHERE v.COMPANY = @company AND v.PRJC = @prjc
ORDER BY v.TaskStart, v.TaskLineID;
SELECT a.TaskLineID, a.ActionID, a.ResourceName, a.ResourceInitials, a.ActionStart, a.ActionEnd, a.IsEstimate, a.IsTravel, a.Remarks, a.EstimatePersonDays
FROM ${RMT_ACTIONS_RELATION}
WHERE a.COMPANY = @company AND a.PRJC = @prjc
ORDER BY a.TaskLineID, a.ActionStart, a.ResourceName;
SELECT d.TaskLineID, d.ResourceID, d.ResourceName, d.ResourceInitials, d.ActionStart, d.ActionEnd, d.HoursActual, d.Description, d.UserRemarks
FROM ${RMT_ACTIONS_DONE_RELATION}
WHERE d.COMPANY = @company AND d.PRJC = @prjc
ORDER BY d.TaskLineID, d.ActionStart, d.ResourceName;`,
    [
      { key: 'company', value: company },
      { key: 'prjc', value: prjc },
    ],
  );

  const header = sets[0]?.[0];
  return {
    project: header
      ? { prjc: Number(header.PRJC), company: Number(header.COMPANY), code: String(header.CODE ?? ''), name: String(header.NAME ?? '') }
      : null,
    tasks: (sets[1] ?? []).map((r) => ({
      taskLineId: Number(r.TaskLineID),
      taskId: Number(r.TaskID),
      name: String(r.TaskName ?? '').trim(),
      start: formatDbDateTime(r.TaskStart),
      end: formatDbDateTime(r.TaskEnd),
      phase: str(r.TaskPhaseName),
      status: str(r.TaskStatusName),
    })),
    actions: (sets[2] ?? []).map((r) => ({
      kind: Number(r.IsEstimate) === 1 ? 'estimate' : 'planned',
      taskLineId: Number(r.TaskLineID),
      actionId: Number(r.ActionID),
      resource: str(r.ResourceName),
      initials: str(r.ResourceInitials),
      start: formatDbDateTime(r.ActionStart),
      end: formatDbDateTime(r.ActionEnd),
      isTravel: Number(r.IsTravel) === 1,
      remarks: str(r.Remarks),
      estimatePersonDays: num(r.EstimatePersonDays),
    })),
    done: (sets[3] ?? []).map((r) => ({
      taskLineId: Number(r.TaskLineID),
      resourceId: num(r.ResourceID),
      resource: str(r.ResourceName),
      initials: str(r.ResourceInitials),
      start: formatDbDateTime(r.ActionStart),
      end: formatDbDateTime(r.ActionEnd),
      hours: num(r.HoursActual),
      description: str(r.Description),
      remarks: str(r.UserRemarks),
    })),
  };
}

export type RmtProjectHit = TimelineProject & { tasks: number; firstStart: string | null; lastEnd: string | null };

/** Projects that have RMT tasks, matched on code or name (accent-insensitive), newest plan first. */
export async function searchRmtProjects(company: number, q: string, limit = 25): Promise<RmtProjectHit[]> {
  const term = `%${q.trim().toUpperCase()}%`;
  const rows = await readQuery(
    `
SELECT TOP (@limit) p.PRJC, p.COMPANY, p.CODE, p.NAME, t.tasks, t.first_start, t.last_end
FROM   dbo.PRJC p
JOIN  (SELECT v.PRJC, COUNT(*) AS tasks, MIN(v.TaskStart) AS first_start, MAX(v.TaskEnd) AS last_end
       FROM ${RMT_TASKS_RELATION} GROUP BY v.PRJC) t
       ON t.PRJC = p.PRJC
WHERE  p.COMPANY = @company
  AND (@term = '%%'
       OR UPPER(ISNULL(p.CODE, '')) COLLATE Greek_CI_AI LIKE @term
       OR UPPER(ISNULL(p.NAME, '')) COLLATE Greek_CI_AI LIKE @term)
ORDER  BY t.last_end DESC, p.CODE;`,
    [
      { key: 'company', value: company },
      { key: 'term', value: term },
      { key: 'limit', value: Math.max(1, Math.min(100, limit)) },
    ],
  );
  return rows.map((r) => ({
    prjc: Number(r.PRJC),
    company: Number(r.COMPANY),
    code: String(r.CODE ?? ''),
    name: String(r.NAME ?? ''),
    tasks: Number(r.tasks),
    firstStart: formatDbDateTime(r.first_start),
    lastEnd: formatDbDateTime(r.last_end),
  }));
}
