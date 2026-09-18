'use client';

import { tipHandlers } from '@/app/rmt/components/barTip';
import type { SpecialtyRow, Unit } from '@/lib/rmt/deploymentModel';

type Props = { rows: SpecialtyRow[]; unit: Unit; colourByPlace: boolean };

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/**
 * Deployment per specialty: how much of each skill's bench is booked over the span.
 *
 * Each bar is that specialty's own capacity (its people × the span), so the bars read as
 * utilisation and a ten-person skill is comparable with a hundred-person one. The fill keeps
 * the colours of the board above, so the bar also says where that skill goes; the grey tail
 * is the idle part of the bench. Length is never the only carrier — every row prints its
 * booked-of-capacity numbers and the hover card names each segment.
 */
export default function SpecialtyLoad({ rows, unit, colourByPlace }: Props) {
  const people = rows.reduce((n, r) => n + r.people, 0);

  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Deployment by specialty</h2>
          <p className="avail-sub">
            How much of each skill&apos;s bench is booked over the span, split by {colourByPlace ? 'destination' : 'project'}.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="timeline-empty">No people match these filters.</div>
      ) : (
        <div className="specload-rows">
          {rows.map((r) => (
            <div
              key={r.name}
              className="specload-row"
              tabIndex={0}
              aria-label={`${r.name}: ${r.booked} of ${r.capacity} ${unit.long} booked across ${r.people} people`}
              {...tipHandlers({
                heading: r.name,
                rows: [
                  ['People', String(r.people)],
                  [`${unit.long.charAt(0).toUpperCase()}${unit.long.slice(1)} booked`, `${r.booked} of ${r.capacity}`],
                  ['Away from base', String(r.away)],
                  ...r.segments.map((s) => [s.label, `${s.units}${unit.short}`] as [string, string]),
                ],
              })}
            >
              <div className="specload-head">
                <span className="specload-name">{r.name}</span>
                <span className="specload-people">
                  {r.people} {r.people === 1 ? 'person' : 'people'}
                </span>
                <span className="specload-total">{pct(r.booked, r.capacity)}%</span>
              </div>
              <div className="specload-track">
                {r.segments.map((s) => (
                  <i
                    key={s.key}
                    style={{ width: `${(s.units / Math.max(1, r.capacity)) * 100}%`, background: s.swatch.fill }}
                    title={`${s.label}: ${s.units}${unit.short}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="avail-foot">
        <span>
          {people} specialty holdings across the bench. Somebody who holds two specialties counts in both bars, so the rows add up to more than
          the board.
        </span>
      </div>
    </>
  );
}
