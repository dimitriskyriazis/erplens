'use client';

import { useEffect, useRef, useState } from 'react';
import type { RmtProjectHit } from '@/lib/rmt/timelineQueries';

type ProjectsResponse = { ok: true; projects: RmtProjectHit[] } | { ok: false; error: string };

type Props = {
  company: number;
  selectedPrjc: number | null;
  /** Shown when nothing is typed, normally the current project's code and name. */
  placeholder: string;
  onChoose: (hit: RmtProjectHit) => void;
};

export const fmtDbDate = (v: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '');

/** Search box with a dropdown of projects that carry RMT tasks, newest plan first. */
export default function ProjectPicker({ company, selectedPrjc, placeholder, onChoose }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RmtProjectHit[]>([]);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Debounced search; an empty query lists the most recent plans. Stale hits are cleared
  // as soon as the text changes so a click never lands on the previous search's result.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/rmt/projects?company=${company}&q=${encodeURIComponent(query.trim())}&limit=25`)
        .then((r) => r.json() as Promise<ProjectsResponse>)
        .then((p) => {
          if (cancelled) return;
          if (p.ok) setHits(p.projects);
          setPending(false);
        })
        .catch(() => {
          if (!cancelled) setPending(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, company]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="picker" ref={ref}>
      <input
        className="header-control header-control--search"
        type="search"
        placeholder={placeholder || 'Find a project by code or name'}
        value={query}
        onFocus={() => {
          setOpen(true);
          setPending(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHits([]);
          setPending(true);
          setOpen(true);
        }}
        aria-label="Find project"
      />
      {open && (
        <div className="picker-list" role="listbox">
          {hits.length === 0 && <div className="picker-empty">{pending ? 'Searching…' : 'No matching projects with RMT tasks'}</div>}
          {hits.map((h) => (
            <button
              key={h.prjc}
              type="button"
              className="picker-item"
              role="option"
              aria-selected={h.prjc === selectedPrjc}
              onClick={() => {
                onChoose(h);
                setQuery('');
                setHits([]);
                setOpen(false);
              }}
            >
              <span className="code">{h.code}</span>
              <span className="name">{h.name}</span>
              <span className="meta">
                {h.tasks} tasks · {fmtDbDate(h.firstStart)} to {fmtDbDate(h.lastEnd)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
