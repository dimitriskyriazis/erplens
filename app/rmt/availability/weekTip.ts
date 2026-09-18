import type { BarTip } from '@/app/rmt/components/barTip';
import type { AvailabilityBooking, AvailabilityDay, AvailabilityResource, AvailabilityWeek } from '@/lib/rmt/availabilityQueries';
import { fmtDM, fmtDays, fmtLong, isOverbooked, peopleNeeded } from '@/lib/rmt/availabilityModel';

const MAX_BOOKINGS = 8;

/** 'dd/MM to dd/MM', or 'dd/MM HH:mm to HH:mm' for a booking inside one day. */
const span = (b: AvailabilityBooking): string =>
  b.from.slice(0, 10) === b.to.slice(0, 10)
    ? `${fmtDM(b.from)} ${b.from.slice(11, 16)} to ${b.to.slice(11, 16)}`
    : `${fmtDM(b.from)} to ${fmtDM(b.to)}`;

/**
 * On a placeholder an estimate is the ordinary case and carries the person-days. On a named
 * person it is a guess someone typed against them, so it stays out of the free and booked
 * figures above the list. Say that on the line rather than leave it reading like a booking.
 */
const describe = (b: AvailabilityBooking, generic: boolean): string => {
  const parts = [b.project ?? 'No project'];
  if (b.task) parts.push(b.task);
  if (b.travel) parts.push('travel');
  if (b.estimate && b.personDays) parts.push(`${fmtDays(b.personDays)} person-days`);
  if (b.estimate && !generic) parts.push('estimate, not counted');
  const line = parts.join(' · ');
  return b.remarks ? `${line}\n${b.remarks}` : line;
};

/**
 * The hover card for one resource's week: the totals, then the bookings behind them.
 * A generic placeholder gets pool wording instead of person wording, because its days are
 * work waiting to be shared out among everyone with the specialty, not one person's week.
 */
export function weekTip(r: AvailabilityResource, w: AvailabilityWeek, bookings: AvailabilityBooking[]): BarTip {
  const rows: Array<[string, string]> = [];
  if (r.generic) {
    rows.push(['Demand', `${fmtDays(w.booked)} person-days, about ${fmtDays(peopleNeeded(w))} people for the week`]);
    rows.push(['Pool', r.pool > 0 ? `${r.pool} people carry this specialty` : 'no named people carry this specialty']);
  } else {
    // Part of the week may already be behind us; say how much room is still ahead.
    const past = w.freeAhead < w.free - 0.005;
    const gone = w.freeAhead <= 0.005 && w.free > 0.005;
    rows.push(['Free', `${fmtDays(w.free)} of ${w.workDays} days${gone ? ', all past' : past ? `, ${fmtDays(w.freeAhead)} still ahead` : ''}`]);
    rows.push(['Booked', `${fmtDays(w.booked)} of ${w.workDays} days${isOverbooked(w) ? ', overbooked' : ''}`]);
  }
  if (bookings.length === 0) {
    rows.push(['Bookings', 'none this week']);
  } else {
    for (const b of bookings.slice(0, MAX_BOOKINGS)) rows.push([span(b), describe(b, r.generic)]);
    if (bookings.length > MAX_BOOKINGS) rows.push(['', `and ${bookings.length - MAX_BOOKINGS} more`]);
  }
  return { heading: `${r.name} · week of ${fmtDM(w.start)}`, rows };
}

/** The same card for a single day, used by the assign strip on a one or two week window. */
export function dayTip(r: AvailabilityResource, d: AvailabilityDay, bookings: AvailabilityBooking[]): BarTip {
  const past = d.freeAhead <= 0.005 && d.free > 0.005;
  const rows: Array<[string, string]> = [
    ['Free', d.free <= 0.005 ? 'nothing left' : `${fmtDays(d.free)} of the day${past ? ', already past' : ''}`],
    ['Booked', `${fmtDays(d.booked)}${d.booked > 1.01 ? ', double-booked' : ''}`],
  ];
  if (bookings.length === 0) {
    rows.push(['Bookings', 'none this day']);
  } else {
    for (const b of bookings.slice(0, MAX_BOOKINGS)) rows.push([span(b), describe(b, r.generic)]);
    if (bookings.length > MAX_BOOKINGS) rows.push(['', `and ${bookings.length - MAX_BOOKINGS} more`]);
  }
  return { heading: `${r.name} · ${fmtLong(d.date)}`, rows };
}
