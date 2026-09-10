/**
 * RMT task grain: one row per dbo.PRJLINES line with SOPLTYPE = 11.
 *
 * TEMPORARY INLINE. This SELECT is byte-for-byte the body of tlm.vwRMTTasks in
 * scripts/sql/2026-09-09-tlm-vwRMTTasks.sql. It lives here only until that view has
 * been created on TELDB2 by a person (TelERP never runs DDL). Once it exists, set
 * RMT_TASKS_RELATION to 'tlm.vwRMTTasks AS v' and delete RMT_TASKS_SELECT_BODY. Until
 * then, keep both copies identical.
 */
export const RMT_TASKS_SELECT_BODY = `
SELECT  pl.COMPANY,
        pl.PRJC,
        p.CODE                          AS ProjectCode,
        p.NAME                          AS ProjectName,
        pl.PRJLINES                     AS TaskLineID,
        pl.CCCID                        AS TaskID,
        pl.LINENUM                      AS LineNum,
        pl.NAME                         AS TaskName,
        pl.fromdate                     AS TaskStart,
        pl.finaldate                    AS TaskEnd,
        DATEDIFF(day, pl.fromdate, pl.finaldate) + 1 AS DurationDays,
        st.CODE                         AS TaskPhaseCode,
        st.NAME                         AS TaskPhaseName,
        st.CCCCLCOLOR                   AS TaskPhaseColor,
        ls.CODE                         AS TaskStatusCode,
        ls.NAME                         AS TaskStatusName,
        pl.TASKCOMPLETE                 AS PercentComplete,
        CASE WHEN pl.fromdate IS NULL OR pl.finaldate IS NULL THEN 1
             WHEN pl.finaldate < pl.fromdate                  THEN 2
             WHEN st.CCCCLRMTSTATUSTYPE IS NULL               THEN 3
             WHEN ls.CCCCLRMTLINESSTATUS IS NULL              THEN 4
             ELSE 0 END                 AS DataQualityFlag
FROM    dbo.PRJLINES pl
LEFT JOIN dbo.PRJC                p  ON p.PRJC = pl.PRJC AND p.COMPANY = pl.COMPANY
LEFT JOIN dbo.CCCCLRMTSTATUSTYPE  st ON st.CCCCLRMTSTATUSTYPE  = pl.CCCCLRMTSTATUSTYPE  AND st.COMPANY = pl.COMPANY
LEFT JOIN dbo.CCCCLRMTLINESSTATUS ls ON ls.CCCCLRMTLINESSTATUS = pl.CCCCLRMTLINESSTATUS AND ls.COMPANY = pl.COMPANY
WHERE   pl.SOPLTYPE = 11`;

export const RMT_TASKS_RELATION = `(${RMT_TASKS_SELECT_BODY}
) AS v`;

/** Whitelist: grid colId -> expression. Anything not listed cannot be filtered or sorted. */
export const RMT_TASKS_COLUMNS: Record<string, string> = {
  COMPANY: 'v.COMPANY',
  PRJC: 'v.PRJC',
  ProjectCode: 'v.ProjectCode',
  ProjectName: 'v.ProjectName',
  TaskLineID: 'v.TaskLineID',
  TaskID: 'v.TaskID',
  LineNum: 'v.LineNum',
  TaskName: 'v.TaskName',
  TaskStart: 'v.TaskStart',
  TaskEnd: 'v.TaskEnd',
  DurationDays: 'v.DurationDays',
  TaskPhaseCode: 'v.TaskPhaseCode',
  TaskPhaseName: 'v.TaskPhaseName',
  TaskStatusCode: 'v.TaskStatusCode',
  TaskStatusName: 'v.TaskStatusName',
  PercentComplete: 'v.PercentComplete',
  DataQualityFlag: 'v.DataQualityFlag',
};

export const RMT_TASKS_QUICK_FILTER = ['ProjectCode', 'ProjectName', 'TaskName', 'TaskPhaseName', 'TaskStatusName'].map(
  (colId) => ({ colId, expression: RMT_TASKS_COLUMNS[colId] }),
);

export const RMT_TASKS_DEFAULT_ORDER = 'v.TaskStart DESC, v.PRJC, v.LineNum';

export const DATA_QUALITY_LABELS: Record<number, string> = {
  0: 'OK',
  1: 'Missing start or end',
  2: 'End before start',
  3: 'No phase',
  4: 'No status',
};
