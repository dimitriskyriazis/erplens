'use client';

import { useMemo } from 'react';
import type { Availability, AvailabilityBooking } from '@/lib/rmt/availabilityQueries';
import { HEAT_LEVELS, bookingsInWeek, fmtDM, fmtDays, fmtLong, heatLevel, isOverbooked, weekStarts, type HeatMode } from '@/lib/rmt/availabilityModel';
import { hideBarTip, showBarTip } from '@/app/rmt/components/barTip';
import { weekTip } from './weekTip';

type Props = {
  data: Availability | null;
  bookings: Map<number, AvailabilityBooking[]>;
  mode: HeatMode;
  onMode: (mode: HeatMode) => void;
  pinned: number[];
  onTogglePin: (rsrc: number) => void;
  history: boolean;
  onHistory: (only: boolean) => void;
  /** 'yyyy-MM-dd' of this week's Monday, to mark the current column. */
  thisMonday: string;
};

const LEVELS = Array.from({ length: HEAT_LEVELS }, (_, i) => i + 1);

/**
 * "Week by week, in full": every resource in view against every week of the window, one
 * cell per week coloured by free (or booked) days, red where demand exceeds the week.
 * Values are printed in every cell, so colour never carries the number alone. Generic
 * placeholders sit last, in italics, and always show demand in the blue ramp whatever the
 * mode: a placeholder has no capacity, so "free days" would mean nothing on its row.
 */
export default function WeekHeatmap({ data, bookings, mode, onMode, pinned, onTogglePin, history, onHistory, thisMonday }: Props) {
  const rows = useMemo(
    () => (data ? [...data.resources].sort((a, b) => Number(a.generic) - Number(b.generic) || a.name.localeCompare(b.name, 'el')) : []),
    [data],
  );
  const columns = data ? weekStarts(data.start, data.weeks) : [];
  const hasGeneric = rows.some((r) => r.generic);
  const overbooked = rows.filter((r) => !r.generic).reduce((n, r) => n + r.weeks.filter(isOverbooked).length, 0);
  // A generic week above 100% means the estimates need more than one person that week.
  const overDemand = rows.filter((r) => r.generic).reduce((n, r) => n + r.weeks.filter(isOverbooked).length, 0);

  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Week by week, in full</h2>
          <p className="avail-sub">Hover a cell for the bookings behind it. Click a name to pin it to the list above.</p>
        </div>
        <div className="seg" role="group" aria-label="Show">
          <button type="button" className={mode === 'free' ? 'is-active' : undefined} aria-pressed={mode === 'free'} onClick={() => onMode('free')}>
            Free days
          </button>
          <button type="button" className={mode === 'booked' ? 'is-active' : undefined} aria-pressed={mode === 'booked'} onClick={() => onMode('booked')}>
            Booked days
          </button>
        </div>
      </div>

      <div className={`heat-legend mode-${mode}`} aria-label="Colour scale">
        <span>{mode === 'free' ? 'No room' : 'Nothing booked'}</span>
        <i className="lvl-0" />
        {LEVELS.map((l) => (
          <i key={l} className={`lvl-${l}`} />
        ))}
        <span>{mode === 'free' ? 'Fully free' : 'Fully booked'}</span>
        <i className="lvl-over" />
        <span>Overbooked, above 100%</span>
        {hasGeneric && mode === 'free' && (
          <>
            <i className="lvl-3 is-demand" />
            <span>Generic demand, in blue</span>
          </>
        )}
      </div>

      {!data ? (
        <div className="timeline-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="timeline-empty">No resources match these filters.</div>
      ) : (
        <div className={`heat mode-${mode}`}>
          <table>
            <thead>
              <tr>
                <th className="init" aria-label="Initials" />
                <th className="name" aria-label="Resource" />
                {columns.map((ws) => (
                  <th key={ws} className={`week${Number(ws.slice(5, 7)) % 2 === 0 ? ' alt' : ''}${ws === thisMonday ? ' is-now' : ''}`} title={ws === thisMonday ? 'This week' : undefined}>
                    {fmtDM(ws)}
                  </th>
                ))}
                <th className="total">{mode === 'free' ? 'Free d' : 'Booked d'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isPinned = pinned.includes(r.rsrc);
                const own = bookings.get(r.rsrc) ?? [];
                const rowMode: HeatMode = r.generic ? 'booked' : mode;
                const total = r.weeks.reduce((s, w) => s + (rowMode === 'free' ? w.free : w.booked), 0);
                return (
                  <tr key={r.rsrc} className={isPinned ? 'is-pinned' : undefined}>
                    <td className="init">{r.initials}</td>
                    <td className={`name${r.generic ? ' is-generic' : ''}`}>
                      {r.generic ? (
                        <span title={`${r.name}: a generic placeholder, demand rather than a person`}>{r.name}</span>
                      ) : (
                        <button type="button" onClick={() => onTogglePin(r.rsrc)} aria-pressed={isPinned} title={isPinned ? `${r.name}: unpin` : `${r.name}: pin to the list above`}>
                          {r.name}
                        </button>
                      )}
                    </td>
                    {r.weeks.map((w) => {
                      const value = rowMode === 'free' ? w.free : w.booked;
                      return (
                        <td
                          key={w.start}
                          className={`cell lvl-${heatLevel(w, rowMode)}${r.generic ? ' is-demand' : ''}`}
                          tabIndex={0}
                          aria-label={
                            r.generic
                              ? `${r.name}, week of ${fmtDM(w.start)}: ${fmtDays(w.booked)} days of demand${isOverbooked(w) ? ', more than one person' : ''}`
                              : `${r.name}, week of ${fmtDM(w.start)}: ${fmtDays(w.free)} free, ${fmtDays(w.booked)} booked${isOverbooked(w) ? ', overbooked' : ''}`
                          }
                          onMouseEnter={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
                          onMouseLeave={hideBarTip}
                          onFocus={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
                          onBlur={hideBarTip}
                        >
                          {fmtDays(value)}
                        </td>
                      );
                    })}
                    <td className={`total${r.generic ? ' is-demand' : ''}`} title={r.generic ? 'Days of demand over the window' : undefined}>
                      {fmtDays(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="avail-foot">
          <span>
            Showing {rows.length} of {data.totalResources} resources · {data.weeks} weeks from {fmtLong(data.start)}
          </span>
          {overbooked > 0 ? (
            <span className="is-alert">
              {overbooked} overbooked {overbooked === 1 ? 'week' : 'weeks'} in view
            </span>
          ) : (
            rows.length > 0 && <span>No overbooked weeks in view</span>
          )}
          {overDemand > 0 && (
            <span>
              {overDemand} generic {overDemand === 1 ? 'week needs' : 'weeks need'} more than one person
            </span>
          )}
          <label className="avail-check">
            <input type="checkbox" checked={history} onChange={(e) => onHistory(e.target.checked)} />
            Only people booked in the last 12 months
          </label>
        </div>
      )}
    </>
  );
}
