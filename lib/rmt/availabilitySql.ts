/**
 * The availability query, kept import-free so a plain Node script can load and run it
 * against the database with the same parameters the app binds (see the header comment in
 * availabilityQueries.ts for the semantics).
 *
 * Parameters: @company, @start (yyyy-MM-dd, a Monday), @days (weeks * 7), @team (RSRCTYPE,
 * 0 = all), @type (UTBL01 code for SODTYPE 25, '' = all), @spec (CCCCLRMTEIDIKOTITA, 0 = all),
 * @history (1 = only people with a booking in the 365 days before the window or inside it).
 */

/**
 * Window and resource scope, shared by the per-week statement and the bookings statement
 * (a CTE only lives for one statement, and the read-only guard rules out temp tables).
 *
 * bk holds every booking line that touches the window and belongs to a resource in scope.
 * Named people count their planned lines only (CCCCLRMTESTIMATE = 0); a generic placeholder
 * counts every line on it, since anything booked on a generic is demand.
 *
 * frac is the share of one working day a line takes. A named person is taken for the whole
 * day by a multi-day booking and for hours / 8 by a same-day one. A generic estimate says
 * "N person-days somewhere in this span" (CCCCLNUMBEROFRSRC), often over months, so its N
 * is spread evenly over the Monday-to-Friday days of the span; an estimate without a figure
 * falls back to the named rule.
 */
const SCOPE = `
WITH p AS (
    SELECT CAST(@start AS date) AS start_date, DATEADD(day, @days, CAST(@start AS date)) AS end_date
),
res AS (
    SELECT r.COMPANY, r.RSRC, r.NAME, r.CODE1, r.RSRCTYPE, r.UTBL01, r.SODTYPE,
           ISNULL(r.CCCCLISGENERIC, 0) AS generic
    FROM dbo.RSRC r CROSS JOIN p
    WHERE r.COMPANY = @company
      AND r.ISACTIVE = 1
      AND (@team = 0 OR r.RSRCTYPE = @team)
      AND (@type = '' OR EXISTS (SELECT 1 FROM dbo.UTBL01 u
                                 WHERE u.COMPANY = r.COMPANY AND u.SODTYPE = r.SODTYPE AND u.UTBL01 = r.UTBL01 AND u.CODE = @type))
      AND (@spec = 0 OR EXISTS (SELECT 1 FROM dbo.CCCCLRSRCEIDIKOTITA rs WHERE rs.RSRC = r.RSRC AND rs.CCCCLEIDIKOTITA = @spec))
      AND (@history = 0 OR EXISTS (SELECT 1 FROM dbo.PRJLINES h
                                   WHERE h.SOPLTYPE = 12 AND h.RSRC = r.RSRC
                                     AND h.finaldate >= DATEADD(day, -365, p.start_date) AND h.fromdate < p.end_date))
),
bk AS (
    SELECT a.COMPANY, a.PRJC, a.PRJLINESS, a.CCCID, a.RSRC, a.fromdate, a.finaldate,
           a.CCCCLRMTREMARKS, a.CCCCLNUMBEROFRSRC,
           ISNULL(a.CCCCLISTRAVEL, 0)    AS CCCCLISTRAVEL,
           ISNULL(a.CCCCLRMTESTIMATE, 0) AS CCCCLRMTESTIMATE,
           dd.d0, dd.d1,
           CASE WHEN res.generic = 1 AND a.CCCCLNUMBEROFRSRC IS NOT NULL
                THEN a.CCCCLNUMBEROFRSRC / NULLIF(s.span_work_days, 0)
                ELSE s.day_frac END AS frac
    FROM dbo.PRJLINES a
    JOIN res ON res.RSRC = a.RSRC AND (res.generic = 1 OR ISNULL(a.CCCCLRMTESTIMATE, 0) = 0)
    CROSS JOIN p
    CROSS APPLY (SELECT CAST(a.fromdate AS date) AS d0, CAST(a.finaldate AS date) AS d1) AS dd
    -- n: calendar days in the span, inclusive. w0: weekday of its first day, 0 = Monday
    -- (1900-01-01 was a Monday, so this is independent of DATEFIRST). r: days past full weeks.
    CROSS APPLY (SELECT DATEDIFF(day, dd.d0, dd.d1) + 1 AS n,
                        DATEDIFF(day, '19000101', dd.d0) % 7 AS w0,
                        (DATEDIFF(day, dd.d0, dd.d1) + 1) % 7 AS r) AS sp
    CROSS APPLY (SELECT
        CASE WHEN dd.d0 <> dd.d1                                            THEN 1.0
             WHEN DATEDIFF(second, a.fromdate, a.finaldate) / 28800.0 > 1  THEN 1.0
             ELSE DATEDIFF(second, a.fromdate, a.finaldate) / 28800.0 END   AS day_frac,
        -- Monday-to-Friday days in the span: five per full week, plus the remainder days
        -- minus those of them that fall on weekday 5 or 6.
        5 * (sp.n / 7) + sp.r
          - CASE WHEN sp.w0 + sp.r - 1 >= 5
                 THEN (CASE WHEN sp.w0 + sp.r - 1 > 6 THEN 6 ELSE sp.w0 + sp.r - 1 END)
                      - (CASE WHEN sp.w0 > 5 THEN sp.w0 ELSE 5 END) + 1
                 ELSE 0 END                                                  AS span_work_days) AS s
    WHERE a.SOPLTYPE = 12
      AND a.fromdate IS NOT NULL AND a.finaldate IS NOT NULL
      AND a.finaldate >= p.start_date AND a.fromdate < p.end_date
)`;

