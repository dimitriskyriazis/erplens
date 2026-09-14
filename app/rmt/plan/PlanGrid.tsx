'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GetDataPath,
  type GridApi,
  type GridReadyEvent,
  type RowClassParams,
  type RowGroupOpenedEvent,
  type ValueFormatterParams,
} from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import TimelineCell from './TimelineCell';
import TimelineHeader from './TimelineHeader';
import { hideBarTip } from './barTip';
import { DAY_MS, buildPlanModel, fmtDate, shortName, type PlanRow, type Range, type TimeScale } from '@/lib/rmt/planModel';
import type { ProjectTimeline } from '@/lib/rmt/timelineQueries';

declare global {
  var __TELERP_AG_GRID_READY__: boolean | undefined;
}
if (!globalThis.__TELERP_AG_GRID_READY__) {
  ModuleRegistry.registerModules([AllEnterpriseModule]);
  LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE ?? '');
  globalThis.__TELERP_AG_GRID_READY__ = true;
}

const gridTheme = themeQuartz.withParams({
  fontSize: 13,
  headerBackgroundColor: '#f8fafc',
  oddRowBackgroundColor: '#ffffff',
  rowBorder: { color: '#eef2f7' },
});

type Props = {
  data: Pick<ProjectTimeline, 'tasks' | 'actions' | 'done'>;
  /** Wall-clock at load time (ms). Passed in so rendering stays pure; drives the Today line. */
  now: number;
};

const TIMELINE_COL = 'timeline';
const MIN_PX_PER_DAY = 0.3;
const MAX_PX_PER_DAY = 120;
const SCROLLBAR_PX = 18;

// Dates only in the grid; the bars and their tooltips carry the times.
const fmtCell = (p: ValueFormatterParams<PlanRow, number | null>) => fmtDate(p.value ?? null);
/** Columns that go to Excel and CSV: everything but the drawn timeline. */
const EXPORT_COLUMNS = ['ag-Grid-AutoColumn', 'start', 'end', 'plannedDays', 'doneHours', 'estimateDays', 'phase', 'status'];
const fmtNum = (p: ValueFormatterParams<PlanRow, number | null>) => (p.value === null || p.value === undefined ? '' : String(p.value));

/**
 * The plan as a tree grid: tasks, and under each task its people, with a wide timeline
 * column drawing the bars against a shared scale. Expand and collapse, filters, export
 * and virtualisation come from the grid; the timeline is one header plus one cell renderer.
 */
