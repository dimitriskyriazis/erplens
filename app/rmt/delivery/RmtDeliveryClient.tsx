'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/app/components/PageHeader';
import type { Delivery } from '@/lib/rmt/deliveryQueries';
import PlanVsActual from './PlanVsActual';
import OverrunHistogram from './OverrunHistogram';
import NeedsAttention from './NeedsAttention';

type Company = { id: number; name: string };

export type DeliveryInitial = {
  company: number;
  /** Project code opened in the table, from the URL. */
  open: string | null;
};

type Props = { companies: Company[]; initial: DeliveryInitial };

type DeliveryResponse = ({ ok: true } & Delivery) | { ok: false; error: string };

type Loaded = { key: string; data: Delivery | null; error: string | null };

export const fmtHours = (n: number): string => Math.round(n).toLocaleString('en-GB');

/**
 * Estimates against logged work: the plan-vs-actual table with its per-task breakdown, a
 * histogram of where effort lands against plan, and the tasks that need a look. One request
 * feeds all three. Read-only; the estimates themselves live in Soft1.
 */
export default function RmtDeliveryClient({ companies, initial }: Props) {
  const [company, setCompany] = useState(initial.company);
  const [open, setOpen] = useState<string | null>(initial.open);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const requestKey = String(company);
  const loading = loaded?.key !== requestKey;
  const data = loaded?.data ?? null;
  const error = loaded?.key === requestKey ? loaded.error : null;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('company', String(company));
    if (open) params.set('open', open);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [company, open]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rmt/delivery?company=${company}`)
      .then((r) => r.json() as Promise<DeliveryResponse>)
      .then((p) => {
        if (cancelled) return;
        if (!p.ok) throw new Error(p.error);
        setLoaded({ key: requestKey, data: p, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({ key: requestKey, data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, company]);

  const toggleProject = useCallback((code: string) => {
    setOpen((prev) => (prev === code ? null : code));
  }, []);

  // Tasks arrive flat for every project in the table, so expanding is instant.
  const tasksByProject = useMemo(() => {
    const map = new Map<number, Delivery['tasks']>();
    (data?.tasks ?? []).forEach((t) => {
      const list = map.get(t.prjc);
      if (list) list.push(t);
      else map.set(t.prjc, [t]);
    });
    return map;
  }, [data]);

  const totals = data?.totals ?? null;
  const cardClass = `avail-card${loading ? ' is-loading' : ''}`;

  const records: Array<[string, string]> = totals
    ? [
        ['Tasks with logged work', fmtHours(totals.tasksWithWork)],
        ['Planned hours', fmtHours(totals.plannedHours)],
        ['Logged hours', fmtHours(totals.loggedHours)],
        ['Tasks over 120% of plan', fmtHours(totals.over120)],
        ['Actions with no task', fmtHours(totals.orphanActions)],
      ]
    : [];

  return (
    <main className="page">
      <PageHeader
        title="RMT Plan vs actual"
        rightActions={
          data ? (
            <span className="page-count">
              {data.projects.length} projects{loading ? ' · refreshing…' : ''}
            </span>
          ) : (
            <span className="page-count">{loading ? 'Loading…' : ''}</span>
          )
        }
      >
        {error && <div className="banner banner--error">Query failed: {error}</div>}
        <div className="avail-scroll">
          <section className="avail-card avail-filters" aria-label="Filters">
            <label className="avail-field">
              <span>Company</span>
              <select
                value={company}
                onChange={(e) => {
                  setCompany(Number(e.target.value));
                  setOpen(null);
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="avail-hint">
              Planned hours are named bookings at 8 hours a person-day. Generic estimates are left out: nobody logs against a placeholder.
            </p>
          </section>

          {records.length > 0 && (
            <section className="avail-card dep-records" aria-label="Summary">
              {records.map(([label, value]) => (
                <div key={label} className="dep-record">
                  <div className="dep-record-value">{value}</div>
                  <div className="dep-record-label">{label}</div>
                </div>
              ))}
            </section>
          )}

          <section className={cardClass} aria-label="Plan against actual">
            <PlanVsActual
              projects={data?.projects ?? []}
              tasksByProject={tasksByProject}
              open={open}
              onToggle={toggleProject}
              loading={loading && !data}
            />
          </section>

          <div className="dep-panels">
            <section className={cardClass} aria-label="Where effort lands against plan">
              <OverrunHistogram buckets={data?.buckets ?? []} over120={totals?.over120 ?? 0} loading={loading && !data} />
            </section>
            <section className={cardClass} aria-label="Needs attention">
              <NeedsAttention items={data?.attention ?? []} loading={loading && !data} />
            </section>
          </div>

          {totals && totals.orphanActions > 0 && (
            <section className="avail-card del-orphan" aria-label="Logged work with no task">
              <span className="del-orphan-value">{fmtHours(totals.orphanHours)}</span>
              <span className="del-orphan-text">
                hours logged with no task behind them, across {fmtHours(totals.orphanActions)} actions. That work cannot be compared with any
                estimate, so it sits outside every figure above.
              </span>
            </section>
          )}
        </div>
      </PageHeader>
    </main>
  );
}
