'use client';

import { useMemo } from 'react';
import type { Availability, AvailabilityBooking, AvailabilityResource } from '@/lib/rmt/availabilityQueries';
import {
  DAYS_PER_WEEK,
  TIGHT_FROM,
  addDays,
  aheadLevel,
  bookingsInWeek,
  bookingsOnDay,
  coverStats,
  dayLevel,
  demandPeak,
  demandPeakDays,
  describeResource,
  fmtDM,
  fmtDays,
  heatLevel,
  isDaySpan,
  levelOf,
  peopleNeeded,
  perHead,
  spanStats,
  type HeatMode,
} from '@/lib/rmt/availabilityModel';
import { hideBarTip, showBarTip } from '@/app/rmt/components/barTip';
import { dayTip, weekTip } from './weekTip';

type Props = {
  data: Availability | null;
  bookings: Map<number, AvailabilityBooking[]>;
  /** Weeks the table covers, chosen in the filter card above it. */
  span: number;
  mode: HeatMode;
  pinned: number[];
  onTogglePin: (rsrc: number) => void;
  /** Today as 'yyyy-MM-dd', decided on the server, to mark the column the present sits in. */
  today: string;
};

/**
 * The availability screen's one table: every named person in view against the span, ranked
 * by the free days still ahead of them (days already past cannot be assigned) or, in booked
 * mode, by who is busiest, since a list of free days sorted by free days is a screen of
 * zeros there. Over a span of one or two weeks the strip steps by day, further out by week,
 * the same rule the deployment board follows.
 *
 * Generic placeholders sit underneath the people, in italics, always showing demand whatever
 * the mode and never flagged red: a placeholder is unassigned work for a whole pool, not a
 * person, so a five-day week is the wrong yardstick. Those rows shade against the busiest
 * generic cell in the span instead. Clicking a name pins it to the top.
 */
