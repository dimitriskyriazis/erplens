/**
 * The deployment query, kept import-free so a plain Node script can load and run it
 * against the database with the same parameters the app binds (see the header comment in
 * deploymentQueries.ts for the semantics).
 *
 * Parameters: @company, @start (yyyy-MM-dd, a Monday), @days (weeks * 7), @team (RSRCTYPE,
 * 0 = all), @type (UTBL01 code for SODTYPE 25, '' = all), @spec (CCCCLRMTEIDIKOTITA, 0 = all).
 *
 * Like availabilitySql.ts and tasksRelation.ts, this reads the base tables directly rather
 * than dbo.eqrRMTResources / eqrRMTActionsPlanned / eqrRMTTasks. Those views belong to
 * Soft1's own reports, and depending on them would mean ERPLens could not change the shape
 * it needs without touching dbo.
 */

/**
 * The people on the board. Named only: a generic placeholder ("_Installer Generic") is
 * demand, not a person, so it can never be deployed anywhere. A CTE only lives for one
 * statement, so this is spliced into each statement that needs it rather than repeated by
 * hand, the same way availabilitySql.ts shares its scope.
 */
const RES = `
res AS (
    SELECT r.COMPANY, r.RSRC, r.NAME, r.CODE1, r.RSRCTYPE, r.UTBL01, r.SODTYPE
    FROM dbo.RSRC r
    WHERE r.COMPANY = @company
      AND r.ISACTIVE = 1
      AND ISNULL(r.CCCCLISGENERIC, 0) = 0
      AND (@team = 0 OR r.RSRCTYPE = @team)
      AND (@type = '' OR EXISTS (SELECT 1 FROM dbo.UTBL01 u
                                 WHERE u.COMPANY = r.COMPANY AND u.SODTYPE = r.SODTYPE AND u.UTBL01 = r.UTBL01 AND u.CODE = @type))
      AND (@spec = 0 OR EXISTS (SELECT 1 FROM dbo.CCCCLRSRCEIDIKOTITA rs
                                WHERE rs.RSRC = r.RSRC AND rs.CCCCLEIDIKOTITA = @spec))
)`;

