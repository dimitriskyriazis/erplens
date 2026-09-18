'use client';

import type { CustomHeaderProps } from 'ag-grid-react';
import { DAY_MS, type TimeScale } from '@/lib/rmt/planModel';

type Ctx = { scale: TimeScale };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Two tiers of ticks: months (or years when zoomed far out), then weeks or days. */
export default function TimelineHeader(props: CustomHeaderProps<unknown, Ctx>) {
  const scale = props.context?.scale;
  if (!scale) return null;
  const x = (t: number) => ((t - scale.start) / DAY_MS) * scale.pxPerDay;
  const totalDays = (scale.end - scale.start) / DAY_MS;
  const monthPx = scale.pxPerDay * 30.4;
  const showYearsOnly = monthPx < 28;
  const showWeeks = scale.pxPerDay >= 4 && scale.pxPerDay < 22;
  const showDays = scale.pxPerDay >= 22;

  const top: Array<{ left: number; width: number; text: string }> = [];
  const first = new Date(scale.start);
  if (showYearsOnly) {
    for (let y = first.getFullYear(); y <= new Date(scale.end).getFullYear(); y += 1) {
      const s = Math.max(scale.start, new Date(y, 0, 1).getTime());
      const e = Math.min(scale.end, new Date(y + 1, 0, 1).getTime());
      if (e > s) top.push({ left: x(s), width: x(e) - x(s), text: String(y) });
    }
  } else {
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    while (cursor.getTime() < scale.end) {
      const s = Math.max(scale.start, cursor.getTime());
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime();
      const e = Math.min(scale.end, next);
      const wide = monthPx >= 70;
      top.push({ left: x(s), width: x(e) - x(s), text: wide ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}` : MONTHS[cursor.getMonth()] });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const bottom: Array<{ left: number; width: number; text: string; weekend?: boolean }> = [];
  if (showDays) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    while (d.getTime() < scale.end) {
      const s = d.getTime();
      const e = s + DAY_MS;
      const dow = d.getDay();
      bottom.push({ left: x(s), width: x(e) - x(s), text: scale.pxPerDay >= 34 ? `${d.getDate()}` : dow === 1 ? `${d.getDate()}` : '', weekend: dow === 0 || dow === 6 });
      d.setDate(d.getDate() + 1);
    }
  } else if (showWeeks) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    while (d.getTime() < scale.end) {
      const s = d.getTime();
      const e = s + 7 * DAY_MS;
      bottom.push({ left: x(s), width: x(e) - x(s), text: scale.pxPerDay >= 7 ? `${d.getDate()}/${d.getMonth() + 1}` : '' });
      d.setDate(d.getDate() + 7);
    }
  }

  const showToday = scale.now >= scale.start && scale.now <= scale.end;

  return (
    <div className="tl-head" style={{ width: Math.ceil(totalDays * scale.pxPerDay) }}>
      {top.map((m, i) => (
        <div key={`m${i}`} className="tl-head-top" style={{ left: m.left, width: m.width }}>
          {m.width > 24 ? m.text : ''}
        </div>
      ))}
      {bottom.map((w, i) => (
        <div key={`w${i}`} className={`tl-head-bottom${w.weekend ? ' is-weekend' : ''}`} style={{ left: w.left, width: w.width }}>
          {w.text}
        </div>
      ))}
      {showToday && <div className="tl-head-today" style={{ left: x(scale.now) }} title="Today" />}
    </div>
  );
}
