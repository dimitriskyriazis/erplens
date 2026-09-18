'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/app/components/PageHeader';
import type { Availability } from '@/lib/rmt/availabilityQueries';
import { SPAN_OPTIONS, TYPE_OPTIONS, addDays, fmtDMY, groupBookings, isDaySpan, spanLabel, type HeatMode } from '@/lib/rmt/availabilityModel';
import AssignTable from './AssignTable';

type Company = { id: number; name: string };

export type AvailabilityInitial = {
  company: number;
  team: number;
  type: string;
  spec: number;
  /** 'yyyy-MM-dd', a Monday. */
  start: string;
  /** Today, and the Monday of its week, decided on the server so both renders agree. */
  today: string;
  thisMonday: string;
  /** The span the table covers, in weeks. */
  span: number;
};

type Props = { companies: Company[]; initial: AvailabilityInitial };

type AvailabilityResponse = ({ ok: true } & Availability) | { ok: false; error: string };

/** Result of the last completed request, tagged with the request it answers. */
type Loaded = { key: string; data: Availability | null; error: string | null };

/**
 * Who is free, and when: a filter row and one table, people ranked by capacity with the
 * generic placeholders' unassigned demand underneath them. The span decides how far the
 * request reaches, so changing it refetches rather than slicing something wider. Filters
 * live in the URL so a view can be shared. Assignment itself happens in Soft1; this screen
 * is read-only.
 */
export default function RmtAvailabilityClient({ companies, initial }: Props) {
  const [company, setCompanyState] = useState(initial.company);
  const [team, setTeam] = useState(initial.team);
  const [type, setType] = useState(initial.type);
  const [spec, setSpec] = useState(initial.spec);
  const [start, setStart] = useState(initial.start);
  const [span, setSpan] = useState(initial.span);
  // Off by default: the page opens on everyone in scope, not only the recently booked.
  const [history, setHistory] = useState(false);
  const [mode, setMode] = useState<HeatMode>('free');
  const [pinned, setPinned] = useState<number[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const requestKey = `${company}|${team}|${type}|${spec}|${start}|${span}|${history ? 1 : 0}`;
  const loading = loaded?.key !== requestKey;
  // While a new slice loads, the previous one stays on screen, dimmed, so nothing jumps.
  const data = loaded?.data ?? null;
  const error = loaded?.key === requestKey ? loaded.error : null;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('company', String(company));
    if (team) params.set('team', String(team));
    // Always written, so picking "All" survives a reload instead of falling back to the default.
    params.set('type', type);
    if (spec) params.set('spec', String(spec));
    params.set('start', start);
    params.set('span', String(span));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [company, team, type, spec, start, span]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      company: String(company),
      start,
      weeks: String(span),
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
  }, [requestKey, company, team, type, spec, start, span, history]);

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
  // Placeholder rows always read as demand, so with nothing else in view free and booked
  // would draw the same picture. Better to say the choice does not apply than to fake one.
  const onlyGeneric = !!data && data.resources.length > 0 && data.resources.every((r) => r.generic);

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
              <span id="avail-mode-label">Show</span>
              <div className="seg" role="group" aria-labelledby="avail-mode-label">
                {(['free', 'booked'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={m === mode ? 'is-active' : undefined}
                    aria-pressed={m === mode}
                    disabled={onlyGeneric}
                    title={onlyGeneric ? 'Generic placeholders are demand on a pool, so they have no free days to show' : undefined}
                    onClick={() => setMode(m)}
                  >
                    {m === 'free' ? 'Free days' : 'Booked days'}
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
            {/* Span sits beside From: the two together say which stretch of time is on screen. */}
            <div className="avail-field">
              <span id="avail-span-label">Span</span>
              <div className="seg" role="group" aria-labelledby="avail-span-label">
                {SPAN_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === span ? 'is-active' : undefined}
                    aria-pressed={n === span}
                    title={`${n === 1 ? 'One week' : `${n} weeks`}, ${isDaySpan(n) ? 'day by day' : 'week by week'}`}
                    onClick={() => setSpan(n)}
                  >
                    {spanLabel(n)}
                  </button>
                ))}
              </div>
            </div>
            <label className="avail-check avail-field-check">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
              Only people booked in the last 12 months
            </label>
          </section>

          <section className={cardClass} aria-label="Assign work">
            <AssignTable data={data} bookings={bookings} span={span} mode={mode} pinned={pinned} onTogglePin={togglePin} today={initial.today} />
          </section>
        </div>
      </PageHeader>
    </main>
  );
}
