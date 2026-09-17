'use client';

import { useMemo, useState } from 'react';
import type { Availability, AvailabilityBooking } from '@/lib/rmt/availabilityQueries';
import { NEED_OPTIONS, WINDOW_OPTIONS, aheadLevel, bookingsInWeek, describeResource, fmtDM, fmtDays, windowStats } from '@/lib/rmt/availabilityModel';
import { hideBarTip, showBarTip } from '@/app/rmt/components/barTip';
import { weekTip } from './weekTip';

/** Rows shown before "Show all": enough to pick from, short enough to keep the heatmap in reach. */
const TOP_ROWS = 20;

type Props = {
  data: Availability | null;
  bookings: Map<number, AvailabilityBooking[]>;
  windowWeeks: number;
  need: number;
  pinned: number[];
  onTogglePin: (rsrc: number) => void;
  onWindow: (weeks: number) => void;
  onNeed: (days: number) => void;
};

/**
 * "Who is available": named people ranked by the free days still ahead of them over the
 * chosen window (days already past cannot be assigned), with a mini heat strip per week
 * and a verdict against the days needed. Pinned people (clicked here or in the heatmap)
 * stay on top in the order they were pinned.
 */
export default function AssignTable({ data, bookings, windowWeeks, need, pinned, onTogglePin, onWindow, onNeed }: Props) {
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const named = data.resources
      .filter((r) => !r.generic)
      .map((r) => ({ r, stats: windowStats(r, windowWeeks, need), pin: pinned.indexOf(r.rsrc) }));
    named.sort((a, b) => {
      const ap = a.pin >= 0;
      const bp = b.pin >= 0;
      if (ap !== bp) return ap ? -1 : 1;
      if (ap && bp) return a.pin - b.pin;
      return b.stats.free - a.stats.free || a.r.name.localeCompare(b.r.name, 'el');
    });
    return named;
  }, [data, windowWeeks, need, pinned]);

  const fitCount = rows.filter((x) => x.stats.fits).length;
  const visible = showAll ? rows : rows.slice(0, TOP_ROWS);

  return (
    <>
      <div className="avail-head">
        <div>
          <div className="avail-kicker">Assign work</div>
          <h2>Who is available</h2>
          <p className="avail-sub">Free days left on a 5-day week after existing bookings, from today over the chosen window. Sorted by most capacity.</p>
        </div>
        <div className="avail-controls">
          <div className="avail-control">
            <span className="avail-control-label" id="avail-window-label">
              Window
            </span>
            <div className="seg" role="group" aria-labelledby="avail-window-label">
              {WINDOW_OPTIONS.map((n) => (
                <button key={n} type="button" className={n === windowWeeks ? 'is-active' : undefined} aria-pressed={n === windowWeeks} onClick={() => onWindow(n)}>
                  {n} weeks
                </button>
              ))}
            </div>
          </div>
          <div className="avail-control">
            <span className="avail-control-label" id="avail-need-label">
              Days needed
            </span>
            <div className="seg" role="group" aria-labelledby="avail-need-label">
              {NEED_OPTIONS.map((n) => (
                <button key={n} type="button" className={n === need ? 'is-active' : undefined} aria-pressed={n === need} onClick={() => onNeed(n)}>
                  {n} d
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!data ? (
        <div className="timeline-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="timeline-empty">No named resources match these filters.</div>
      ) : (
        <div className="assign-wrap">
          <table className="assign">
            <thead>
              <tr>
                <th className="rank" aria-label="Rank" />
                <th>Resource</th>
                <th>Team · Type · Specialty</th>
                <th>Free days per week</th>
                <th className="num">Free d</th>
                <th className="num">Next free</th>
                <th className="num">Fits?</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, stats, pin }, i) => {
                const meta = describeResource(r);
                const isPinned = pin >= 0;
                const own = bookings.get(r.rsrc) ?? [];
                return (
                  <tr key={r.rsrc} className={isPinned ? 'is-pinned' : undefined}>
                    <td className="rank">{i + 1}</td>
                    <td className="who">
                      <button type="button" className="name-btn" onClick={() => onTogglePin(r.rsrc)} aria-pressed={isPinned} title={isPinned ? 'Unpin' : 'Pin to the top'}>
                        {r.name}
                      </button>
                      {r.initials && <span className="init">{r.initials}</span>}
                    </td>
                    <td className="meta" title={meta}>
                      {meta}
                    </td>
                    <td>
                      <div className="weeks">
                        {r.weeks.slice(0, windowWeeks).map((w) => (
                          <span
                            key={w.start}
                            className={`mini lvl-${aheadLevel(w)}`}
                            tabIndex={0}
                            aria-label={`Week of ${fmtDM(w.start)}: ${fmtDays(w.freeAhead)} free days ahead`}
                            onMouseEnter={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
                            onMouseLeave={hideBarTip}
                            onFocus={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
                            onBlur={hideBarTip}
                          >
                            {fmtDays(w.freeAhead)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num total">{fmtDays(stats.free)}</td>
                    <td className="num next">{stats.nextFree ? fmtDM(stats.nextFree) : 'none'}</td>
                    <td className={`num fit ${stats.fits ? 'fit--yes' : 'fit--no'}`}>{stats.fits ? 'Fits' : `Short ${fmtDays(stats.short)}d`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && rows.length > 0 && (
        <div className="avail-foot">
          <span>
            <strong>{fitCount}</strong> of {rows.length} resources in view can cover {need} {need === 1 ? 'day' : 'days'} in the {windowWeeks} weeks from {fmtDM(data.start)}.
          </span>
          <span>Named resources only. Generic placeholders are demand, not capacity. Assignment happens in Soft1.</span>
          {rows.length > TOP_ROWS && (
            <button type="button" className="link-btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show top ${TOP_ROWS}` : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
