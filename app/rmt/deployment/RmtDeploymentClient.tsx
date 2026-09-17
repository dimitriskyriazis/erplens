'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/app/components/PageHeader';
import type { Deployment } from '@/lib/rmt/deploymentQueries';
import { TYPE_OPTIONS, addDays, fmtDMY, isoDate, mondayOf, parseIso } from '@/lib/rmt/availabilityModel';
import {
  SPAN_OPTIONS,
  WEEKLY_UP_TO,
  buildBoard,
  buildColumns,
  buildLegend,
  columnTotals,
  projectSwatches,
  rollCall,
  travelLoad,
  type ColourBy,
  type Granularity,
  type Span,
} from '@/lib/rmt/deploymentModel';
import DeploymentBoard from './DeploymentBoard';
import RollCall from './RollCall';
import TravelLoad from './TravelLoad';

type Company = { id: number; name: string };

export type DeploymentInitial = {
  company: number;
  team: number;
  type: string;
  spec: number;
  /** 'yyyy-MM-dd', a Monday. */
  start: string;
  /** The Monday of the current week, decided on the server so both renders agree. */
  thisMonday: string;
  span: Span;
  gran: Granularity;
  colourBy: ColourBy;
};

type Props = { companies: Company[]; initial: DeploymentInitial };

type DeploymentResponse = ({ ok: true } & Deployment) | { ok: false; error: string };

/** Result of the last completed request, tagged with the request it answers. */
type Loaded = { key: string; data: Deployment | null; error: string | null };

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The Monday on or before the first of the month `offset` months from the window's month. */
const monthStart = (iso: string, offset: number): string => {
  const d = parseIso(iso);
  return mondayOf(isoDate(new Date(d.getFullYear(), d.getMonth() + offset, 1)));
};

/** The Monday on or before the first day of the quarter `offset` quarters away. */
const quarterStart = (iso: string, offset: number): string => {
  const d = parseIso(iso);
  return mondayOf(isoDate(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + offset * 3, 1)));
};

const rangeLabel = (start: string, weeks: number): string => {
  const from = parseIso(start);
  const to = parseIso(addDays(start, weeks * 7 - 3));
  const fmt = (d: Date) => `${d.getDate()} ${MONTHS_LONG[d.getMonth()].slice(0, 3)}`;
  return `${fmt(from)} – ${fmt(to)} ${to.getFullYear()}`;
};

/**
 * Where people are: a filter row, a window control, the person-by-week deployment board,
 * and the roll-call and travel-load panels underneath. One request feeds all of them.
 * Filters live in the URL so a view can be shared. Scheduling itself happens in Soft1;
 * this screen is read-only.
 */
