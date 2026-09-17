'use client';

import { fmtDate, parseDb } from '@/lib/rmt/planModel';
import type { DeliveryAttention } from '@/lib/rmt/deliveryQueries';
import { fmtHours } from './RmtDeliveryClient';

type Props = { items: DeliveryAttention[]; loading: boolean };

/** Why a task is on the list, in words rather than colour alone. */
const reasonOf = (a: DeliveryAttention): string =>
  a.reason === 'stalled'
    ? `no hours, ended ${fmtDate(parseDb(a.end))}`
    : `+${fmtHours(a.loggedHours - a.plannedHours)}h past plan`;

/** Unfinished tasks whose logged hours have passed their plan, or whose end date has. */
export default function NeedsAttention({ items, loading }: Props) {
  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Needs attention</h2>
          <p className="avail-sub">Unfinished tasks whose logged hours have passed their plan, or whose end date has.</p>
        </div>
      </div>

      {loading ? (
        <div className="timeline-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="timeline-empty">Nothing past plan or past its end date.</div>
      ) : (
        <ul className="attn">
          {items.map((a) => (
            <li key={a.id} className="attn-row">
              <span className="attn-id">{a.id}</span>
              <span className="attn-name">{a.name}</span>
              <span className="attn-code">{a.projectCode}</span>
              <span className={`attn-why${a.reason === 'stalled' ? ' is-stalled' : ' is-over'}`}>
                <i aria-hidden="true">{a.reason === 'stalled' ? '◷' : '▲'}</i>
                {reasonOf(a)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="avail-foot">
        <span>
          Sorted by how far past plan they are. Dates and hours come straight from the views, so a stale end date shows up here too.
        </span>
      </div>
    </>
  );
}
