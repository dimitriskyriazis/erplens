'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IServerSideDatasource,
  type IServerSideGetRowsParams,
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
}: Props) {
  const apiRef = useRef<GridApi<GridRow> | null>(null);
  // Latest props for the datasource, which AG Grid holds on to across renders.
  // Synced in an effect (not during render) so React's ref rules hold; effects run in
  // declaration order, so the reload effect below always sees the fresh values.
  const quickRef = useRef(quickFilterText);
  const extrasRef = useRef(requestExtras);
  const onRowCountRef = useRef(onRowCount);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    quickRef.current = quickFilterText;
    extrasRef.current = requestExtras;
    onRowCountRef.current = onRowCount;
    onErrorRef.current = onError;
  });

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
        onGridReady={handleReady}
      />
    </div>
  );
}
