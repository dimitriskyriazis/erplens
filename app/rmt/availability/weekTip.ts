import type { BarTip } from '@/app/rmt/components/barTip';
import type { AvailabilityBooking, AvailabilityResource, AvailabilityWeek } from '@/lib/rmt/availabilityQueries';
import { fmtDM, fmtDays, isOverbooked } from '@/lib/rmt/availabilityModel';

const MAX_BOOKINGS = 8;

/** 'dd/MM to dd/MM', or 'dd/MM HH:mm to HH:mm' for a booking inside one day. */
const span = (b: AvailabilityBooking): string =>
  b.from.slice(0, 10) === b.to.slice(0, 10)
    ? `${fmtDM(b.from)} ${b.from.slice(11, 16)} to ${b.to.slice(11, 16)}`
    : `${fmtDM(b.from)} to ${fmtDM(b.to)}`;

const describe = (b: AvailabilityBooking): string => {
  const parts = [b.project ?? 'No project'];
  if (b.task) parts.push(b.task);
  if (b.travel) parts.push('travel');
  if (b.estimate && b.personDays) parts.push(`${fmtDays(b.personDays)} person-days`);
  const line = parts.join(' · ');
  return b.remarks ? `${line}\n${b.remarks}` : line;
};

/** The hover card for one resource's week: the totals, then the bookings behind them. */
export function weekTip(r: AvailabilityResource, w: AvailabilityWeek, bookings: AvailabilityBooking[]): BarTip {
  const rows: Array<[string, string]> = [
    [r.generic ? 'Demand' : 'Booked', `${fmtDays(w.booked)} of ${w.workDays} days${isOverbooked(w) ? ', overbooked' : ''}`],
  ];
  if (!r.generic) {
    // Part of the week may already be behind us; say how much room is still ahead.
    const past = w.freeAhead < w.free - 0.005;
    const gone = w.freeAhead <= 0.005 && w.free > 0.005;
    rows.unshift(['Free', `${fmtDays(w.free)} of ${w.workDays} days${gone ? ', all past' : past ? `, ${fmtDays(w.freeAhead)} still ahead` : ''}`]);
  }
  if (bookings.length === 0) {
    rows.push(['Bookings', 'none this week']);
  } else {
    for (const b of bookings.slice(0, MAX_BOOKINGS)) rows.push([span(b), describe(b)]);
    if (bookings.length > MAX_BOOKINGS) rows.push(['', `and ${bookings.length - MAX_BOOKINGS} more`]);
  }
  return { heading: `${r.name} · week of ${fmtDM(w.start)}`, rows };
}
