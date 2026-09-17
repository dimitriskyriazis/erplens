'use client';

import { tipHandlers } from '@/app/rmt/components/barTip';
import { fmtLong } from '@/lib/rmt/availabilityModel';
import type { BoardColumn, BoardTeam, ColourBy, ColumnTotal, LegendEntry } from '@/lib/rmt/deploymentModel';

type Props = {
  teams: BoardTeam[];
  columns: BoardColumn[];
  totals: ColumnTotal[];
  legend: LegendEntry[];
  colourBy: ColourBy;
  onColourBy: (by: ColourBy) => void;
  rollColumn: number;
  onRollColumn: (i: number) => void;
  hideIdle: boolean;
  onHideIdle: (hide: boolean) => void;
  loading: boolean;
};

const weekWord = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;

/**
 * "Where people are": one row per person, one column per week (or month), the colour saying
 * where they are and the code saying which project. Colour never carries a value alone —
 * every booked cell prints its project code and location code, and the legend names each
 * swatch — which is what lets a five-hue destination palette sit inside a dense grid.
 */
export default function DeploymentBoard({
  teams,
  columns,
  totals,
  legend,
  colourBy,
  onColourBy,
  rollColumn,
  onRollColumn,
  hideIdle,
  onHideIdle,
  loading,
}: Props) {
  const people = teams.reduce((n, t) => n + t.rows.length, 0);
  // The grid is sized from the column count so a 4-week and a 26-week board both fit.
  const gridStyle = { '--dep-cols': columns.length } as React.CSSProperties;

  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Deployment board</h2>
          <p className="avail-sub">
            One row per person, one column per {columns[0]?.sub ? 'month' : 'week'}. Colour is where they are, the code is the project. Click a
            column header for its roll-call.
          </p>
        </div>
        <div className="avail-control">
          <span className="avail-control-label">Colour by</span>
          <div className="seg" role="group" aria-label="Colour by">
            {(['place', 'project'] as const).map((v) => (
              <button key={v} type="button" className={colourBy === v ? 'is-active' : undefined} aria-pressed={colourBy === v} onClick={() => onColourBy(v)}>
                {v === 'place' ? 'Location' : 'Project'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="timeline-empty">Loading…</div>
      ) : people === 0 ? (
        <div className="timeline-empty">No people match these filters.</div>
      ) : (
        <div className="dep-scroll">
          <div className="dep-grid" style={gridStyle}>
            <div className="dep-head-row">
              <div className="dep-name-col" />
              {columns.map((col, i) => (
                <button
                  key={col.key}
                  type="button"
                  className={`dep-col-head${i === rollColumn ? ' is-active' : ''}`}
                  aria-pressed={i === rollColumn}
                  onClick={() => onRollColumn(i)}
                  title={`Roll-call for ${col.label}${col.sub ? ` ${col.sub}` : ''}`}
                >
                  {col.label}
                  {col.sub && <span className="dep-col-sub">{col.sub}</span>}
                </button>
              ))}
              <div className="dep-total-col" />
            </div>

            {/* Capacity strip: how much of each column is booked, split by the same colours. */}
            <div className="dep-head-row dep-summary-row">
              <div className="dep-name-col dep-summary-label">Booked of capacity</div>
              {totals.map((t, i) => (
                <div
                  key={t.column.key}
                  className="dep-summary"
                  tabIndex={0}
                  aria-label={`${t.column.label}: ${t.booked} of ${t.capacity} person-weeks booked, ${t.away} away`}
                  {...tipHandlers({
                    heading: `${t.column.label}${t.column.sub ? ` ${t.column.sub}` : ''}`,
                    rows: [
                      ['Person-weeks booked', String(t.booked)],
                      ['Away from base', String(t.away)],
                      ['Idle person-weeks', String(t.idle)],
                      ['Week of', fmtLong(t.column.start)],
                    ],
                  })}
                  onClick={() => onRollColumn(i)}
                >
                  {t.segments.map((s) => (
                    <i key={s.key} style={{ height: `${(s.weeks / Math.max(1, t.capacity)) * 100}%`, background: s.swatch.fill }} />
                  ))}
                </div>
              ))}
              <div className="dep-total-col dep-summary-label">Away</div>
            </div>

            {teams.map((team) => (
              <div key={team.name} className="dep-team">
                <div className="dep-team-head">
                  <span className="dep-team-name">{team.name === 'No team' ? 'Subcontractors' : team.name}</span>
                  <span className="dep-team-meta">
                    {team.rows.length} {team.rows.length === 1 ? 'person' : 'people'} · {team.awayWeeks} person-weeks away
                  </span>
                  <span className="dep-rule" />
                </div>
                {team.rows.map((row) => (
                  <div key={row.resource.rsrc} className="dep-row">
                    <div className="dep-name-col">
                      <span className="dep-person">{row.resource.name}</span>
                      <span className="dep-spec">{row.resource.specialties ?? '—'}</span>
                    </div>
                    {row.cells.map((cell, i) => {
                      const col = columns[i];
                      const tip = cell.top
                        ? {
                            heading: row.resource.name,
                            rows: [
                              [col.sub ? `${col.label} ${col.sub}` : `Week of ${fmtLong(col.start)}`, weekWord(col.weeks.length)] as [string, string],
                              ['Project', cell.top.projectCode === '-' ? 'No project' : `${cell.top.projectCode} · ${cell.top.projectName}`] as [string, string],
                              ['Location', cell.top.locationName] as [string, string],
                              ['Team', row.resource.team ?? 'No team'] as [string, string],
                              ...cell.all.slice(1).map(
                                (e) => [e.projectCode === '-' ? 'Also' : `Also ${e.projectCode}`, `${e.locationName}, ${e.days}d`] as [string, string],
                              ),
                            ],
                          }
                        : {
                            heading: row.resource.name,
                            rows: [
                              [col.sub ? `${col.label} ${col.sub}` : `Week of ${fmtLong(col.start)}`, 'Nothing booked'] as [string, string],
                              ['Team', row.resource.team ?? 'No team'] as [string, string],
                            ],
                          };
                      return (
                        <div
                          key={col.key}
                          className={`dep-cell${cell.top ? '' : ' is-empty'}${cell.away ? ' is-away' : ''}`}
                          style={{ background: cell.swatch.fill, color: cell.swatch.ink }}
                          tabIndex={0}
                          aria-label={
                            cell.top
                              ? `${row.resource.name}, ${col.label}: ${cell.top.projectCode} at ${cell.top.locationName}`
                              : `${row.resource.name}, ${col.label}: nothing booked`
                          }
                          {...tipHandlers(tip)}
                        >
                          <span className="dep-cell-code">{cell.code}</span>
                          {cell.sub && <span className="dep-cell-sub">{cell.sub}</span>}
                        </div>
                      );
                    })}
                    <div className="dep-total-col dep-away" title="Weeks away from Athens and the workshop">
                      {row.awayWeeks}w
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dep-legend" aria-label={colourBy === 'place' ? 'Locations' : 'Projects'}>
        {legend.map((l) => (
          <span key={l.key} className="dep-legend-item">
            <i style={{ background: l.swatch.fill }} className={l.swatch.empty ? 'is-empty' : undefined} />
            {l.label}
            <em>{l.weeks}w</em>
          </span>
        ))}
      </div>

      <div className="avail-foot">
        <span>
          Grey is at base, Athens or the workshop; colour is a trip. {colourBy === 'project' && 'Projects past the fifth share one grey — the code in the cell still names them.'}
        </span>
        <label className="avail-check">
          <input type="checkbox" checked={hideIdle} onChange={(e) => onHideIdle(e.target.checked)} />
          Hide people with nothing booked
        </label>
      </div>
    </>
  );
}
