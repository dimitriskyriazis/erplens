'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type DefaultMenuItem,
  type GetContextMenuItemsParams,
  type GridApi,
  type GridReadyEvent,
  type IServerSideDatasource,
  type IServerSideGetRowsParams,
  type MenuItemDef,
} from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';

declare global {
  var __TELERP_AG_GRID_READY__: boolean | undefined;
}
if (!globalThis.__TELERP_AG_GRID_READY__) {
  ModuleRegistry.registerModules([AllEnterpriseModule]);
  LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE ?? '');
  globalThis.__TELERP_AG_GRID_READY__ = true;
}

export type GridRow = Record<string, unknown>;

// Same look as FastQuote's grids: 13px text, banded rows. Row and header heights are set
// as grid props below (32 / 38, FastQuote's values).
const gridTheme = themeQuartz.withParams({
  fontSize: 13,
  headerBackgroundColor: '#f8fafc',
  oddRowBackgroundColor: '#f4f6fb',
  rowHoverColor: '#e9f1ff',
  wrapperBorderRadius: 12,
  borderRadius: 6,
});

type GridResponse = { ok?: boolean; rows?: GridRow[]; rowCount?: number; error?: string };

export type GridMenuItem = MenuItemDef<GridRow> | DefaultMenuItem;

/** Filter models the server understands (see lib/grid/filterProcessing.ts). */
type ColumnFilterModel =
  | { filterType: 'text'; type: 'contains'; filter: string }
  | { filterType: 'number'; type: 'equals'; filter: number }
  | { filterType: 'date'; type: 'equals'; dateFrom: string }
  | { filterType: 'set'; values: string[] };