export default function PlanGrid({ data, now }: Props) {
  const apiRef = useRef<GridApi<PlanRow> | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [onlyPeople, setOnlyPeople] = useState<Set<string>>(() => new Set());
  const [pxPerDay, setPxPerDay] = useState(8);
  const [fitRequest, setFitRequest] = useState<{ range: Range; seq: number } | null>(null);

  const model = useMemo(() => buildPlanModel(data, now), [data, now]);

  const scale = useMemo<TimeScale>(() => ({ start: model.full.start, end: model.full.end, pxPerDay, now }), [model.full, pxPerDay, now]);
  const timelineWidth = Math.max(200, Math.ceil(((scale.end - scale.start) / DAY_MS) * scale.pxPerDay));
  const context = useMemo(() => ({ scale }), [scale]);

  // Person filter: their rows, on the tasks they appear on.
  const rows = useMemo(() => {
    if (onlyPeople.size === 0) return model.rows;
    const keepTasks = new Set(model.rows.filter((r) => r.who && onlyPeople.has(r.who)).map((r) => r.task));
    return model.rows.filter((r) => keepTasks.has(r.task) && (r.who === null || onlyPeople.has(r.who)));
  }, [model.rows, onlyPeople]);

  const columnDefs = useMemo<ColDef<PlanRow>[]>(
    () => [
      { field: 'start', headerName: 'Start', width: 108, pinned: 'left', valueFormatter: fmtCell, filter: 'agDateColumnFilter', filterValueGetter: (p) => (p.data?.start ? new Date(p.data.start) : null) },
      { field: 'end', headerName: 'End', width: 108, pinned: 'left', valueFormatter: fmtCell, filter: 'agDateColumnFilter', filterValueGetter: (p) => (p.data?.end ? new Date(p.data.end) : null) },
      { field: 'plannedDays', headerName: 'Plan days', width: 88, pinned: 'left', type: 'numericColumn', valueFormatter: fmtNum, headerTooltip: 'Planned calendar days' },
      { field: 'doneHours', headerName: 'Done hrs', width: 88, pinned: 'left', type: 'numericColumn', valueFormatter: fmtNum, headerTooltip: 'Logged hours' },
      { field: 'estimateDays', headerName: 'Est. days', width: 88, pinned: 'left', type: 'numericColumn', valueFormatter: fmtNum, headerTooltip: 'Estimated person-days (generic resources)', hide: true },
      { field: 'phase', headerName: 'Phase', width: 150, pinned: 'left', hide: true },
      { field: 'status', headerName: 'Status', width: 110, pinned: 'left', hide: true },
      {
        colId: TIMELINE_COL,
        headerName: '',
        width: timelineWidth,
        minWidth: 200,
        resizable: false,
        sortable: false,
        filter: false,
        suppressMovable: true,
        suppressHeaderMenuButton: true,
        suppressColumnsToolPanel: true,
        suppressNavigable: true,
        floatingFilter: false,
        cellRenderer: TimelineCell,
        headerComponent: TimelineHeader,
        cellStyle: { padding: 0 },
      },
    ],
    // Width is applied through setColumnWidths below; the initial value only matters on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const autoGroupColumnDef = useMemo<ColDef<PlanRow>>(
    () => ({
      headerName: 'Task / person',
      field: 'name',
      pinned: 'left',
      width: 260,
      minWidth: 180,
      sortable: false,
      filter: 'agTextColumnFilter',
      cellRendererParams: { suppressCount: true },
      tooltipValueGetter: (p) => (p.data?.who ? p.data.who : p.data?.name ?? ''),
    }),
    [],
  );

  // FastQuote's grid habits: a floating filter row, no header buttons (right-click for the menu).
  const defaultColDef = useMemo<ColDef<PlanRow>>(
    () => ({
      sortable: false,
      resizable: true,
      filter: true,
      floatingFilter: true,
      suppressHeaderMenuButton: true,
      suppressHeaderFilterButton: true,
      filterParams: { buttons: ['reset'], debounceMs: 500 },
    }),
    [],
  );

  const getDataPath = useCallback<GetDataPath<PlanRow>>((row) => row.path, []);

  const rowClassRules = useMemo(
    () => ({ 'plan-row--task': (p: RowClassParams<PlanRow>) => p.data?.kind === 'task' || p.data?.kind === 'notask' }),
    [],
  );

  /** Width available to the timeline column: the frame minus pinned columns and scrollbar. */
  const availableWidth = useCallback(() => {
    const api = apiRef.current;
    const frame = frameRef.current;
    if (!api || !frame) return 800;
    const pinned = api.getDisplayedLeftColumns().reduce((s, c) => s + c.getActualWidth(), 0);
    return Math.max(240, frame.clientWidth - pinned - SCROLLBAR_PX);
  }, []);

  const scrollTo = useCallback((t: number, px: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const left = ((t - scale.start) / DAY_MS) * px;
    const viewport = frame.querySelector<HTMLElement>('.ag-center-cols-viewport');
    if (viewport) viewport.scrollLeft = Math.max(0, left);
  }, [scale.start]);

  const fit = useCallback((range: Range | null) => {
    if (!range) return;
    setFitRequest((prev) => ({ range, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Apply a fit once the api and frame exist: zoom so the range spans the viewport, then
  // scroll to its start on the next frame, after the column width has been applied.
  useEffect(() => {
    if (!fitRequest || !apiRef.current) return;
    const days = Math.max(1, (fitRequest.range.end - fitRequest.range.start) / DAY_MS);
    const px = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, availableWidth() / days));
    setPxPerDay(px);
    const start = fitRequest.range.start;
    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(() => scrollTo(start, px)));
    return () => window.cancelAnimationFrame(id);
  }, [fitRequest, availableWidth, scrollTo]);

  // Zoom changes: resize the column and repaint header and timeline cells.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setGridOption('context', context);
    api.setColumnWidths([{ key: TIMELINE_COL, newWidth: timelineWidth }]);
    api.refreshHeader();
    api.refreshCells({ columns: [TIMELINE_COL], force: true });
  }, [context, timelineWidth]);

  const zoomBy = useCallback((factor: number) => {
    const frame = frameRef.current;
    const viewport = frame?.querySelector<HTMLElement>('.ag-center-cols-viewport');
    // Keep the time under the middle of the viewport where it is.
    const centreT = viewport ? scale.start + ((viewport.scrollLeft + viewport.clientWidth / 2) / scale.pxPerDay) * DAY_MS : null;
    const px = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, scale.pxPerDay * factor));
    setPxPerDay(px);
    if (centreT !== null && viewport) {
      const target = ((centreT - scale.start) / DAY_MS) * px - viewport.clientWidth / 2;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, target);
      }));
    }
  }, [scale]);

  const onGridReady = useCallback(
    (e: GridReadyEvent<PlanRow>) => {
      apiRef.current = e.api;
      fit(model.workRange ?? model.full);
    },
    [fit, model.workRange, model.full],
  );

  // New data on a live grid (same project reloaded): fit again, the dates may have moved.
  const firstModel = useRef(true);
  useEffect(() => {
    if (firstModel.current) {
      firstModel.current = false;
      return;
    }
    if (apiRef.current) fit(model.workRange ?? model.full);
  }, [model, fit]);

  // A collapsed task row shows its people's bars; repaint it when it opens or closes.
  const onRowGroupOpened = useCallback((e: RowGroupOpenedEvent<PlanRow>) => {
    e.api.refreshCells({ rowNodes: [e.node], columns: [TIMELINE_COL], force: true });
  }, []);

  const togglePerson = useCallback((who: string) => {
    setOnlyPeople((prev) => {
      const next = new Set(prev);
      if (next.has(who)) next.delete(who);
      else next.add(who);
      return next;
    });
  }, []);

  // When focusing on people, open every task so their rows are visible.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (onlyPeople.size > 0) window.requestAnimationFrame(() => api.expandAll());
  }, [onlyPeople, rows]);

  const todayRange = useMemo<Range | null>(() => {
    if (now < model.full.start || now > model.full.end) return null;
    return { start: Math.max(model.full.start, now - 14 * DAY_MS), end: Math.min(model.full.end, now + 31 * DAY_MS) };
  }, [model.full, now]);

  const hasEstimates = model.rows.some((r) => r.kind === 'estimate');

  return (
    <div className="plan">
      <div className="timeline-toolbar">
        <div className="timeline-buttons" role="group" aria-label="View">
          <button type="button" className="timeline-btn" onClick={() => fit(model.workRange)} disabled={!model.workRange} title="Zoom to where most of the work is">
            Fit work
          </button>
          <button type="button" className="timeline-btn" onClick={() => fit(model.full)}>
            Fit all
          </button>
          <button type="button" className="timeline-btn" onClick={() => fit(todayRange)} disabled={!todayRange}>
            Around today
          </button>
          <button type="button" className="timeline-btn" onClick={() => zoomBy(1.6)} title="Zoom in" aria-label="Zoom in">
            +
          </button>
          <button type="button" className="timeline-btn" onClick={() => zoomBy(1 / 1.6)} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <span className="timeline-sep" aria-hidden="true" />
          <button type="button" className="timeline-btn" onClick={() => apiRef.current?.expandAll()}>
            Expand all
          </button>
          <button type="button" className="timeline-btn" onClick={() => apiRef.current?.collapseAll()} disabled={onlyPeople.size > 0}>
            Collapse all
          </button>
          {onlyPeople.size > 0 && (
            <button type="button" className="timeline-btn is-active" onClick={() => setOnlyPeople(new Set())}>
              Show everyone ({onlyPeople.size} selected)
            </button>
          )}
          <span className="timeline-hint">Click a task to open its people. Scroll sideways through time. Click a name to focus on that person.</span>
        </div>
        <div className="lane-legend" aria-label="Bar styles">
          <span>
            <i className="swatch" style={{ background: '#94a3b8' }} /> Task span
          </span>
          {hasEstimates && (
            <span>
              <i className="swatch swatch--dashed" style={{ background: '#a5b4fc', borderColor: '#6366f1' }} /> Estimate (generic)
            </span>
          )}
          <span>
            <i className="swatch swatch--outline" /> Planned
          </span>
          <span>
            <i className="swatch swatch--solid" /> Done
          </span>
        </div>
      </div>
      {model.people.length > 0 && (
        <div className="tech-chips" aria-label="People">
          {model.people.map(({ who, colour }) => {
            const selected = onlyPeople.has(who);
            const dimmed = onlyPeople.size > 0 && !selected;
            return (
              <button
                key={who}
                type="button"
                className={`chip${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
                onClick={() => togglePerson(who)}
                title={who}
                aria-pressed={selected}
              >
                <i className="dot" style={{ background: colour }} />
                {shortName(who)}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid-frame plan-frame" ref={frameRef}>
        <AgGridReact<PlanRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          autoGroupColumnDef={autoGroupColumnDef}
          treeData
          getDataPath={getDataPath}
          getRowId={(p) => p.data.id}
          groupDefaultExpanded={0}
          rowClassRules={rowClassRules}
          context={context}
          rowHeight={32}
          headerHeight={48}
          defaultExcelExportParams={{ columnKeys: EXPORT_COLUMNS }}
          defaultCsvExportParams={{ columnKeys: EXPORT_COLUMNS }}
          suppressCellFocus
          animateRows={false}
          sideBar={{ toolPanels: ['columns'] }}
          onGridReady={onGridReady}
          onRowGroupOpened={onRowGroupOpened}
          onBodyScroll={hideBarTip}
        />
      </div>
    </div>
  );
}