export default function RmtDeploymentClient({ companies, initial }: Props) {
  const [company, setCompanyState] = useState(initial.company);
  const [team, setTeam] = useState(initial.team);
  const [type, setType] = useState(initial.type);
  const [spec, setSpec] = useState(initial.spec);
  const [start, setStart] = useState(initial.start);
  const [span, setSpanState] = useState<Span>(initial.span);
  const [gran, setGran] = useState<Granularity>(initial.gran);
  const [colourBy, setColourBy] = useState<ColourBy>(initial.colourBy);
  const [rollColumn, setRollColumn] = useState(0);
  // Most of the 225 named resources (sales, design) never take an RMT booking, so a board
  // showing everyone is 200 rows of dashes. Start on the people who are actually out.
  const [hideIdle, setHideIdle] = useState(true);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const requestKey = `${company}|${team}|${type}|${spec}|${start}|${span}`;
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
    params.set('span', String(span));
    params.set('step', gran);
    params.set('by', colourBy);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [company, team, type, spec, start, span, gran, colourBy]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      company: String(company),
      start,
      weeks: String(span),
      team: String(team),
      type,
      specialty: String(spec),
    });
    fetch(`/api/rmt/deployment?${params.toString()}`)
      .then((r) => r.json() as Promise<DeploymentResponse>)
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
  }, [requestKey, company, team, type, spec, start, span]);

  // Teams are per company, so a change of company drops the team and specialty filters.
  const setCompany = useCallback((next: number) => {
    setCompanyState(next);
    setTeam(0);
    setSpec(0);
  }, []);

  // Past 13 weeks a week-per-column board stops being readable, so the step follows.
  const setSpan = useCallback((next: Span) => {
    setSpanState(next);
    setRollColumn(0);
    setGran((g) => (next > WEEKLY_UP_TO ? 'month' : g));
  }, []);

  const shiftWindow = useCallback(
    (direction: -1 | 1) => {
      setStart((s) => addDays(s, direction * span * 7));
      setRollColumn(0);
    },
    [span],
  );

  const jumpTo = useCallback((next: string, nextSpan: Span) => {
    setStart(next);
    setSpanState(nextSpan);
    setRollColumn(0);
    setGran(nextSpan > WEEKLY_UP_TO ? 'month' : 'week');
  }, []);

  const columns = useMemo(() => buildColumns(start, span, gran), [start, span, gran]);
  const projects = useMemo(() => projectSwatches(data?.projectRank ?? []), [data]);

  const teams = useMemo(() => {
    if (!data) return [];
    const built = buildBoard(data.resources, data.cells, columns, colourBy, projects);
    if (!hideIdle) return built;
    return built.map((t) => ({ ...t, rows: t.rows.filter((r) => r.bookedWeeks > 0) })).filter((t) => t.rows.length > 0);
  }, [data, columns, colourBy, projects, hideIdle]);

  const legend = useMemo(() => buildLegend(teams, colourBy, projects, columns), [teams, colourBy, projects, columns]);
  const totals = useMemo(() => columnTotals(teams, columns), [teams, columns]);
  const safeRollColumn = Math.min(rollColumn, Math.max(0, columns.length - 1));
  const roll = useMemo(() => rollCall(teams, safeRollColumn), [teams, safeRollColumn]);
  const travel = useMemo(() => travelLoad(teams, columns), [teams, columns]);

  const people = teams.reduce((n, t) => n + t.rows.length, 0);
  const awayWeeks = teams.reduce((n, t) => n + t.awayWeeks, 0);
  const capacity = totals.reduce((n, c) => n + c.capacity, 0);
  const booked = totals.reduce((n, c) => n + c.booked, 0);
  const destinations = new Set(
    teams.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c) => c.away && c.top).map((c) => c.top!.locationName))),
  ).size;

  const options = data?.options ?? null;
  const cardClass = `avail-card${loading ? ' is-loading' : ''}`;

  const records: Array<[string, string]> = [
    ['People on the board', String(people)],
    ['Window', `${span} weeks`],
    ['Person-weeks away', String(awayWeeks)],
    ['Booked of capacity', capacity ? `${Math.round((booked / capacity) * 100)}%` : '—'],
    ['Destinations', String(destinations)],
  ];

  const presets: Array<{ label: string; start: string; span: Span }> = [
    { label: 'From today', start: initial.thisMonday, span: 4 },
    // A month is 4 or 5 Mondays; the preset jumps to its first one and the span control
    // stays free, rather than adding a 5w button that only these two presets would use.
    { label: 'This month', start: monthStart(initial.thisMonday, 0), span: 4 },
    { label: 'Next month', start: monthStart(initial.thisMonday, 1), span: 4 },
    { label: 'This quarter', start: quarterStart(initial.thisMonday, 0), span: 13 },
    { label: 'Next quarter', start: quarterStart(initial.thisMonday, 1), span: 13 },
  ];

  return (
    <main className="page">
      <PageHeader
        title="RMT Deployment"
        rightActions={
          data ? (
            <span className="page-count">
              {people} of {data.totalResources} people{loading ? ' · refreshing…' : ''}
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
              <span id="dep-type-label">Resource type</span>
              <div className="seg" role="group" aria-labelledby="dep-type-label">
                {TYPE_OPTIONS.filter((t) => t.code !== 'Gen').map((t) => (
                  <button key={t.code} type="button" className={t.code === type ? 'is-active' : undefined} aria-pressed={t.code === type} onClick={() => setType(t.code)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="avail-hint">
              Named people only: a generic placeholder is demand, not somebody who can be sent anywhere.
            </p>
          </section>

          <section className="avail-card dep-records" aria-label="Summary">
            {records.map(([label, value]) => (
              <div key={label} className="dep-record">
                <div className="dep-record-value">{value}</div>
                <div className="dep-record-label">{label}</div>
              </div>
            ))}
          </section>

          <section className={cardClass} aria-label="Window">
            <div className="dep-window">
              <div className="dep-nav">
                <button type="button" onClick={() => shiftWindow(-1)} aria-label="Previous window">
                  ‹
                </button>
                <span className="dep-range">{rangeLabel(start, span)}</span>
                <button type="button" onClick={() => shiftWindow(1)} aria-label="Next window">
                  ›
                </button>
              </div>
              <div className="dep-presets">
                {presets.map((p) => {
                  const active = p.start === start && p.span === span;
                  return (
                    <button key={p.label} type="button" className={active ? 'is-active' : undefined} aria-pressed={active} onClick={() => jumpTo(p.start, p.span)}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="dep-window-spacer" />
              <div className="avail-control">
                <span className="avail-control-label">Span</span>
                <div className="seg" role="group" aria-label="Span">
                  {SPAN_OPTIONS.map((v) => (
                    <button key={v} type="button" className={span === v ? 'is-active' : undefined} aria-pressed={span === v} onClick={() => setSpan(v)}>
                      {v}w
                    </button>
                  ))}
                </div>
              </div>
              <div className="avail-control">
                <span className="avail-control-label">Step</span>
                <div className="seg" role="group" aria-label="Step">
                  {(['week', 'month'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={gran === v ? 'is-active' : undefined}
                      aria-pressed={gran === v}
                      disabled={v === 'week' && span > WEEKLY_UP_TO}
                      title={v === 'week' && span > WEEKLY_UP_TO ? `A ${span}-week board is only readable stepped by month` : undefined}
                      onClick={() => {
                        setGran(v);
                        setRollColumn(0);
                      }}
                    >
                      {v === 'week' ? 'Weeks' : 'Months'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="avail-hint dep-window-hint">Window starts {fmtDMY(start)}. Team, specialty and type narrow every panel below.</p>
          </section>

          <section className={cardClass} aria-label="Deployment board">
            <DeploymentBoard
              teams={teams}
              columns={columns}
              totals={totals}
              legend={legend}
              colourBy={colourBy}
              onColourBy={setColourBy}
              rollColumn={safeRollColumn}
              onRollColumn={setRollColumn}
              hideIdle={hideIdle}
              onHideIdle={setHideIdle}
              loading={loading && !data}
            />
          </section>

          <div className="dep-panels">
            <section className={cardClass} aria-label="Roll-call">
              <RollCall groups={roll} column={columns[safeRollColumn]} people={people} />
            </section>
            <section className={cardClass} aria-label="Travel load per team">
              <TravelLoad teams={travel} awayWeeks={awayWeeks} span={span} />
            </section>
          </div>
        </div>
      </PageHeader>
    </main>
  );
}
