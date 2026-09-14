'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/app/components/PageHeader';
import ProjectPicker, { fmtDbDate } from '@/app/rmt/components/ProjectPicker';
import { useProjectTimeline } from '@/app/rmt/components/useProjectTimeline';

// AG Grid touches window at import time: browser only.
const PlanGrid = dynamic(() => import('./PlanGrid'), {
  ssr: false,
  loading: () => <div className="timeline-empty">Loading plan…</div>,
});

type Company = { id: number; name: string };
type Props = {
  companies: Company[];
  initialCompany: number;
  initialPrjc: number | null;
};

export default function RmtPlanClient({ companies, initialCompany, initialPrjc }: Props) {
  const { company, setCompany, prjc, setPrjc, data, loading, error, loadedAt } = useProjectTimeline(initialCompany, initialPrjc);

  const summary = useMemo(() => {
    if (!data?.project) return null;
    const planned = data.actions.filter((a) => a.kind === 'planned').length;
    const estimates = data.actions.length - planned;
    const starts = data.tasks.map((t) => t.start).filter(Boolean).sort();
    const ends = data.tasks.map((t) => t.end).filter(Boolean).sort();
    return { tasks: data.tasks.length, planned, estimates, done: data.done.length, from: fmtDbDate(starts[0] ?? null), to: fmtDbDate(ends[ends.length - 1] ?? null) };
  }, [data]);

  const projectLabel = data?.project ? `${data.project.code} · ${data.project.name}` : '';

  // While a new project loads, `data` still holds the previous one; the grid waits so it
  // never mounts (and fits its time scale) on the wrong project.
  let body: React.ReactNode;
  if (loading) {
    body = <div className="timeline-empty">Loading…</div>;
  } else if (data?.project && data.tasks.length > 0) {
    body = <PlanGrid key={`${company}:${prjc}`} data={data} now={loadedAt} />;
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
        title="RMT Plan"
        leftActions={<ProjectPicker company={company} selectedPrjc={prjc} placeholder={projectLabel} onChoose={(hit) => setPrjc(hit.prjc)} />}
        rightActions={
          <label className="header-label">
            <span>Company</span>
            <select className="header-control" value={company} onChange={(e) => setCompany(Number(e.target.value))}>
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
        <div className="timeline-card plan-card">{body}</div>
      </PageHeader>
    </main>
  );
}
