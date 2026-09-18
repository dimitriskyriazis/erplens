/**
 * The estimate-planned-done query, kept import-free so a plain Node script can load and run
 * it against the database with the same parameters the app binds (see the header comment in
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
 * One row per task with the three figures the screen compares, all in hours at 8 hours a
 * person-day so they can sit on one scale.
 *
 * estimate: what was written down before anyone was picked. Estimate lines
 * (CCCCLRMTESTIMATE = 1) carry person-days in CCCCLNUMBEROFRSRC and normally sit on a generic
 * placeholder. Nobody logs against them, so they are an intention, not a schedule.
 *
 * planned: PersonDaysPlanned over the named booking lines under the task, times 8. A
 * multi-day booking counts inclusive calendar days; a same-day one under 7 hours counts pro
 * rata, otherwise 1. This is what was actually put in someone's calendar, which is why it can
 * sit far below the work done: a task booked for two days can absorb hours for a year.
 *
 * done: PersonHoursActual over dbo.SOACTION, span minus break. The task comes from NUM03
 * (the task's global id, which the RMT portal fills on nearly every row) and falls back to
 * the (COMPANY, PRJC, PRJLINES) line.
 */
const TASK_SCOPE = `
WITH est AS (
    SELECT  a.COMPANY, a.PRJC, a.PRJLINESS AS task_line,
            SUM(ISNULL(a.CCCCLNUMBEROFRSRC, 0)) AS person_days
    FROM    dbo.PRJLINES a
    WHERE   a.SOPLTYPE = 12
      AND   ISNULL(a.CCCCLRMTESTIMATE, 0) = 1
      AND   a.COMPANY = @company
    GROUP BY a.COMPANY, a.PRJC, a.PRJLINESS
),
planned AS (
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
            ROUND(SUM(24 * (DATEDIFF(second, s.FROMDATE, s.FINALDATE) / 86400.0) - ISNULL(s.CCCCLBREAKTIME, 0)), 1) AS hours,
            MAX(CAST(s.FROMDATE AS date)) AS last_logged
    FROM    dbo.SOACTION s
    LEFT JOIN dbo.PRJLINES t3 ON t3.CCCID = TRY_CONVERT(int, s.NUM03) AND t3.SOPLTYPE = 11
    LEFT JOIN dbo.PRJLINES t2 ON t2.COMPANY = s.COMPANY AND t2.PRJC = s.PRJC AND t2.PRJLINES = s.PRJLINES AND t2.SOPLTYPE = 11
    WHERE   s.COMPANY = @company
      AND   s.FROMDATE IS NOT NULL AND s.FINALDATE IS NOT NULL
    GROUP BY COALESCE(t3.CCCID, t2.CCCID)
),
task AS (
    SELECT  t.COMPANY, t.PRJC, t.CCCID, t.NAME, t.fromdate, t.finaldate,
            ISNULL(e.person_days, 0)  * 8.0 AS est_hours,
            ISNULL(pl.person_days, 0) * 8.0 AS planned_hours,
            ISNULL(lg.hours, 0)             AS logged_hours,
            lg.last_logged
    FROM    dbo.PRJLINES t
    LEFT JOIN est     e  ON e.COMPANY = t.COMPANY AND e.PRJC = t.PRJC AND e.task_line = t.PRJLINES
    LEFT JOIN planned pl ON pl.COMPANY = t.COMPANY AND pl.PRJC = t.PRJC AND pl.task_line = t.PRJLINES
    LEFT JOIN logged  lg ON lg.task_cccid = t.CCCID
    WHERE   t.SOPLTYPE = 11
      AND   t.COMPANY = @company
)`;

export const DELIVERY_SQL = `${TASK_SCOPE}
-- Projects that have logged work, heaviest first.
SELECT TOP (@limit)
       p.PRJC, p.CODE, p.NAME,
       COUNT(*)                        AS tasks,
       SUM(task.est_hours)             AS est_hours,
       SUM(task.planned_hours)         AS planned_hours,
       SUM(task.logged_hours)          AS logged_hours,
       MAX(task.last_logged)           AS last_logged
FROM   task
JOIN   dbo.PRJC p ON p.COMPANY = task.COMPANY AND p.PRJC = task.PRJC
GROUP  BY p.PRJC, p.CODE, p.NAME
HAVING SUM(task.logged_hours) > 0
ORDER  BY SUM(task.logged_hours) DESC, p.CODE;

${TASK_SCOPE}
-- The tasks behind those projects, so a row expands without another round trip.
SELECT task.PRJC, task.CCCID, task.NAME, task.fromdate, task.finaldate,
       task.est_hours, task.planned_hours, task.logged_hours
FROM   task
WHERE  task.PRJC IN (SELECT TOP (@limit) t2.PRJC
                     FROM   task t2
                     GROUP  BY t2.PRJC
                     HAVING SUM(t2.logged_hours) > 0
                     ORDER  BY SUM(t2.logged_hours) DESC, t2.PRJC)
ORDER  BY task.PRJC, task.fromdate, task.CCCID;

${TASK_SCOPE}
SELECT COUNT(*)                        AS tasks_with_work,
       SUM(task.est_hours)             AS est_hours,
       SUM(task.planned_hours)         AS planned_hours,
       SUM(task.logged_hours)          AS logged_hours,
       SUM(CASE WHEN task.est_hours > 0 THEN 1 ELSE 0 END) AS tasks_with_estimate
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
