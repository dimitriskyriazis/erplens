# TelERP

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
  api/meta              connection facts, companies, task counts
  rmt/tasks             first screen: RMT tasks grid
  components/           ServerSideGrid, SideNav, PageHeader
lib/
  sql.ts                ERP pool + read-only guard
  grid/                 AG Grid request -> parameterised T-SQL
  rmt/tasksRelation.ts  task relation + column whitelist
scripts/sql/            hand-over scripts (review, then run manually)
```

## RMT data model (as found on 2026-09-09)

- Tasks: `dbo.PRJLINES` with `SOPLTYPE = 11`. `PRJLINES` is unique only within a project;
  `CCCID` is the global id. Phase lookup `CCCCLRMTSTATUSTYPE`, status lookup
  `CCCCLRMTLINESSTATUS`, both keyed with `COMPANY`.
- Actions (planned / estimate): `dbo.PRJLINES` with `SOPLTYPE = 12`, one row per resource
  (`RSRC`) per interval, parent task via `PRJLINESS`, `CCCCLRMTESTIMATE` 0 = planned, 1 = estimate.
- Actions done: `dbo.SOACTION` rows linked to `PRJC` and `PRJLINES`, actor resolved
  through `USERS` to `RSRC`.
- Resources: `tlm.vwRMTResources`. Dependencies table `CCCCLRMTDEPENDENCY` exists but is empty.
