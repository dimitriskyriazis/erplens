'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/app/components/PageHeader';
import type { ProjectTimeline, RmtProjectHit } from '@/lib/rmt/timelineQueries';

// AG Charts renders to canvas and touches window at import time: browser only.
const TimelineChart = dynamic(() => import('./TimelineChart'), {
  ssr: false,
  loading: () => <div className="timeline-empty">Loading chart…</div>,
});

type Company = { id: number; name: string };
type Props = {
  companies: Company[];
  initialCompany: number;
  initialPrjc: number | null;
};

type TimelineResponse = ({ ok: true } & ProjectTimeline) | { ok: false; error: string };
type ProjectsResponse = { ok: true; projects: RmtProjectHit[] } | { ok: false; error: string };

/** Result of the last completed timeline request, tagged with the request it answers. */
type Loaded = { key: string; data: ProjectTimeline | null; error: string | null };

const fmtDate = (v: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '');

export default function RmtTimelineClient({ companies, initialCompany, initialPrjc }: Props) {
  const [company, setCompany] = useState(initialCompany);
  const [prjc, setPrjc] = useState<number | null>(initialPrjc);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Project picker
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RmtProjectHit[]>([]);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const requestKey = prjc ? `${company}:${prjc}` : null;
  const loading = requestKey !== null && loaded?.key !== requestKey;
  const data = loaded?.data ?? null;
  const error = loaded?.key === requestKey ? loaded.error : pickError;

  // Keep the URL shareable: /rmt/timeline?company=1&prjc=89050
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('company', String(company));
    if (prjc) params.set('prjc', String(prjc));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [company, prjc]);

  // No project chosen: take the one whose plan ends latest, so the page never opens empty.
  useEffect(() => {
    if (prjc) return;
    let cancelled = false;
    fetch(`/api/rmt/projects?company=${company}&q=&limit=1`)
      .then((r) => r.json() as Promise<ProjectsResponse>)
      .then((p) => {
        if (cancelled) return;
        if (!p.ok) {
          setPickError(p.error);
          return;
        }
        if (p.projects[0]) setPrjc(p.projects[0].prjc);
        else setPickError('No projects with RMT tasks in this company.');
      })
      .catch((err: unknown) => {
        if (!cancelled) setPickError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [company, prjc]);

  // Load the timeline for the chosen project.
  useEffect(() => {
    if (!requestKey || !prjc) return;
    let cancelled = false;
    fetch(`/api/rmt/timeline?company=${company}&prjc=${prjc}`)
      .then((r) => r.json() as Promise<TimelineResponse>)
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
  }, [requestKey, company, prjc]);

  // Picker search, debounced; an empty query lists the most recent plans.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/rmt/projects?company=${company}&q=${encodeURIComponent(query.trim())}&limit=25`)
        .then((r) => r.json() as Promise<ProjectsResponse>)
        .then((p) => {
          if (!cancelled && p.ok) setHits(p.projects);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, company]);

  // Close the picker on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = useCallback((hit: RmtProjectHit) => {
    setPrjc(hit.prjc);
    setQuery('');
    setOpen(false);
  }, []);

  const changeCompany = useCallback((next: number) => {
    setCompany(next);
    setPrjc(null);
    setLoaded(null);
    setPickError(null);
  }, []);

  const summary = useMemo(() => {
    if (!data?.project) return null;
    const planned = data.actions.filter((a) => a.kind === 'planned').length;
    const estimates = data.actions.length - planned;
    const starts = data.tasks.map((t) => t.start).filter(Boolean).sort();
    const ends = data.tasks.map((t) => t.end).filter(Boolean).sort();
    return {
      tasks: data.tasks.length,
      planned,
      estimates,
      done: data.done.length,
      from: fmtDate(starts[0] ?? null),
      to: fmtDate(ends[ends.length - 1] ?? null),
    };
  }, [data]);

  const projectLabel = data?.project ? `${data.project.code} · ${data.project.name}` : '';

  let body: React.ReactNode;
  if (data?.project && data.tasks.length > 0) {
    body = <TimelineChart tasks={data.tasks} actions={data.actions} done={data.done} />;
  } else if (loading) {
    body = <div className="timeline-empty">Loading…</div>;
  } else if (data && data.project) {
    body = <div className="timeline-empty">This project has no RMT tasks.</div>;
  } else if (data && !data.project) {
    body = <div className="timeline-empty">Project not found in this company.</div>;
  } else {
    body = <div className="timeline-empty">Pick a project to see its plan.</div>;
  }

  return (
    <main className="page">
      <PageHeader
        title="RMT Timeline"
        leftActions={
          <div className="picker" ref={pickerRef}>
            <input
              className="header-control header-control--search"
              type="search"
              placeholder={projectLabel || 'Find a project by code or name'}
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              aria-label="Find project"
            />
            {open && (
              <div className="picker-list" role="listbox">
                {hits.length === 0 && <div className="picker-empty">No matching projects with RMT tasks</div>}
                {hits.map((h) => (
                  <button
                    key={h.prjc}
                    type="button"
                    className="picker-item"
                    onClick={() => choose(h)}
                    role="option"
                    aria-selected={h.prjc === prjc}
                  >
                    <span className="code">{h.code}</span>
                    <span className="name">{h.name}</span>
                    <span className="meta">
                      {h.tasks} tasks · {fmtDate(h.firstStart)} to {fmtDate(h.lastEnd)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        }
        rightActions={
          <label className="header-label">
            <span>Company</span>
            <select className="header-control" value={company} onChange={(e) => changeCompany(Number(e.target.value))}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.name}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {error && <div className="banner banner--error">{error}</div>}
        {summary && data?.project && (
          <div className="timeline-meta">
            <strong>{projectLabel}</strong>
            <span>{summary.tasks} tasks</span>
            <span>{summary.planned} planned</span>
            <span>{summary.estimates} estimates</span>
            <span>{summary.done} done</span>
            <span>
              {summary.from} to {summary.to}
            </span>
            {loading && <span>refreshing…</span>}
          </div>
        )}
        <div className="timeline-card">{body}</div>
      </PageHeader>
    </main>
  );
}
