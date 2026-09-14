'use client';

import type { CustomCellRendererProps } from 'ag-grid-react';
import { DAY_MS, fmtDateTime, shortName, type PlanBar, type PlanRow, type TimeScale } from '@/lib/rmt/planModel';

type Ctx = { scale: TimeScale };

const KIND_LABEL: Record<PlanBar['kind'], string> = {
  task: 'Task span',
  estimate: 'Estimate (generic resource)',
  planned: 'Planned',
  done: 'Done',
};

const tooltip = (b: PlanBar) =>
  [
    `${KIND_LABEL[b.kind]}${b.who ? `: ${shortName(b.who)}` : ''}`,
    `${fmtDateTime(b.start)} to ${fmtDateTime(b.end)}`,
    b.hours !== null ? `${b.hours} h` : '',
    b.detail,
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Draws one row's bars against the shared time scale. A collapsed task row also shows
 * its people's bars underneath the span, so the compact view still tells you when the
 * work happened and who did it by colour.
 */
export default function TimelineCell(props: CustomCellRendererProps<PlanRow, unknown, Ctx>) {
  const scale = props.context?.scale;
  const row = props.data;
  if (!scale || !row) return null;

  const x = (t: number) => ((t - scale.start) / DAY_MS) * scale.pxPerDay;
  const isTaskRow = row.kind === 'task' || row.kind === 'notask';
  const collapsed = isTaskRow && !props.node.expanded;
  const children: PlanBar[] = collapsed ? (props.node.allLeafChildren ?? []).flatMap((n) => (n.data && n.data.id !== row.id ? n.data.bars : [])) : [];

  const bar = (b: PlanBar, i: number, extra: string) => {
    const left = x(b.start);
    const width = Math.max(2, x(b.end) - left);
    const style: React.CSSProperties & { '--c'?: string } = { left, width };
    if (b.colour) style['--c'] = b.colour;
    return <div key={`${extra}${i}`} className={`tl-bar tl-bar--${b.kind}${extra}`} style={style} title={tooltip(b)} />;
  };

  const todayX = x(scale.now);
  const showToday = scale.now >= scale.start && scale.now <= scale.end;

  return (
    <div className="tl-cell">
      {showToday && <div className="tl-today" style={{ left: todayX }} />}
      {row.bars.map((b, i) => bar(b, i, collapsed && children.length ? ' tl-bar--summary' : ''))}
      {children.map((b, i) => bar(b, i, ' tl-bar--child'))}
    </div>
  );
}
