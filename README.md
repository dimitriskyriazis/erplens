# ERPLens

Operational views and live stats over the Soft1 ERP (SOFT1_ERP on TELDB2) for three
domains: Projects (sales and delivery), RMT (resource management) and Maintenance
(contracts). Replaces the Access/VBA TelERP front end. Same stack as FastQuote:
Next.js, AG Grid Enterprise with the server-side row model, SQL Server via `mssql`.

## Hard rules

- **Read-only against SOFT1_ERP.** `lib/sql.ts` refuses any statement that is not a
  SELECT. Schema changes (views and procs in the `tlm` schema) are delivered as scripts in
  `scripts/sql/` and run by a person after review. Nothing in this app runs DDL.
- **Never touch `dbo`.** Soft1's own objects stay as they are. Everything we add lives in `tlm`.
- **Logic lives in SQL, not in routes.** Derived columns and roll-ups belong in `tlm`
  views and procs. An API route validates input, calls one relation, streams a page back.
- **Grids use the server-side row model.** Filtering, sorting and paging happen in SQL
  through the whitelist pattern in `lib/grid/`.

## Run

```bash
cp .env.example .env.local   # then fill in the SQL login
npm install
npm run dev                  # http://localhost:3000
npm test                     # lint + typecheck
```

## Layout

```
app/                    routes (App Router)
  api/rmt/tasks         SSRM endpoint for the RMT tasks grid
  api/rmt/timeline      one project's tasks, planned/estimate actions and logged actions
  api/rmt/projects      projects with RMT tasks, for the project picker
  api/rmt/availability  free days per person per week, and the generic placeholders' demand
  api/rmt/deployment    where people are, per column, for the board
  api/rmt/delivery      estimate, planned and done per project and task
  api/meta              connection facts, companies, task counts
  rmt/tasks             RMT tasks grid (server-side row model)
  rmt/availability      who is free (or busiest) over a span, with unassigned demand under it
  rmt/deployment        where people are: person by column, colour for destination
  rmt/projects          estimate / planned / done per project
  rmt/projects/[prjc]   that project's plan: tasks and people with a drawn timeline column
  rmt/components/       ProjectPicker, useProjectTimeline (shared by RMT screens)
  components/           ServerSideGrid, SideNav, PageHeader
lib/
  sql.ts                ERP pool + read-only guard
  grid/                 AG Grid request -> parameterised T-SQL
  rmt/tasksRelation.ts  task relation + column whitelist
  rmt/timelineQueries.ts  actions and logged work per project
  rmt/planModel.ts      rows and bars for the plan grid (pure)
  rmt/timeScale.ts      span and step, shared by every RMT screen
scripts/sql/            hand-over scripts (review, then run manually)
```

## RMT data model (as found on 2026-09-09)

- Tasks: `dbo.PRJLINES` with `SOPLTYPE = 11`. `PRJLINES` is unique only within a project;
  `CCCID` is the global id. Phase lookup `CCCCLRMTSTATUSTYPE`, status lookup
  `CCCCLRMTLINESSTATUS`, both keyed with `COMPANY`.
- Actions (planned / estimate): `dbo.PRJLINES` with `SOPLTYPE = 12`, one row per resource
  (`RSRC`) per interval, parent task via `PRJLINESS`, `CCCCLRMTESTIMATE` 0 = planned, 1 = estimate.
- Actions done: `dbo.SOACTION` with `SOSOURCE = 2021`, linked to `PRJC` and to a task
  through `NUM03` (the task's `CCCID`) falling back to `PRJLINES`. `SOACTION.RSRC` is never
  filled, so the actor is resolved through `RSRC.CCCCLUSERS`.
- Resources: `tlm.vwRMTResources`. Dependencies table `CCCCLRMTDEPENDENCY` exists but is empty.

**ERPLens reads these base tables directly.** It does not depend on the `dbo.eqrRMT*` views,
which belong to Soft1's own reports: depending on them would mean we could not change the
shape we need without touching `dbo`. The relations live in `lib/rmt/*.ts` and were verified
against those views on 2026-09-17 (identical rows for tasks and for planned/estimate actions).
