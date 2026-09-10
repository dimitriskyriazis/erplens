'use client';

import { useMemo } from 'react';
import { AgCharts } from 'ag-charts-react';
import { LicenseManager } from 'ag-charts-enterprise';
import type { AgCartesianChartOptions, AgRangeBarSeriesOptions } from 'ag-charts-enterprise';
import type { TimelineAction, TimelineDone, TimelineTask } from '@/lib/rmt/timelineQueries';

// Same key as the grid: an Enterprise Bundle key unlocks zoom, navigator and crosshair
// without the trial watermark. Without one the chart still renders, watermarked.
declare global {
  var __TELERP_AG_CHARTS_READY__: boolean | undefined;
}
if (!globalThis.__TELERP_AG_CHARTS_READY__) {
  LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE ?? '');
  globalThis.__TELERP_AG_CHARTS_READY__ = true;
}

type Props = {
  tasks: TimelineTask[];
  actions: TimelineAction[];
  done: TimelineDone[];
};

/** One bar. `row` is the category (task label); start/end are wall-clock Dates. */
type Bar = {
  row: string;
  start: Date;
  end: Date;
  who: string;
  detail: string;
  hours: number | null;
};

const DAY_MS = 86_400_000;
const ROW_HEIGHT = 40;
const LABEL_MAX = 44;
const PROJECT_ROW = 'Project (no task)';

/** 'yyyy-MM-dd HH:mm' from the API, built as a local Date so the stored wall-clock shows as-is. */
const parseDb = (v: string | null): Date | null => {
  if (!v) return null;
  const [d, t = '00:00'] = v.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const date = new Date(y, m - 1, day, hh, mm);
  return Number.isNaN(date.getTime()) ? null : date;
};

const fmt = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const truncate = (s: string, max = LABEL_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Task labels must be unique categories; disambiguate repeats with the line number. */
function rowLabels(tasks: TimelineTask[]): Map<number, string> {
  const seen = new Map<string, number>();
  tasks.forEach((t) => seen.set(t.name, (seen.get(t.name) ?? 0) + 1));
  const labels = new Map<number, string>();
  tasks.forEach((t) => {
    const base = t.name || `Task line ${t.lineNum}`;
    labels.set(t.taskLineId, (seen.get(t.name) ?? 0) > 1 ? `${base} (#${t.lineNum})` : base);
  });
  return labels;
}

export default function TimelineChart({ tasks, actions, done }: Props) {
  const options = useMemo<AgCartesianChartOptions>(() => {
    const labels = rowLabels(tasks);
    const rowOf = (taskLineId: number) => labels.get(taskLineId) ?? PROJECT_ROW;

    const taskBars: Bar[] = [];
    tasks.forEach((t) => {
      const start = parseDb(t.start);
      const end = parseDb(t.end);
      if (!start || !end || end < start) return;
      taskBars.push({
        row: rowOf(t.taskLineId),
        start,
        end,
        who: [t.phase, t.status].filter(Boolean).join(' · '),
        detail: t.percentComplete ? `${Math.round(t.percentComplete)}% complete` : '',
        hours: null,
      });
    });

    const toBar = (row: string, s: string | null, e: string | null, who: string, detail: string, hours: number | null): Bar | null => {
      const start = parseDb(s);
      const end = parseDb(e);
      if (!start || !end || end < start) return null;
      return { row, start, end, who, detail, hours };
    };

    const planned: Bar[] = [];
    const estimates: Bar[] = [];
    actions.forEach((a) => {
      const who = a.resource ?? a.initials ?? 'unassigned';
      const detail = [a.isTravel ? 'travel' : '', a.remarks ?? '', a.estimatePersonDays ? `${a.estimatePersonDays} person-days` : '']
        .filter(Boolean)
        .join(' · ');
      const bar = toBar(rowOf(a.taskLineId), a.start, a.end, who, detail, null);
      if (!bar) return;
      (a.kind === 'estimate' ? estimates : planned).push(bar);
    });

    const doneBars: Bar[] = [];
    done.forEach((d) => {
      const bar = toBar(rowOf(d.taskLineId), d.start, d.end, d.resource ?? d.initials ?? 'unknown', [d.description ?? '', d.remarks ?? ''].filter(Boolean).join(' · '), d.hours);
      if (bar) doneBars.push(bar);
    });

    // Row order: tasks by start (already sorted by the API), project-level row last if used.
    const rows = tasks.map((t) => rowOf(t.taskLineId));
    const usesProjectRow = [...planned, ...estimates, ...doneBars].some((b) => b.row === PROJECT_ROW);
    if (usesProjectRow) rows.push(PROJECT_ROW);
    // A zero-length placeholder per row pins the category order for every series.
    const all = [...taskBars, ...planned, ...estimates, ...doneBars];
    const minT = Math.min(...all.map((b) => b.start.getTime()));
    const maxT = Math.max(...all.map((b) => b.end.getTime()));
    const pad = Math.max(DAY_MS, (maxT - minT) * 0.03);

    const series = (name: string, data: Bar[], fill: string, opacity = 1): AgRangeBarSeriesOptions<Bar> => ({
      type: 'range-bar',
      direction: 'horizontal',
      xKey: 'row',
      yLowKey: 'start',
      yHighKey: 'end',
      yName: name,
      data,
      fill,
      fillOpacity: opacity,
      strokeWidth: 0,
      cornerRadius: 2,
      tooltip: {
        renderer: ({ datum }) => ({
          heading: name,
          title: datum.who || datum.row,
          data: [
            { label: 'Task', value: datum.row },
            { label: 'From', value: fmt(datum.start) },
            { label: 'To', value: fmt(datum.end) },
            ...(datum.hours !== null ? [{ label: 'Hours', value: String(datum.hours) }] : []),
            ...(datum.detail ? [{ label: 'Notes', value: datum.detail }] : []),
          ],
        }),
      },
    });

    const seriesList: AgRangeBarSeriesOptions<Bar>[] = [];
    // The task series carries every row (placeholders for rows without a task bar), so
    // the category axis shows all rows in order even when a series has no data for one.
    const taskWithPlaceholders: Bar[] = rows.map(
      (row) =>
        taskBars.find((b) => b.row === row) ?? {
          row,
          start: new Date(minT),
          end: new Date(minT),
          who: '',
          detail: '',
          hours: null,
        },
    );
    seriesList.push(series('Task', taskWithPlaceholders, '#94a3b8'));
    if (estimates.length) seriesList.push(series('Estimate (generic resource)', estimates, '#a5b4fc', 0.9));
    if (planned.length) seriesList.push(series('Planned (technician)', planned, '#3ba7f0'));
    if (doneBars.length) seriesList.push(series('Done', doneBars, '#22c55e'));

    return {
      series: seriesList,
      axes: [
        {
          type: 'category',
          position: 'left',
          label: { fontSize: 12, formatter: ({ value }) => truncate(String(value)) },
          gridLine: { enabled: true },
        },
        {
          type: 'time',
          position: 'bottom',
          nice: false,
          min: new Date(minT - pad),
          max: new Date(maxT + pad),
          crosshair: { enabled: true, label: { format: '%d/%m/%Y %H:%M' } },
        },
      ],
      legend: { position: 'top', item: { paddingX: 18 } },
      zoom: { enabled: true, axes: 'x', scrollingStep: 0.15, minVisibleItemsX: 2 },
      navigator: { enabled: true, height: 26 },
      padding: { left: 8, right: 16, top: 4, bottom: 4 },
      height: Math.max(260, 96 + rows.length * ROW_HEIGHT),
    };
  }, [tasks, actions, done]);

  return <AgCharts options={options} />;
}
