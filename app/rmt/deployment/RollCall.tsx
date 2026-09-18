'use client';

import type { BoardColumn, RollCallGroup } from '@/lib/rmt/deploymentModel';

type Props = { groups: RollCallGroup[]; column: BoardColumn | undefined; people: number };

/** Who is where in the selected column, grouped by location, biggest group first. */
export default function RollCall({ groups, column, people }: Props) {
  const notBooked = groups.find((g) => g.name === 'Not booked')?.people.length ?? 0;
  const deployed = people - notBooked;
  const heading = column?.tip ?? '—';

  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Roll-call · {heading}</h2>
          <p className="avail-sub">
            {deployed} of {people} deployed · {notBooked} with nothing booked
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="timeline-empty">Nobody on the board.</div>
      ) : (
        <div className="roll-groups">
          {groups.map((g) => (
            <div key={g.name} className="roll-group">
              <div className="roll-group-head">
                <i style={{ background: g.swatch.fill }} className={g.swatch.empty ? 'is-empty' : undefined} />
                <span className="roll-group-name">{g.name}</span>
                <span className="roll-group-count">
                  {g.people.length} {g.people.length === 1 ? 'person' : 'people'}
                </span>
                <span className="dep-rule" />
              </div>
              <div className="roll-people">
                {g.people.map((p) => (
                  <span key={p.name} className="roll-person">
                    {p.name}
                    {p.code && <em>{p.code}</em>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
