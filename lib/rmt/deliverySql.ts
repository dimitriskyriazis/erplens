/**
 * The plan-against-actual query, kept import-free so a plain Node script can load and run it
 * against the database with the same parameters the app binds (see the header comment in
 * deliveryQueries.ts for the semantics).
 *
 * Parameters: @company, @limit (projects returned).
 *
 * Like availabilitySql.ts and tasksRelation.ts, this reads the base tables directly rather
 * than dbo.eqrRMTActionsPlanned / eqrRMTActionsDone. Those views belong to Soft1's own
 * reports, and depending on them would mean ERPLens could not change the shape it needs
 * without touching dbo. PersonDaysPlanned and PersonHoursActual are reproduced below exactly
 * as the views compute them.
 */

/**
 * One row per task with its planned and logged hours.
 *
 * planned: PersonDaysPlanned over the named booking lines under the task, times 8. A
 * multi-day booking counts inclusive calendar days; a same-day one under 7 hours counts pro
 * rata, otherwise 1. Generic estimate lines are left out, because this compares what was
 * scheduled for people against what those people logged.
 *
 * logged: PersonHoursActual over dbo.SOACTION, span minus break. The task comes from NUM03
 * (the task's global id, which the RMT portal fills on nearly every row) and falls back to
 * the (COMPANY, PRJC, PRJLINES) line.
 */
const TASK_SCOPE = `
WITH planned AS (
    SELECT  a.COMPANY, a.PRJC, a.PRJLINESS AS task_line,
            SUM(CASE WHEN a.fromdate IS NULL OR a.finaldate IS NULL                     THEN 0
                     WHEN DATEDIFF(day, a.fromdate, a.finaldate) >= 1                   THEN DATEDIFF(day, a.fromdate, a.finaldate) + 1
                     WHEN 3 * DATEDIFF(second, a.fromdate, a.finaldate) / 86400.0 < 0.875
                          THEN 3 * DATEDIFF(second, a.fromdate, a.finaldate) / 86400.0
                     ELSE 1 END) AS person_days
    FROM    dbo.PRJLINES a
    WHERE   a.SOPLTYPE = 12
      AND   ISNULL(a.CCCCLRMTESTIMATE, 0) = 0
      AND   a.COMPANY = @company
    GROUP BY a.COMPANY, a.PRJC, a.PRJLINESS
),
logged AS (
    SELECT  COALESCE(t3.CCCID, t2.CCCID) AS task_cccid,
            ROUND(SUM(24 * (DATEDIFF(second, s.FROMDATE, s.FINALDATE) / 86400.0) - ISNULL(s.CCCCLBREAKTIME, 0)), 1) AS hours
    FROM    dbo.SOACTION s
    LEFT JOIN dbo.PRJLINES t3 ON t3.CCCID = TRY_CONVERT(int, s.NUM03) AND t3.SOPLTYPE = 11
    LEFT JOIN dbo.PRJLINES t2 ON t2.COMPANY = s.COMPANY AND t2.PRJC = s.PRJC AND t2.PRJLINES = s.PRJLINES AND t2.SOPLTYPE = 11
    WHERE   s.COMPANY = @company
      AND   s.FROMDATE IS NOT NULL AND s.FINALDATE IS NOT NULL
    GROUP BY COALESCE(t3.CCCID, t2.CCCID)
),
task AS (
    SELECT  t.COMPANY, t.PRJC, t.CCCID, t.NAME, t.fromdate, t.finaldate,
            ISNULL(pl.person_days, 0) * 8.0 AS planned_hours,
            ISNULL(lg.hours, 0)             AS logged_hours,
            st.CODE                         AS phase_code
    FROM    dbo.PRJLINES t
    LEFT JOIN planned pl ON pl.COMPANY = t.COMPANY AND pl.PRJC = t.PRJC AND pl.task_line = t.PRJLINES
    LEFT JOIN logged  lg ON lg.task_cccid = t.CCCID
    LEFT JOIN dbo.CCCCLRMTSTATUSTYPE st ON st.CCCCLRMTSTATUSTYPE = t.CCCCLRMTSTATUSTYPE
    WHERE   t.SOPLTYPE = 11
      AND   t.COMPANY = @company
)`;

