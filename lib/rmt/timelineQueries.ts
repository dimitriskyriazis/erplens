import { readQuery, readQuerySets } from '@/lib/sql';
import { formatDbDateTime } from '@/lib/dbDates';
import { RMT_TASKS_RELATION } from './tasksRelation';

/**
 * Planned and estimate actions: dbo.PRJLINES lines with SOPLTYPE = 12, one row per
 * resource per interval, hanging off a task through PRJLINESS (unique within the
 * project, so always join on PRJC as well). CCCCLRMTESTIMATE = 1 marks the generic
 * "_Installer Generic" style effort estimates; 0 marks named technicians.
 *
 * TEMPORARY INLINE, same arrangement as tasksRelation.ts: byte-for-byte the body of
 * tlm.vwRMTActionsPlanned in scripts/sql/2026-09-10-tlm-vwRMTActions.sql. Switch to the
 * view once a person has created it on TELDB2.
 */
export const RMT_ACTIONS_SELECT_BODY = `
SELECT  a.COMPANY,
        a.PRJC,
        a.PRJLINESS                     AS TaskLineID,
        a.PRJLINES                      AS ActionLineID,
        a.CCCID                         AS ActionID,
        a.RSRC                          AS ResourceID,
        r.NAME                          AS ResourceName,
        r.CODE1                         AS ResourceInitials,
        a.fromdate                      AS ActionStart,
        a.finaldate                     AS ActionEnd,
        CASE WHEN ISNULL(a.CCCCLRMTESTIMATE, 0) = 1 THEN 1 ELSE 0 END AS IsEstimate,
        CASE WHEN ISNULL(a.CCCCLISTRAVEL, 0) = 1 THEN 1 ELSE 0 END    AS IsTravel,
        a.CCCCLRMTREMARKS               AS Remarks,
        a.CCCCLNUMBEROFRSRC             AS EstimatePersonDays
FROM    dbo.PRJLINES a
LEFT JOIN dbo.RSRC r ON r.RSRC = a.RSRC
WHERE   a.SOPLTYPE = 12`;

/**
 * Actions done: dbo.SOACTION rows logged against a project (and usually a task line).
 * The actor is a Soft1 user; the resource is resolved through RSRC.CCCCLUSERS with
 * OUTER APPLY TOP 1 so an action can never fan out if two resources share a user.
 * HoursActual mirrors the legacy PersonHoursActual formula (span minus break).
 * Body of tlm.vwRMTActionsDone in the same script.
 */
export const RMT_ACTIONS_DONE_SELECT_BODY = `
SELECT  s.COMPANY,
        s.PRJC,
        s.PRJLINES                      AS TaskLineID,
        s.SOACTION                      AS ActionID,
        r.RSRC                          AS ResourceID,
        r.NAME                          AS ResourceName,
        r.CODE1                         AS ResourceInitials,
        s.FROMDATE                      AS ActionStart,
        s.FINALDATE                     AS ActionEnd,
        ISNULL(s.CCCCLBREAKTIME, 0)     AS BreakHours,
        ROUND(24 * (DATEDIFF(second, s.FROMDATE, s.FINALDATE) / 86400.0) - ISNULL(s.CCCCLBREAKTIME, 0), 1) AS HoursActual,
        s.COMMENTS                      AS Description,
        s.REMARKS                       AS UserRemarks
FROM    dbo.SOACTION s
OUTER APPLY (SELECT TOP (1) rr.RSRC, rr.NAME, rr.CODE1
             FROM dbo.RSRC rr WHERE rr.CCCCLUSERS = s.ACTOR ORDER BY rr.RSRC) r
WHERE   ISNULL(s.PRJC, 0) <> 0`;

export type TimelineProject = { prjc: number; company: number; code: string; name: string };

export type TimelineTask = {
  taskLineId: number;
  taskId: number;
  lineNum: number;
  name: string;
  start: string | null;
  end: string | null;
  phase: string | null;
  status: string | null;
  percentComplete: number | null;
  dataQualityFlag: number;
};

export type TimelineAction = {
  kind: 'planned' | 'estimate';
  taskLineId: number;
  actionId: number;
  resourceId: number | null;
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
  actionId: number;
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
SELECT v.TaskLineID, v.TaskID, v.LineNum, v.TaskName, v.TaskStart, v.TaskEnd, v.TaskPhaseName, v.TaskStatusName, v.PercentComplete, v.DataQualityFlag
FROM ${RMT_TASKS_RELATION}
WHERE v.COMPANY = @company AND v.PRJC = @prjc
ORDER BY v.TaskStart, v.LineNum;
SELECT a.TaskLineID, a.ActionID, a.ResourceID, a.ResourceName, a.ResourceInitials, a.ActionStart, a.ActionEnd, a.IsEstimate, a.IsTravel, a.Remarks, a.EstimatePersonDays
FROM (${RMT_ACTIONS_SELECT_BODY}
) AS a
WHERE a.COMPANY = @company AND a.PRJC = @prjc
ORDER BY a.TaskLineID, a.ActionStart, a.ResourceName;
SELECT d.TaskLineID, d.ActionID, d.ResourceID, d.ResourceName, d.ResourceInitials, d.ActionStart, d.ActionEnd, d.HoursActual, d.Description, d.UserRemarks
FROM (${RMT_ACTIONS_DONE_SELECT_BODY}
) AS d
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
      lineNum: Number(r.LineNum),
      name: String(r.TaskName ?? '').trim(),
      start: formatDbDateTime(r.TaskStart),
      end: formatDbDateTime(r.TaskEnd),
      phase: str(r.TaskPhaseName),
      status: str(r.TaskStatusName),
      percentComplete: num(r.PercentComplete),
      dataQualityFlag: Number(r.DataQualityFlag ?? 0),
    })),
    actions: (sets[2] ?? []).map((r) => ({
      kind: Number(r.IsEstimate) === 1 ? 'estimate' : 'planned',
      taskLineId: Number(r.TaskLineID),
      actionId: Number(r.ActionID),
      resourceId: num(r.ResourceID),
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
      actionId: Number(r.ActionID),
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
JOIN  (SELECT PRJC, COMPANY, COUNT(*) AS tasks, MIN(fromdate) AS first_start, MAX(finaldate) AS last_end
       FROM dbo.PRJLINES WHERE SOPLTYPE = 11 GROUP BY PRJC, COMPANY) t
       ON t.PRJC = p.PRJC AND t.COMPANY = p.COMPANY
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
