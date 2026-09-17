/**
 * RMT task grain: one row per dbo.PRJLINES line with SOPLTYPE = 11.
 *
 * Decision 2026-09-17: read the base tables directly instead of dbo.eqrRMTTasks. That view
 * belongs to Soft1's own reports, and depending on it meant ERPLens could not change its
 * shape without touching dbo. The body below was reproduced from the view and verified
 * against it on 2026-09-17: identical 7,212 rows, zero differences on any column.
 *
 * Both lookups are INNER JOINed, which is what the view does and what sets the population.
 * It excludes the 13 SOPLTYPE = 11 lines that have neither a phase nor a status set. The
 * view also hardcoded COMPANY; that filter is dropped here because every caller already
 * filters on COMPANY itself. DurationDays is the only derived column.
 */
export const RMT_TASKS_RELATION = `(
SELECT  pl.COMPANY,
        pl.PRJC,
        p.CODE                          AS ProjectCode,
        p.NAME                          AS ProjectName,
        pl.PRJLINES                     AS TaskLineID,
        pl.CCCID                        AS TaskID,
        pl.NAME                         AS TaskName,
        pl.fromdate                     AS TaskStart,
        pl.finaldate                    AS TaskEnd,
        DATEDIFF(day, pl.fromdate, pl.finaldate) + 1 AS DurationDays,
        st.CODE                         AS TaskPhaseCode,
        st.NAME                         AS TaskPhaseName,
        ls.CODE                         AS TaskStatusCode,
        ls.NAME                         AS TaskStatusName
FROM    dbo.PRJLINES pl
JOIN    dbo.PRJC p ON p.PRJC = pl.PRJC
JOIN    dbo.CCCCLRMTSTATUSTYPE  st ON st.COMPANY = pl.COMPANY AND st.CCCCLRMTSTATUSTYPE  = pl.CCCCLRMTSTATUSTYPE
JOIN    dbo.CCCCLRMTLINESSTATUS ls ON ls.COMPANY = pl.COMPANY AND ls.CCCCLRMTLINESSTATUS = pl.CCCCLRMTLINESSTATUS
WHERE   pl.SOPLTYPE = 11
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