export const DEPLOYMENT_SQL = `
WITH p AS (
    SELECT CAST(@start AS date) AS start_date, DATEADD(day, @days, CAST(@start AS date)) AS end_date
),
${RES},
n AS (
    SELECT TOP (@days) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects
),
days AS (
    -- Monday to Friday only. 1900-01-01 was a Monday, so this is independent of DATEFIRST.
    SELECT DATEADD(day, n.i, p.start_date) AS d, n.i / 7 AS wk
    FROM n CROSS JOIN p
    WHERE (DATEDIFF(day, '19000101', DATEADD(day, n.i, p.start_date)) % 7) < 5
),
bk AS (
    -- Planned lines for people in scope that touch the window. CCCCLRMTESTIMATE = 0 keeps
    -- this to real bookings; the estimate lines hang off generic resources anyway.
    SELECT a.COMPANY, a.PRJC, a.PRJLINESS, a.RSRC,
           CAST(a.fromdate AS date) AS d0, CAST(a.finaldate AS date) AS d1
    FROM dbo.PRJLINES a
    JOIN res ON res.RSRC = a.RSRC
    CROSS JOIN p
    WHERE a.SOPLTYPE = 12
      AND ISNULL(a.CCCCLRMTESTIMATE, 0) = 0
      AND a.fromdate IS NOT NULL AND a.finaldate IS NOT NULL
      AND a.finaldate >= p.start_date AND a.fromdate < p.end_date
)
-- One row per person per week per engagement: how many working days of that week the
-- person is booked on that project at that location. A week with two projects yields two
-- rows, and the board picks the one holding the most days for the cell's colour and code.
SELECT bk.RSRC, days.wk,
       ISNULL(pj.CODE, '-')                 AS project_code,
       ISNULL(pj.NAME, '')                  AS project_name,
       ISNULL(loc.CODE, '-')                AS location_code,
       ISNULL(loc.NAME, 'No location')      AS location_name,
       COUNT(*)                             AS days_booked
FROM bk
JOIN days ON days.d BETWEEN bk.d0 AND bk.d1
LEFT JOIN dbo.PRJC     pj  ON pj.COMPANY = bk.COMPANY AND pj.PRJC = bk.PRJC
LEFT JOIN dbo.PRJLINES t   ON t.COMPANY = bk.COMPANY AND t.PRJC = bk.PRJC
                          AND t.PRJLINES = bk.PRJLINESS AND t.SOPLTYPE = 11
LEFT JOIN dbo.CCCCLPRJLINELOCATION loc ON loc.PRJLINELOCATION = t.CCCCLPRJLINELOCATION
GROUP BY bk.RSRC, days.wk, pj.CODE, pj.NAME, loc.CODE, loc.NAME
ORDER BY bk.RSRC, days.wk, COUNT(*) DESC, pj.CODE;

WITH ${RES}
SELECT res.RSRC, res.NAME, res.CODE1,
       rt.NAME AS RSRCTYPE_NAME, u.CODE AS UTBL01_CODE, u.NAME AS UTBL01_NAME,
       (SELECT STRING_AGG(e.NAME, ', ') WITHIN GROUP (ORDER BY e.CCCCLRMTEIDIKOTITA)
        FROM dbo.CCCCLRSRCEIDIKOTITA rs JOIN dbo.CCCCLRMTEIDIKOTITA e ON e.CCCCLRMTEIDIKOTITA = rs.CCCCLEIDIKOTITA
        WHERE rs.RSRC = res.RSRC) AS specialties
FROM res
LEFT JOIN dbo.RSRCTYPE rt ON rt.COMPANY = res.COMPANY AND rt.RSRCTYPE = res.RSRCTYPE
LEFT JOIN dbo.UTBL01   u  ON u.COMPANY = res.COMPANY AND u.SODTYPE = res.SODTYPE AND u.UTBL01 = res.UTBL01
ORDER BY rt.NAME, res.NAME, res.RSRC;

SELECT rt.RSRCTYPE, rt.CODE, rt.NAME FROM dbo.RSRCTYPE rt WHERE rt.COMPANY = @company ORDER BY rt.RSRCTYPE;
SELECT e.CCCCLRMTEIDIKOTITA, e.CODE, e.NAME FROM dbo.CCCCLRMTEIDIKOTITA e ORDER BY e.CCCCLRMTEIDIKOTITA;
SELECT u.CODE, u.NAME FROM dbo.UTBL01 u WHERE u.COMPANY = @company AND u.SODTYPE = 25 ORDER BY u.UTBL01;
SELECT COUNT(*) AS total FROM dbo.RSRC r
WHERE r.COMPANY = @company AND r.ISACTIVE = 1 AND ISNULL(r.CCCCLISGENERIC, 0) = 0;

WITH p AS (
    SELECT CAST(@start AS date) AS start_date, DATEADD(day, @days, CAST(@start AS date)) AS end_date
),
n AS (
    SELECT TOP (@days) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects
),
days AS (
    SELECT DATEADD(day, n.i, p.start_date) AS d
    FROM n CROSS JOIN p
    WHERE (DATEDIFF(day, '19000101', DATEADD(day, n.i, p.start_date)) % 7) < 5
),
bk AS (
    SELECT a.COMPANY, a.PRJC, CAST(a.fromdate AS date) AS d0, CAST(a.finaldate AS date) AS d1
    FROM dbo.PRJLINES a
    JOIN dbo.RSRC r ON r.RSRC = a.RSRC AND r.COMPANY = @company AND r.ISACTIVE = 1 AND ISNULL(r.CCCCLISGENERIC, 0) = 0
    CROSS JOIN p
    WHERE a.SOPLTYPE = 12
      AND ISNULL(a.CCCCLRMTESTIMATE, 0) = 0
      AND a.fromdate IS NOT NULL AND a.finaldate IS NOT NULL
      AND a.finaldate >= p.start_date AND a.fromdate < p.end_date
)
-- Project weight over the window across every named person in the company, before the
-- team, type and specialty filters. The board assigns its project colours from this order,
-- so narrowing to one team never repaints the projects that survive the filter.
SELECT TOP (40) ISNULL(pj.CODE, '-') AS project_code, COUNT(*) AS days_booked
FROM bk
JOIN days ON days.d BETWEEN bk.d0 AND bk.d1
LEFT JOIN dbo.PRJC pj ON pj.COMPANY = bk.COMPANY AND pj.PRJC = bk.PRJC
GROUP BY pj.CODE
ORDER BY COUNT(*) DESC, pj.CODE;`;