export const DELIVERY_SQL = `${TASK_SCOPE}
-- Projects that have logged work, heaviest first.
SELECT TOP (@limit)
       p.PRJC, p.CODE, p.NAME,
       COUNT(*)                        AS tasks,
       SUM(task.planned_hours)         AS planned_hours,
       SUM(task.logged_hours)          AS logged_hours
FROM   task
JOIN   dbo.PRJC p ON p.COMPANY = task.COMPANY AND p.PRJC = task.PRJC
GROUP  BY p.PRJC, p.CODE, p.NAME
HAVING SUM(task.logged_hours) > 0
ORDER  BY SUM(task.logged_hours) DESC, p.CODE;

${TASK_SCOPE}
-- The tasks behind those projects, so a row expands without another round trip.
SELECT task.PRJC, task.CCCID, task.NAME, task.fromdate, task.finaldate,
       task.planned_hours, task.logged_hours
FROM   task
WHERE  task.PRJC IN (SELECT TOP (@limit) t2.PRJC
                     FROM   task t2
                     GROUP  BY t2.PRJC
                     HAVING SUM(t2.logged_hours) > 0
                     ORDER  BY SUM(t2.logged_hours) DESC, t2.PRJC)
ORDER  BY task.PRJC, task.fromdate, task.CCCID;

${TASK_SCOPE}
-- Where effort lands against plan: tasks with both a plan and logged work, bucketed.
SELECT b.bucket, COUNT(*) AS tasks
FROM  (SELECT CASE WHEN task.logged_hours / task.planned_hours < 0.6  THEN 0
                   WHEN task.logged_hours / task.planned_hours < 0.9  THEN 1
                   WHEN task.logged_hours / task.planned_hours < 1.1  THEN 2
                   WHEN task.logged_hours / task.planned_hours < 1.2  THEN 3
                   WHEN task.logged_hours / task.planned_hours < 1.5  THEN 4
                   ELSE 5 END AS bucket
       FROM   task
       WHERE  task.logged_hours > 0 AND task.planned_hours > 0) b
GROUP BY b.bucket
ORDER BY b.bucket;

${TASK_SCOPE}
-- Needs attention: unfinished tasks whose hours have passed their plan, or whose end has.
SELECT TOP (20)
       task.CCCID, task.NAME, p.CODE AS project_code, task.finaldate,
       task.planned_hours, task.logged_hours
FROM   task
JOIN   dbo.PRJC p ON p.COMPANY = task.COMPANY AND p.PRJC = task.PRJC
-- A task that ended with nothing logged only counts as "needs attention" while it is still
-- recent; older ones are abandoned records, not today's problem, and they would otherwise
-- crowd the list out by sheer size of their stale estimate.
WHERE  ISNULL(task.phase_code, '') <> 'CMP'
  AND ((task.planned_hours > 0 AND task.logged_hours > task.planned_hours)
       OR (task.logged_hours = 0 AND task.planned_hours > 0
           AND task.finaldate < CAST(GETDATE() AS date)
           AND task.finaldate >= DATEADD(day, -180, CAST(GETDATE() AS date))))
ORDER  BY CASE WHEN task.logged_hours = 0 THEN 0 ELSE task.logged_hours - task.planned_hours END DESC,
       task.finaldate DESC, task.CCCID;

${TASK_SCOPE}
SELECT COUNT(*)                                                                  AS tasks_with_work,
       SUM(task.planned_hours)                                                   AS planned_hours,
       SUM(task.logged_hours)                                                    AS logged_hours,
       -- >= 1.2, matching the bucket boundary above, so the tile and the chart agree.
       SUM(CASE WHEN task.planned_hours > 0 AND task.logged_hours / task.planned_hours >= 1.2 THEN 1 ELSE 0 END) AS over_120
FROM   task
WHERE  task.logged_hours > 0;

-- Logged work that never found a task: the hours this comparison cannot see.
SELECT COUNT(*) AS orphan_actions,
       ROUND(SUM(24 * (DATEDIFF(second, s.FROMDATE, s.FINALDATE) / 86400.0) - ISNULL(s.CCCCLBREAKTIME, 0)), 1) AS orphan_hours
FROM   dbo.SOACTION s
LEFT JOIN dbo.PRJLINES t3 ON t3.CCCID = TRY_CONVERT(int, s.NUM03) AND t3.SOPLTYPE = 11
LEFT JOIN dbo.PRJLINES t2 ON t2.COMPANY = s.COMPANY AND t2.PRJC = s.PRJC AND t2.PRJLINES = s.PRJLINES AND t2.SOPLTYPE = 11
WHERE  s.COMPANY = @company
  AND  s.FROMDATE IS NOT NULL AND s.FINALDATE IS NOT NULL
  AND  COALESCE(t3.CCCID, t2.CCCID) IS NULL;`;