export const MENU_ICON = (path: string) =>
  `<span class="telerp-menu-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;

const FILTER_ICON = MENU_ICON('<path d="M3 4h14l-5.5 5.5v5l-3-1.5v-3.5L3 4z" />');

/**
 * "Filter By" the clicked cell, as in FastQuote: the model matches the column's filter
 * type so the floating filter shows it and the server-side translation applies it.
 * Text columns use contains; dates match the day, ignoring the time.
 */
function filterModelForValue(colDef: ColDef<GridRow> | undefined, value: unknown): ColumnFilterModel | null {
  if (!colDef || colDef.filter === false || value === null || value === undefined) return null;
  const kind = typeof colDef.filter === 'string' ? colDef.filter : 'agTextColumnFilter';
  const text = String(value).trim();
  if (!text) return null;
  switch (kind) {
    case 'agSetColumnFilter':
      return { filterType: 'set', values: [text] };
    case 'agNumberColumnFilter': {
      const n = Number(text);
      return Number.isFinite(n) ? { filterType: 'number', type: 'equals', filter: n } : null;
    }
    case 'agDateColumnFilter': {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
      return m ? { filterType: 'date', type: 'equals', dateFrom: `${m[1]} 00:00:00` } : null;
    }
    default:
      return { filterType: 'text', type: 'contains', filter: text };
  }
}

type Props = {
  /** POST endpoint speaking the {request:{startRow,endRow,filterModel,sortModel,quickFilterText,...}} contract. */
  endpoint: string;
  columnDefs: ColDef<GridRow>[];
  /** Field holding a stable, globally unique id for each row. */
  rowIdField: string;
  quickFilterText?: string;
  /** Extra fields merged into every request body (e.g. company). A change reloads the grid. */
  requestExtras?: Record<string, string | number | boolean | null>;
  onGridReady?: (api: GridApi<GridRow>) => void;
  onRowCount?: (count: number) => void;
  onError?: (message: string) => void;
  /**
   * Page-specific items for the right-click menu on a row. They go first, then
   * "Filter By" on the clicked cell, then the grid's defaults (copy, export).
   */
  contextMenuItems?: (params: GetContextMenuItemsParams<GridRow>) => GridMenuItem[];
};

/**
 * AG Grid Enterprise with the server-side row model. Filtering, sorting and paging all
 * happen in SQL behind `endpoint`; this component only ships the grid's request and
 * hands the page back. One grid component for the whole app, so every screen filters,
 * sorts, copies and exports the same way.
 */
export default function ServerSideGrid({
  endpoint,
  columnDefs,
  rowIdField,
  quickFilterText = '',
  requestExtras,
  onGridReady,
  onRowCount,
  onError,
  contextMenuItems,
}: Props) {
  const apiRef = useRef<GridApi<GridRow> | null>(null);
  // Latest props for the datasource, which AG Grid holds on to across renders.
  // Synced in an effect (not during render) so React's ref rules hold; effects run in
  // declaration order, so the reload effect below always sees the fresh values.
  const quickRef = useRef(quickFilterText);
  const extrasRef = useRef(requestExtras);
  const onRowCountRef = useRef(onRowCount);
  const onErrorRef = useRef(onError);
  const menuRef = useRef(contextMenuItems);
  useEffect(() => {
    quickRef.current = quickFilterText;
    extrasRef.current = requestExtras;
    onRowCountRef.current = onRowCount;
    onErrorRef.current = onError;
    menuRef.current = contextMenuItems;
  });

  const getContextMenuItems = useCallback((params: GetContextMenuItemsParams<GridRow>): GridMenuItem[] => {
    // Read-only grid: cut and paste have nothing to do here.
    const defaults = (params.defaultItems ?? []).filter((item) => item !== 'cut' && item !== 'paste');
    const items: GridMenuItem[] = [];
    const custom = params.node ? (menuRef.current?.(params) ?? []) : [];
    if (custom.length) items.push(...custom, 'separator');
    const column = params.column;
    const model = params.node && column ? filterModelForValue(column.getColDef(), params.value) : null;
    if (model && column) {
      const colId = column.getColId();
      items.push(
        {
          name: 'Filter By',
          icon: FILTER_ICON,
          action: () => {
            const next: Record<string, unknown> = { ...(params.api.getFilterModel() ?? {}) };
            next[colId] = model;
            params.api.setFilterModel(next);
          },
        },
        'separator',
      );
    }
    return [...items, ...defaults];
  }, []);

  const datasource = useMemo<IServerSideDatasource<GridRow>>(
    () => ({
      getRows: async (params: IServerSideGetRowsParams<GridRow>) => {
        const { startRow, endRow, filterModel, sortModel } = params.request;
        const body = {
          request: {
            startRow: startRow ?? 0,
            endRow: endRow ?? 100,
            filterModel: filterModel ?? null,
            sortModel: sortModel.map((s) => ({ colId: s.colId, sort: s.sort })),
            quickFilterText: quickRef.current || null,
            ...(extrasRef.current ?? {}),
          },
        };
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const payload = (await res.json().catch(() => null)) as GridResponse | null;
          if (!res.ok || !payload?.ok || !payload.rows) {
            throw new Error(payload?.error ?? `HTTP ${res.status}`);
          }
          params.success({ rowData: payload.rows, rowCount: payload.rowCount });
          if (typeof payload.rowCount === 'number') onRowCountRef.current?.(payload.rowCount);
        } catch (err) {
          onErrorRef.current?.(err instanceof Error ? err.message : String(err));
          params.fail();
        }
      },
    }),
    [endpoint],
  );

  // Reload when the search text or the extras change. The extras are serialised so a
  // new object with identical content does not trigger a reload.
  const extrasKey = JSON.stringify(requestExtras ?? {});
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    apiRef.current?.refreshServerSide({ purge: true });
  }, [quickFilterText, extrasKey]);

  // FastQuote's column defaults: a floating filter row under the headers, no header menu
  // button (right-click still opens it), two-condition filters that apply after an
  // 800 ms typing pause so each change costs one SQL round trip, not one per keystroke.
  const defaultColDef = useMemo<ColDef<GridRow>>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      floatingFilter: true,
      suppressHeaderMenuButton: true,
      width: 100,
      minWidth: 80,
      filterParams: {
        debounceMs: 800,
        buttons: ['reset'],
        maxNumConditions: 2,
        alwaysShowBothConditions: true,
        defaultJoinOperator: 'AND',
      },
    }),
    [],
  );

  const handleReady = useCallback(
    (event: GridReadyEvent<GridRow>) => {
      apiRef.current = event.api;
      onGridReady?.(event.api);
    },
    [onGridReady],
  );

  return (
    <div className="grid-frame">
      <AgGridReact<GridRow>
        theme={gridTheme}
        rowModelType="serverSide"
        serverSideDatasource={datasource}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowHeight={32}
        headerHeight={38}
        localeText={{ resetFilter: 'Clear', dateFormatOoo: 'dd/mm/yyyy' }}
        getRowId={(p) => String(p.data[rowIdField])}
        cacheBlockSize={100}
        maxBlocksInCache={20}
        blockLoadDebounceMillis={100}
        sideBar={{ toolPanels: ['columns', 'filters'] }}
        statusBar={{
          statusPanels: [{ statusPanel: 'agSelectedRowCountComponent' }, { statusPanel: 'agAggregationComponent' }],
        }}
        cellSelection
        getContextMenuItems={getContextMenuItems}
        onGridReady={handleReady}
      />
    </div>
  );
}
