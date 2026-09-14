/**
 * RMT task grain: one row per task in dbo.eqrRMTTasks, the legacy RMT view the Soft1
 * reports already read (dbo.PRJLINES lines with SOPLTYPE = 11, INNER JOINed to the phase
 * and status lookups, COMPANY 1 and 2 hardcoded inside the view).
 *
 * Decision 2026-09-14: TelERP reads the existing dbo.eqrRMT* views instead of new tlm
 * views, so every consumer sees the same task population. The view exposes no COMPANY,
 * project code or name, so dbo.PRJC is joined here (PRJC is globally unique). Everything
 * else comes from the view as is; DurationDays is the only derived column.
 */
export const RMT_TASKS_RELATION = `(
SELECT  p.COMPANY,
        t.PRJC,
        p.CODE                          AS ProjectCode,
        p.NAME                          AS ProjectName,
        t.PRJLINES                      AS TaskLineID,
        t.TaskID,
        t.TaskName,
        t.TaskStart,
        t.TaskEnd,
        DATEDIFF(day, t.TaskStart, t.TaskEnd) + 1 AS DurationDays,
        t.TaskPhaseCode,
        t.TaskPhaseName,
        t.TaskStatusCode,
        t.TaskStatusName
FROM    dbo.eqrRMTTasks t
JOIN    dbo.PRJC p ON p.PRJC = t.PRJC
) AS v`;

/** Whitelist: grid colId -> expression. Anything not listed cannot be filtered or sorted. */
export const RMT_TASKS_COLUMNS: Record<string, string> = {
  COMPANY: 'v.COMPANY',
  PRJC: 'v.PRJC',
  ProjectCode: 'v.ProjectCode',
  ProjectName: 'v.ProjectName',
  TaskLineID: 'v.TaskLineID',
  TaskID: 'v.TaskID',
  TaskName: 'v.TaskName',
  TaskStart: 'v.TaskStart',
  TaskEnd: 'v.TaskEnd',
  DurationDays: 'v.DurationDays',
  TaskPhaseCode: 'v.TaskPhaseCode',
  TaskPhaseName: 'v.TaskPhaseName',
  TaskStatusCode: 'v.TaskStatusCode',
  TaskStatusName: 'v.TaskStatusName',
};

export const RMT_TASKS_QUICK_FILTER = ['ProjectCode', 'ProjectName', 'TaskName', 'TaskPhaseName', 'TaskStatusName'].map(
  (colId) => ({ colId, expression: RMT_TASKS_COLUMNS[colId] }),
);

export const RMT_TASKS_DEFAULT_ORDER = 'v.TaskStart DESC, v.PRJC, v.TaskLineID';
