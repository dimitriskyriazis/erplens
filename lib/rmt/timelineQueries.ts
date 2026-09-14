import { readQuery, readQuerySets } from '@/lib/sql';
import { formatDbDateTime } from '@/lib/dbDates';
import { RMT_TASKS_RELATION } from './tasksRelation';

/**
 * Planned and estimate actions come from the legacy pair dbo.eqrRMTActionsPlanned
 * (CCCCLRMTESTIMATE = 0, named technicians) and dbo.eqrRMTActionsEstimate
 * (CCCCLRMTESTIMATE = 1, generic effort estimates such as "_Installer Generic"). Both are
 * dbo.PRJLINES SOPLTYPE = 12 lines, one row per resource per interval, hanging off a task
 * through PRJLINESS (unique within the project, so always filter on PRJC as well). They
 * are stacked here with an IsEstimate flag. Neither view exposes COMPANY, so dbo.PRJC
 * supplies it; only the estimate view carries the person-days figure.
 */
export const RMT_ACTIONS_RELATION = `(
SELECT  p.COMPANY,
        a.PRJC,
        a.PRJLINESS                     AS TaskLineID,
        a.PRJLINES                      AS ActionLineID,
        a.CCCID                         AS ActionID,
        a.RsrcName                      AS ResourceName,
        a.RsrcInit                      AS ResourceInitials,
        a.ActionStart,
        a.ActionEnd,
        0                               AS IsEstimate,
        CASE WHEN ISNULL(a.IsTravel, 0) = 1 THEN 1 ELSE 0 END AS IsTravel,
        a.ActionDescription             AS Remarks,
        CAST(NULL AS float)             AS EstimatePersonDays
FROM    dbo.eqrRMTActionsPlanned a
JOIN    dbo.PRJC p ON p.PRJC = a.PRJC
UNION ALL
SELECT  p.COMPANY,
        e.PRJC,
        e.PRJLINESS,
        e.PRJLINES,
        e.CCCID,
        e.RsrcName,
        e.RsrcInit,
        e.ActionStart,
        e.ActionEnd,
        1,
        CASE WHEN ISNULL(e.IsTravel, 0) = 1 THEN 1 ELSE 0 END,
        e.ActionDescription,
        e.ResEstimatePersonDays
FROM    dbo.eqrRMTActionsEstimate e
JOIN    dbo.PRJC p ON p.PRJC = e.PRJC
) AS a`;

/**
 * Actions done: dbo.eqrRMTActionsDone, the legacy view over dbo.SOACTION rows logged
 * against a project and usually a task line, with the actor already resolved to a
 * resource and PersonHoursActual (span minus break) computed inside the view. It has no
 * action id column and no COMPANY, so dbo.PRJC supplies the company.
 */
export const RMT_ACTIONS_DONE_RELATION = `(
SELECT  p.COMPANY,
        d.PRJC,
        d.PRJLINES                      AS TaskLineID,
        d.ResourceID,
        d.DoneRsrcName                  AS ResourceName,
        d.DoneRsrcInit                  AS ResourceInitials,
        d.ActionDoneStart               AS ActionStart,
        d.ActionDoneEnd                 AS ActionEnd,
        d.PersonHoursActual             AS HoursActual,
        d.ActionDescription             AS Description,
        d.ActionUserRemarks             AS UserRemarks
FROM    dbo.eqrRMTActionsDone d
JOIN    dbo.PRJC p ON p.PRJC = d.PRJC
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

/** Projects that have RMT tasks (as dbo.eqrRMTTasks sees them), matched on code or name (accent-insensitive), newest plan first. */
export async function searchRmtProjects(company: number, q: string, limit = 25): Promise<RmtProjectHit[]> {
  const term = `%${q.trim().toUpperCase()}%`;
  const rows = await readQuery(
    `
SELECT TOP (@limit) p.PRJC, p.COMPANY, p.CODE, p.NAME, t.tasks, t.first_start, t.last_end
FROM   dbo.PRJC p
JOIN  (SELECT PRJC, COUNT(*) AS tasks, MIN(TaskStart) AS first_start, MAX(TaskEnd) AS last_end
       FROM dbo.eqrRMTTasks GROUP BY PRJC) t
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