export default function AssignTable({ data, bookings, span, mode, pinned, onTogglePin, today }: Props) {
  // The day strip needs day rows; until they land the weekly strip stands in.
  const byDay = isDaySpan(span) && (data?.resources[0]?.days.length ?? 0) > 0;
  const dayCount = span * DAYS_PER_WEEK;
  const free = mode === 'free';

  const people = useMemo(() => {
    if (!data) return [];
    const named = data.resources.filter((r) => !r.generic).map((r) => ({ r, stats: spanStats(r, span), pin: pinned.indexOf(r.rsrc) }));
    // Each mode leads with what it is about: the freest people, or the busiest. Sorting by
    // free days in booked mode would open on a screen of zeros.
    named.sort((a, b) => {
      const ap = a.pin >= 0;
      const bp = b.pin >= 0;
      if (ap !== bp) return ap ? -1 : 1;
      if (ap && bp) return a.pin - b.pin;
      const by = free ? b.stats.free - a.stats.free : b.stats.booked - a.stats.booked;
      return by || a.r.name.localeCompare(b.r.name, 'el');
    });
    return named;
  }, [data, span, pinned, free]);

  const generics = useMemo(
    () => (data ? data.resources.filter((r) => r.generic).sort((a, b) => a.name.localeCompare(b.name, 'el')) : []),
    [data],
  );
  const peak = useMemo(() => (byDay ? demandPeakDays(generics, dayCount) : demandPeak(generics, span)), [generics, byDay, dayCount, span]);
  const cover = useMemo(() => coverStats(data?.resources ?? [], span), [data, span]);

  // The dates over the strip, derived from the span start rather than a row, so the header
  // stands even on an empty result. One per working day, or one per week.
  const columns = useMemo(() => {
    if (!data) return [];
    if (byDay) return Array.from({ length: dayCount }, (_, k) => addDays(data.start, Math.floor(k / DAYS_PER_WEEK) * 7 + (k % DAYS_PER_WEEK)));
    return Array.from({ length: span }, (_, i) => addDays(data.start, i * 7));
  }, [data, byDay, dayCount, span]);

  // The header dates and every row's cells share one track class, so the columns line up.
  const trackClass = `weeks${byDay ? ' weeks--day' : ''}${span >= TIGHT_FROM ? ' weeks--tight' : ''}`;
  const stripClass = `${trackClass} mode-${mode}`;
  const cellClass = `mini${byDay ? ' mini--day' : ''}`;
  /** The column holding today: the day itself on a day strip, the whole week on a week one. */
  const isNow = (c: string) => (byDay ? c === today : c <= today && today < addDays(c, 7));

  /** The strip for one placeholder: demand, shaded against the busiest generic cell in view. */
  const demandStrip = (r: AvailabilityResource, own: AvailabilityBooking[]) =>
    byDay
      ? r.days.slice(0, dayCount).map((d) => (
          <span
            key={d.date}
            className={`${cellClass} is-demand lvl-${levelOf(d.booked, peak)}`}
            tabIndex={0}
            aria-label={`${r.name}, ${fmtDM(d.date)}: ${fmtDays(d.booked)} person-days of unassigned demand`}
            onMouseEnter={(e) => showBarTip(e.currentTarget, dayTip(r, d, bookingsOnDay(own, d.date)))}
            onMouseLeave={hideBarTip}
            onFocus={(e) => showBarTip(e.currentTarget, dayTip(r, d, bookingsOnDay(own, d.date)))}
            onBlur={hideBarTip}
          >
            {fmtDays(d.booked)}
          </span>
        ))
      : r.weeks.slice(0, span).map((w) => (
          <span
            key={w.start}
            className={`${cellClass} is-demand lvl-${levelOf(w.booked, peak)}`}
            tabIndex={0}
            aria-label={`${r.name}, week of ${fmtDM(w.start)}: ${fmtDays(w.booked)} person-days of unassigned demand, about ${fmtDays(peopleNeeded(w))} people`}
            onMouseEnter={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
            onMouseLeave={hideBarTip}
            onFocus={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
            onBlur={hideBarTip}
          >
            {fmtDays(w.booked)}
          </span>
        ));

  return (
    <>
      <div className="avail-head">
        <div>
          <div className="avail-kicker">Assign work</div>
          <h2>{free ? 'Who is available' : 'Who is busiest'}</h2>
          <p className="avail-sub">
            {free
              ? 'Free days left on a 5-day week after existing bookings, from today over the chosen span. Sorted by most capacity.'
              : 'Person-days booked over the chosen span, uncapped, so a double booking reads above the day. Sorted by most booked.'}{' '}
            Click a name to pin it to the top.
          </p>
        </div>
        {/*
          The balance the screen exists to judge, kept as two figures rather than one. Free
          days are what the people on show can still take; unassigned days are what the
          placeholders are holding for them. Netting them would assert a split nobody has made.
        */}
        {data && (cover.people > 0 || cover.pools > 0) && (
          <div className="avail-cover">
            {cover.people > 0 && (
              <span className="avail-cover-item" title="Free days still ahead over the chosen span, added up across the people listed above. Days already past do not count.">
                <b>{fmtDays(cover.free)} d</b> free
                <em>
                  across {cover.people} {cover.people === 1 ? 'person' : 'people'}
                </em>
              </span>
            )}
            {cover.pools > 0 && (
              <span
                className="avail-cover-item is-demand"
                title={`Person-days of work that is planned but has not been given to a named person yet. The same figure as the total on the placeholder ${cover.pools === 1 ? 'row' : 'rows'} at the foot of the table.`}
              >
                <b>{fmtDays(cover.demand)} d</b> not yet assigned
                <em>
                  on {cover.pools} placeholder {cover.pools === 1 ? 'row' : 'rows'}
                </em>
              </span>
            )}
          </div>
        )}
      </div>

      {!data ? (
        <div className="timeline-empty">Loading…</div>
      ) : people.length === 0 && generics.length === 0 ? (
        <div className="timeline-empty">No resources match these filters.</div>
      ) : (
        <div className="assign-wrap">
          <table className="assign">
            <thead>
              <tr>
                <th className="rank" aria-label="Rank" />
                <th>Resource</th>
                <th>Team · Type · Specialty</th>
                <th className="strip-head">
                  <span>{free ? 'Free days' : 'Booked days'}</span>
                  {/* Dates over the cells below, in the same flex track so they line up. */}
                  <div className={trackClass} aria-hidden="true">
                    {columns.map((c) => (
                      <span key={c} className={`mini-head${isNow(c) ? ' is-now' : ''}`}>
                        {byDay ? c.slice(8, 10) : fmtDM(c)}
                      </span>
                    ))}
                  </div>
                </th>
                <th className="num">{free ? 'Free d' : 'Booked d'}</th>
                <th className="num">Next free</th>
              </tr>
            </thead>
            <tbody>
              {people.map(({ r, stats, pin }, i) => {
                const isPinned = pin >= 0;
                const meta = describeResource(r);
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
                      <div className={stripClass}>
                        {byDay
                          ? r.days.slice(0, dayCount).map((d) => (
                              <span
                                key={d.date}
                                className={`${cellClass} lvl-${dayLevel(d, mode)}`}
                                tabIndex={0}
                                aria-label={`${r.name}, ${fmtDM(d.date)}: ${free ? `${fmtDays(d.freeAhead)} free` : `${fmtDays(d.booked)} booked`}`}
                                onMouseEnter={(e) => showBarTip(e.currentTarget, dayTip(r, d, bookingsOnDay(own, d.date)))}
                                onMouseLeave={hideBarTip}
                                onFocus={(e) => showBarTip(e.currentTarget, dayTip(r, d, bookingsOnDay(own, d.date)))}
                                onBlur={hideBarTip}
                              >
                                {fmtDays(free ? d.freeAhead : d.booked)}
                              </span>
                            ))
                          : r.weeks.slice(0, span).map((w) => (
                              <span
                                key={w.start}
                                className={`${cellClass} lvl-${free ? aheadLevel(w) : heatLevel(w, 'booked')}`}
                                tabIndex={0}
                                aria-label={`${r.name}, week of ${fmtDM(w.start)}: ${free ? `${fmtDays(w.freeAhead)} free days ahead` : `${fmtDays(w.booked)} days booked`}`}
                                onMouseEnter={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
                                onMouseLeave={hideBarTip}
                                onFocus={(e) => showBarTip(e.currentTarget, weekTip(r, w, bookingsInWeek(own, w.start)))}
                                onBlur={hideBarTip}
                              >
                                {fmtDays(free ? w.freeAhead : w.booked)}
                              </span>
                            ))}
                      </div>
                    </td>
                    <td className="num total">{fmtDays(free ? stats.free : stats.booked)}</td>
                    <td className="num next">{stats.nextFree ? fmtDM(stats.nextFree) : 'none'}</td>
                  </tr>
                );
              })}

              {generics.map((r) => {
                const own = bookings.get(r.rsrc) ?? [];
                const total = (byDay ? r.days.slice(0, dayCount) : r.weeks.slice(0, span)).reduce((s, c) => s + c.booked, 0);
                const head = perHead(total, r.pool);
                const meta = `${r.specialties ?? 'No specialty'} · ${r.pool} people carry it`;
                return (
                  <tr key={r.rsrc} className="is-generic">
                    <td className="rank" />
                    <td className="who">
                      <span className="name-generic" title={`${r.name}: unassigned demand for the whole pool, not one person`}>
                        {r.name}
                      </span>
                      {r.initials && <span className="init">{r.initials}</span>}
                    </td>
                    <td className="meta" title={meta}>
                      {meta}
                    </td>
                    <td>
                      <div className={stripClass}>{demandStrip(r, own)}</div>
                    </td>
                    <td className="num total is-demand-total" title="Person-days of unassigned demand over the span">
                      {fmtDays(total)}
                      {/* The total alone ranks pools by size; per head ranks them by pressure. */}
                      {head !== null && total > 0.005 && (
                        <span className="per-head" title={`${fmtDays(head)} unassigned days for each of the ${r.pool} people who carry this specialty`}>
                          {fmtDays(head)}/head
                        </span>
                      )}
                    </td>
                    <td className="num next">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
