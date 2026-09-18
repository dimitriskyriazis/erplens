'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { ColDef, GetContextMenuItemsParams, ValueFormatterParams } from 'ag-grid-community';
import PageHeader from '@/app/components/PageHeader';
import { MENU_ICON, type GridMenuItem, type GridRow } from '@/app/components/ServerSideGrid';

const PLAN_ICON = MENU_ICON('<path d="M3 4h14v12H3z" /><path d="M6 8h5M6 11h8M6 14h3" />');

// AG Grid touches window at import time, so it only loads in the browser.
const ServerSideGrid = dynamic(() => import('@/app/components/ServerSideGrid'), {
  ssr: false,
  loading: () => <div className="grid-frame grid-loading">Loading grid…</div>,
});

type Company = { id: number; name: string };
type Props = { companies: Company[]; defaultCompany: number };

/** 'yyyy-MM-dd HH:mm' from the API -> 'dd/MM/yyyy HH:mm' for the screen. */
const formatDateTime = (p: ValueFormatterParams<GridRow>) => {
  const v = p.value as string | null | undefined;
  if (!v) return '';
  const [date, time] = v.split(' ');
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}${time ? ` ${time}` : ''}`;
};

export default function RmtTasksClient({ companies, defaultCompany }: Props) {
  const [company, setCompany] = useState(defaultCompany);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: 'ProjectCode', headerName: 'Project', width: 130, filter: 'agTextColumnFilter', pinned: 'left' },
      { field: 'ProjectName', headerName: 'Project name', flex: 1, minWidth: 200, filter: 'agTextColumnFilter' },
      { field: 'TaskName', headerName: 'Task', flex: 1.2, minWidth: 220, filter: 'agTextColumnFilter' },
      { field: 'TaskStart', headerName: 'Start', width: 150, filter: 'agDateColumnFilter', valueFormatter: formatDateTime },
      { field: 'TaskEnd', headerName: 'End', width: 150, filter: 'agDateColumnFilter', valueFormatter: formatDateTime },
      { field: 'DurationDays', headerName: 'Days', width: 90, type: 'numericColumn', filter: 'agNumberColumnFilter' },
      { field: 'TaskPhaseName', headerName: 'Phase', width: 180, filter: 'agTextColumnFilter' },
      { field: 'TaskStatusName', headerName: 'Status', width: 120, filter: 'agTextColumnFilter' },
      { field: 'PRJC', headerName: 'PRJC', width: 100, type: 'numericColumn', filter: 'agNumberColumnFilter', hide: true },
      { field: 'TaskID', headerName: 'Task ID', width: 110, type: 'numericColumn', filter: 'agNumberColumnFilter', hide: true },
      { field: 'TaskLineID', headerName: 'Line ID', width: 100, type: 'numericColumn', filter: 'agNumberColumnFilter', hide: true },
      { field: 'TaskPhaseCode', headerName: 'Phase code', width: 110, filter: 'agTextColumnFilter', hide: true },
      { field: 'TaskStatusCode', headerName: 'Status code', width: 110, filter: 'agTextColumnFilter', hide: true },
    ],
    [],
  );

  const requestExtras = useMemo(() => ({ company }), [company]);

  // Right-click on a task: jump to its project's plan.
  const router = useRouter();
  const contextMenuItems = useCallback(
    (params: GetContextMenuItemsParams<GridRow>): GridMenuItem[] => {
      const row = params.node?.data;
      const prjc = Number(row?.PRJC);
      if (!Number.isFinite(prjc) || prjc <= 0) return [];
      const rowCompany = Number(row?.COMPANY) || company;
      const code = typeof row?.ProjectCode === 'string' && row.ProjectCode ? ` (${row.ProjectCode})` : '';
      return [
        {
          name: `View project's plan${code}`,
          icon: PLAN_ICON,
          action: () => router.push(`/rmt/projects/${prjc}?company=${rowCompany}`),
        },
      ];
    },
    [router, company],
  );

  return (
    <main className="page">
      <PageHeader
        title="RMT Tasks"
        leftActions={
          <input
            className="header-control header-control--search"
            type="search"
            placeholder="Search project, task, phase, status"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tasks"
          />
        }
        rightActions={
          <>
            {rowCount !== null && <span className="page-count">{rowCount.toLocaleString('el-GR')} tasks</span>}
            <label className="header-label">
              <span>Company</span>
              <select className="header-control" value={company} onChange={(e) => setCompany(Number(e.target.value))}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      >
        {error && <div className="banner banner--error">Query failed: {error}</div>}
        <ServerSideGrid
          endpoint="/api/rmt/tasks"
          columnDefs={columnDefs}
          rowIdField="TaskID"
          quickFilterText={debouncedSearch}
          requestExtras={requestExtras}
          contextMenuItems={contextMenuItems}
          onRowCount={(n) => {
            setRowCount(n);
            setError(null);
          }}
          onError={setError}
        />
      </PageHeader>
    </main>
  );
}
