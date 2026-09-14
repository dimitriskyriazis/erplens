'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProjectTimeline, RmtProjectHit } from '@/lib/rmt/timelineQueries';

type TimelineResponse = ({ ok: true } & ProjectTimeline) | { ok: false; error: string };
type ProjectsResponse = { ok: true; projects: RmtProjectHit[] } | { ok: false; error: string };

/** Result of the last completed request, tagged with the request it answers and when it landed. */
type Loaded = { key: string; data: ProjectTimeline | null; error: string | null; at: number };

/**
 * Company and project selection for an RMT screen, kept in the URL, plus the project's
 * timeline data. With no project in the URL it picks the one whose plan ends latest.
 */
export function useProjectTimeline(initialCompany: number, initialPrjc: number | null) {
  const [company, setCompanyState] = useState(initialCompany);
  const [prjc, setPrjc] = useState<number | null>(initialPrjc);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const requestKey = prjc ? `${company}:${prjc}` : null;
  const loading = requestKey !== null && loaded?.key !== requestKey;
  const data = loaded?.data ?? null;
  const error = loaded?.key === requestKey ? loaded.error : pickError;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('company', String(company));
    if (prjc) params.set('prjc', String(prjc));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [company, prjc]);

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

  useEffect(() => {
    if (!requestKey || !prjc) return;
    let cancelled = false;
    fetch(`/api/rmt/timeline?company=${company}&prjc=${prjc}`)
      .then((r) => r.json() as Promise<TimelineResponse>)
      .then((p) => {
        if (cancelled) return;
        if (!p.ok) throw new Error(p.error);
        setLoaded({ key: requestKey, data: p, error: null, at: Date.now() });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({ key: requestKey, data: null, error: err instanceof Error ? err.message : String(err), at: Date.now() });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, company, prjc]);

  const setCompany = useCallback((next: number) => {
    setCompanyState(next);
    setPrjc(null);
    setLoaded(null);
    setPickError(null);
  }, []);

  return { company, setCompany, prjc, setPrjc, data, loading, error, loadedAt: loaded?.at ?? 0 };
}
