'use client';

import { tipHandlers } from '@/app/rmt/components/barTip';
import type { DeliveryBucket } from '@/lib/rmt/deliveryQueries';
import { fmtHours } from './RmtDeliveryClient';

type Props = { buckets: DeliveryBucket[]; over120: number; loading: boolean };

/**
 * Tasks with logged work, bucketed by how their hours landed against their estimate. The
 * buckets are ordered, so the bars share one neutral; the two past 120% take the status red
 * and say so in the footnote, which keeps colour off the job of naming the buckets.
 */
export default function OverrunHistogram({ buckets, over120, loading }: Props) {
  const max = Math.max(1, ...buckets.map((b) => b.tasks));
  const total = buckets.reduce((s, b) => s + b.tasks, 0);

  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Where effort lands against plan</h2>
          <p className="avail-sub">Tasks with logged work, bucketed by done hours against planned hours.</p>
        </div>
      </div>

      {loading ? (
        <div className="timeline-empty">Loading…</div>
      ) : total === 0 ? (
        <div className="timeline-empty">No tasks with both an estimate and logged work.</div>
      ) : (
        <>
          <div className="hist">
            {buckets.map((b) => (
              <div
                key={b.bucket}
                className="hist-col"
                tabIndex={0}
                aria-label={`${b.label} of plan: ${b.tasks} tasks`}
                {...tipHandlers({
                  heading: `${b.label} of plan`,
                  rows: [
                    ['Tasks', fmtHours(b.tasks)],
                    ['Share', `${((b.tasks / total) * 100).toFixed(1)}%`],
                  ],
                })}
              >
                <span className="hist-value">{fmtHours(b.tasks)}</span>
                <span className={`hist-bar${b.over ? ' is-over' : ''}`} style={{ height: `${(b.tasks / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="hist-axis">
            {buckets.map((b) => (
              <span key={b.bucket} className="hist-label">
                {b.label}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="avail-foot">
        <span>
          Anything past 120% is either an underestimate or scope that arrived late. {fmtHours(over120)} tasks sit there.
        </span>
      </div>
    </>
  );
}