export const AVAILABILITY_SQL = `${SCOPE},
n AS (
    SELECT TOP (@days) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects
),
days AS (
    -- Monday to Friday only. 1900-01-01 was a Monday, so this is independent of DATEFIRST.
    SELECT DATEADD(day, n.i, p.start_date) AS d, n.i / 7 AS wk
    FROM n CROSS JOIN p
    WHERE (DATEDIFF(day, '19000101', DATEADD(day, n.i, p.start_date)) % 7) < 5
),
cell AS (
    -- demand: everything booked on the day, uncapped, so two full bookings read as 2.
    -- booked: the share of the day actually taken, never more than 1.
    SELECT res.RSRC, days.d, days.wk,
           ISNULL(SUM(bk.frac), 0) AS demand,
           CASE WHEN ISNULL(SUM(bk.frac), 0) > 1 THEN 1 ELSE ISNULL(SUM(bk.frac), 0) END AS booked
    FROM res CROSS JOIN days
    LEFT JOIN bk ON bk.RSRC = res.RSRC AND days.d BETWEEN bk.d0 AND bk.d1
    GROUP BY res.RSRC, days.d, days.wk
),
perweek AS (
    -- free_days is the whole week; free_ahead and first_free only count today and later,
    -- because a day already past cannot be assigned any more.
    SELECT RSRC, wk,
           COUNT(*)          AS work_days,
           SUM(1 - booked)   AS free_days,
           SUM(CASE WHEN d >= CAST(GETDATE() AS date) THEN 1 - booked ELSE 0 END) AS free_ahead,
           SUM(demand)       AS booked_days,
           MIN(CASE WHEN booked < 1 AND d >= CAST(GETDATE() AS date) THEN d END) AS first_free
    FROM cell GROUP BY RSRC, wk
)
SELECT res.RSRC, res.NAME, res.CODE1, res.generic,
       rt.NAME AS RSRCTYPE_NAME, u.CODE AS UTBL01_CODE, u.NAME AS UTBL01_NAME,
       (SELECT STRING_AGG(e.NAME, ', ') WITHIN GROUP (ORDER BY e.CCCCLRMTEIDIKOTITA)
        FROM dbo.CCCCLRSRCEIDIKOTITA rs JOIN dbo.CCCCLRMTEIDIKOTITA e ON e.CCCCLRMTEIDIKOTITA = rs.CCCCLEIDIKOTITA
        WHERE rs.RSRC = res.RSRC) AS specialties,
       pw.wk, DATEADD(day, pw.wk * 7, p.start_date) AS week_start,
       pw.work_days, pw.free_days, pw.free_ahead, pw.booked_days, pw.first_free
FROM res CROSS JOIN p
LEFT JOIN dbo.RSRCTYPE rt ON rt.COMPANY = res.COMPANY AND rt.RSRCTYPE = res.RSRCTYPE
LEFT JOIN dbo.UTBL01   u  ON u.COMPANY = res.COMPANY AND u.SODTYPE = res.SODTYPE AND u.UTBL01 = res.UTBL01
JOIN perweek pw ON pw.RSRC = res.RSRC
ORDER BY res.NAME, res.RSRC, pw.wk;
${SCOPE}
SELECT bk.RSRC, bk.CCCID, bk.fromdate, bk.finaldate, bk.CCCCLISTRAVEL, bk.CCCCLRMTESTIMATE,
       bk.CCCCLNUMBEROFRSRC, bk.CCCCLRMTREMARKS,
       pj.CODE AS PRJC_CODE, pj.NAME AS PRJC_NAME, t.NAME AS TASK_NAME
FROM bk
LEFT JOIN dbo.PRJC     pj ON pj.COMPANY = bk.COMPANY AND pj.PRJC = bk.PRJC
LEFT JOIN dbo.PRJLINES t  ON t.COMPANY = bk.COMPANY AND t.PRJC = bk.PRJC AND t.PRJLINES = bk.PRJLINESS AND t.SOPLTYPE = 11
ORDER BY bk.RSRC, bk.fromdate, bk.finaldate, bk.CCCID;
SELECT rt.RSRCTYPE, rt.CODE, rt.NAME FROM dbo.RSRCTYPE rt WHERE rt.COMPANY = @company ORDER BY rt.RSRCTYPE;
SELECT e.CCCCLRMTEIDIKOTITA, e.CODE, e.NAME FROM dbo.CCCCLRMTEIDIKOTITA e ORDER BY e.CCCCLRMTEIDIKOTITA;
SELECT u.CODE, u.NAME FROM dbo.UTBL01 u WHERE u.COMPANY = @company AND u.SODTYPE = 25 ORDER BY u.UTBL01;
SELECT COUNT(*) AS total FROM dbo.RSRC r WHERE r.COMPANY = @company AND r.ISACTIVE = 1;`;
