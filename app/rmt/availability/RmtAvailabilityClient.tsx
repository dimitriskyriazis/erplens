'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/app/components/PageHeader';
import type { Availability } from '@/lib/rmt/availabilityQueries';
import { HEATMAP_WEEKS, TYPE_OPTIONS, addDays, fmtDMY, groupBookings, type HeatMode } from '@/lib/rmt/availabilityModel';
import AssignTable from './AssignTable';
import WeekHeatmap from './WeekHeatmap';

type Company = { id: number; name: string };

export type AvailabilityInitial = {
  company: number;
  team: number;
  type: string;
  spec: number;
  /** 'yyyy-MM-dd', a Monday. */
  start: string;
  /** The Monday of the current week, decided on the server so both renders agree. */
  thisMonday: string;
  weeks: number;
  need: number;
};

type Props = { companies: Company[]; initial: AvailabilityInitial };

type AvailabilityResponse = ({ ok: true } & Availability) | { ok: false; error: string };

/** Result of the last completed request, tagged with the request it answers. */
type Loaded = { key: string; data: Availability | null; error: string | null };

/**
 * Who is free, and when: a filter row, the "Who is available" table for assigning work,
 * and the week-by-week heatmap underneath. One request feeds both; the table looks at the
 * first 2, 4 or 8 weeks of the 14 the heatmap shows. Filters live in the URL so a view can
 * be shared. Assignment itself happens in Soft1; this screen is read-only.
 */
export default function RmtAvailabilityClient({ companies, initial }: Props) {
  const [company, setCompanyState] = useState(initial.company);
  const [team, setTeam] = useState(initial.team);
  const [type, setType] = useState(initial.type);
  const [spec, setSpec] = useState(initial.spec);
  const [start, setStart] = useState(initial.start);
  const [windowWeeks, setWindowWeeks] = useState(initial.weeks);
  const [need, setNeed] = useState(initial.need);
  const [history, setHistory] = useState(true);
  const [mode, setMode] = useState<HeatMode>('free');
  const [pinned, setPinned] = useState<number[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const requestKey = `${company}|${team}|${type}|${spec}|${start}|${history ? 1 : 0}`;
  const loading = loaded?.key !== requestKey;
  // While a new slice loads, the previous one stays on screen, dimmed, so nothing jumps.
  const data = loaded?.data ?? null;
  const error = loaded?.key === requestKey ? loaded.error : null;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('company', String(company));
    if (team) params.set('team', String(team));
    if (type) params.set('type', type);
    if (spec) params.set('spec', String(spec));
    params.set('start', start);
    params.set('weeks', String(windowWeeks));
    params.set('need', String(need));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [company, team, type, spec, start, windowWeeks, need]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      company: String(company),
      start,
      weeks: String(HEATMAP_WEEKS),
      team: String(team),
      type,
      specialty: String(spec),
      history: history ? '1' : '0',
    });
    fetch(`/api/rmt/availability?${params.toString()}`)
      .then((r) => r.json() as Promise<AvailabilityResponse>)
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
  }, [requestKey, company, team, type, spec, start, history]);

  // Teams are per company, so a change of company drops the team and specialty filters.
  const setCompany = useCallback((next: number) => {
    setCompanyState(next);
    setTeam(0);
    setSpec(0);
    setPinned([]);
  }, []);

  const togglePin = useCallback((rsrc: number) => {
    setPinned((prev) => (prev.includes(rsrc) ? prev.filter((x) => x !== rsrc) : [...prev, rsrc]));
  }, []);

  const bookings = useMemo(() => groupBookings(data?.bookings ?? []), [data]);
  const options = data?.options ?? null;
  const cardClass = `avail-card${loading ? ' is-loading' : ''}`;

  return (
    <main className="page">
      <PageHeader
        title="RMT Availability"
        rightActions={
          data ? (
            <span className="page-count">
              {data.resources.length} resources{loading ? ' · refreshing…' : ''}
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
              <select value={company} onChange={(e) => setCompany(Number(e.target.value))}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="avail-field">
              <span>Team</span>
              <select value={team} onChange={(e) => setTeam(Number(e.target.value))}>
                <option value={0}>All teams</option>
                {options?.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="avail-field">
              <span>Specialty</span>
              <select value={spec} onChange={(e) => setSpec(Number(e.target.value))}>
                <option value={0}>All specialties</option>
                {options?.specialties.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="avail-field">
              <span id="avail-type-label">Resource type</span>
              <div className="seg" role="group" aria-labelledby="avail-type-label">
                {TYPE_OPTIONS.map((t) => (
                  <button key={t.code} type="button" className={t.code === type ? 'is-active' : undefined} aria-pressed={t.code === type} onClick={() => setType(t.code)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="avail-field">
              <span id="avail-from-label">From</span>
              <div className="seg" role="group" aria-labelledby="avail-from-label">
                <button type="button" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
                  ‹
                </button>
                <button
                  type="button"
                  className="seg-text"
                  onClick={() => setStart(initial.thisMonday)}
                  disabled={start === initial.thisMonday}
                  title={start === initial.thisMonday ? 'This week' : 'Back to this week'}
                >
                  Week of {fmtDMY(start)}
                </button>
                <button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
                  ›
                </button>
              </div>
            </div>
            <p className="avail-hint">
              Team, specialty and type filter both views below. The heatmap shows {HEATMAP_WEEKS} weeks from the chosen Monday.
            </p>
          </section>

          <section className={cardClass} aria-label="Who is available">
            <AssignTable
              data={data}
              bookings={bookings}
              windowWeeks={windowWeeks}
              need={need}
              pinned={pinned}
              onTogglePin={togglePin}
              onWindow={setWindowWeeks}
              onNeed={setNeed}
            />
          </section>

          <section className={cardClass} aria-label="Week by week">
            <WeekHeatmap
              data={data}
              bookings={bookings}
              mode={mode}
              onMode={setMode}
              pinned={pinned}
              onTogglePin={togglePin}
              history={history}
              onHistory={setHistory}
              thisMonday={initial.thisMonday}
            />
          </section>
        </div>
      </PageHeader>
    </main>
  );
}
