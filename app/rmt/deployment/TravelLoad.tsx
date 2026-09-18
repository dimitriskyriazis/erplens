'use client';

import { tipHandlers } from '@/app/rmt/components/barTip';
import type { TravelTeam, Unit } from '@/lib/rmt/deploymentModel';

type Props = { teams: TravelTeam[]; away: number; span: number; unit: Unit };

/**
 * Person-units away from base per team, split by destination. Bars share one scale (the
 * busiest team), so the lengths are comparable across rows; each segment keeps the colour
 * its destination has on the board above.
 */
export default function TravelLoad({ teams, away, span, unit }: Props) {
  const max = Math.max(1, ...teams.map((t) => t.units));

  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Travel load per team</h2>
          <p className="avail-sub">{`${unit.long.charAt(0).toUpperCase()}${unit.long.slice(1)}`} away from Athens and the workshop over the window, split by destination.</p>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="timeline-empty">No teams on the board.</div>
      ) : (
        <div className="travel-rows">
          {teams.map((t) => (
            <div
              key={t.name}
              className="travel-row"
              tabIndex={0}
              aria-label={`${t.name}: ${t.units} ${unit.long} away`}
              {...tipHandlers({
                heading: `${t.name === 'No team' ? 'Subcontractors' : t.name} · travel`,
                rows: t.segments.length
                  ? t.segments.map((s) => [s.location, `${s.units} ${unit.long}`] as [string, string])
                  : [['Travel', 'none in this window']],
              })}
            >
              <div className="travel-head">
                <span className="travel-name">{t.name === 'No team' ? 'Subcontractors' : t.name}</span>
                <span className="travel-total">
                  {t.units}
                  {unit.short}
                </span>
              </div>
              <div className="travel-track">
                {t.segments.map((s) => (
                  <i
                    key={s.location}
                    style={{ width: `${(s.units / max) * 100}%`, background: s.swatch.fill }}
                    title={`${s.location}: ${s.units}${unit.short}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="avail-foot">
        <span>
          {away} {unit.long} away across {span} {span === 1 ? 'week' : 'weeks'} — every one of them a travel cost on a project.
        </span>
      </div>
    </>
  );
}
