'use client';

import Link from 'next/link';
import { tipHandlers } from '@/app/rmt/components/barTip';
import { fmtDate, parseDb } from '@/lib/rmt/planModel';
import type { DeliveryProject, DeliveryTask } from '@/lib/rmt/deliveryQueries';
import { fmtHours } from './RmtDeliveryClient';

type Props = {
  projects: DeliveryProject[];
  tasksByProject: Map<number, DeliveryTask[]>;
  open: string | null;
  onToggle: (code: string) => void;
  loading: boolean;
  /** Carried into the link to a project's plan, which needs the ledger it belongs to. */
  company: number;
};

type Three = { estimateHours: number; plannedHours: number; loggedHours: number };

const share = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0);
const pct = (v: number, base: number) => (base > 0 ? `${Math.round((v / base) * 100)}%` : 'no figure');

/**
 * Three bars on one scale: the row's own largest figure fills the track, so the shape says
 * which of the three acts is biggest without asking anyone to read three numbers first. Each
 * bar has its own hue and its own printed column, so colour never carries a value alone, and
 * a measure nobody recorded is an empty track rather than a zero.
 */
const Bars = ({ estimateHours, plannedHours, loggedHours, task }: Three & { task?: boolean }) => {
  const max = Math.max(estimateHours, plannedHours, loggedHours);
  if (max <= 0) return <span className="del-none">nothing recorded</span>;
  return (
    <span className={`del-bars${task ? ' is-task' : ''}`}>
      <i className="del-b del-b--est" style={{ width: `${share(estimateHours, max)}%` }} />
      <i className="del-b del-b--plan" style={{ width: `${share(plannedHours, max)}%` }} />
      <i className="del-b del-b--done" style={{ width: `${share(loggedHours, max)}%` }} />
    </span>
  );
};

const cell = (v: number) => (v > 0 ? fmtHours(v) : '—');

/** Estimate, planned and done side by side, per project and per task. */
export default function PlanVsActual({ projects, tasksByProject, open, onToggle, loading, company }: Props) {
  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Estimate, planned and done</h2>
          <p className="avail-sub">
            Three different acts, in hours at 8 hours a person-day: what was estimated, what was then booked into someone&apos;s calendar, and what
            was logged. Click a code for its tasks, a name for that project&apos;s plan.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="timeline-empty">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="timeline-empty">No projects with logged work.</div>
      ) : (
        <div className="del-table">
          <div className="del-head">
            <span className="del-code">Project</span>
            <span className="del-name">Name</span>
            <span className="del-bar-col">Estimate · planned · done</span>
            <span className="del-num">Estimate h</span>
            <span className="del-num">Planned h</span>
            <span className="del-num">Done h</span>
          </div>

          {projects.map((p) => {
            const isOpen = open === p.code;
            const tasks = tasksByProject.get(p.prjc) ?? [];
            const tip = {
              heading: `${p.code} · ${p.name}`,
              rows: [
                ['Estimate', `${cell(p.estimateHours)} h`],
                ['Planned', `${cell(p.plannedHours)} h`],
                ['Done', `${fmtHours(p.loggedHours)} h`],
                ['Done of estimate', pct(p.loggedHours, p.estimateHours)],
                ['Done of planned', pct(p.loggedHours, p.plannedHours)],
                ['Tasks', String(p.tasks)],
                ['Last logged', p.lastLogged ? fmtDate(parseDb(p.lastLogged)) : '—'],
              ] as Array<[string, string]>,
            };
            return (
              <div key={p.code} className={`del-group${isOpen ? ' is-open' : ''}`}>
                <div className="del-row" {...tipHandlers(tip)}>
                  <button
                    type="button"
                    className="del-code"
                    aria-expanded={isOpen}
                    title={isOpen ? `${p.code}: hide its tasks` : `${p.code}: show its tasks`}
                    onClick={() => onToggle(p.code)}
                  >
                    <i className="del-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </i>
                    {p.code}
                  </button>
                  <span className="del-name">
                    <Link href={`/rmt/projects/${p.prjc}?company=${company}`} className="del-plan-link" title={`${p.name}: open its plan`}>
                      {p.name}
                    </Link>
                  </span>
                  <span className="del-bar-col">
                    <Bars estimateHours={p.estimateHours} plannedHours={p.plannedHours} loggedHours={p.loggedHours} />
                  </span>
                  <span className="del-num">{cell(p.estimateHours)}</span>
                  <span className="del-num">{cell(p.plannedHours)}</span>
                  <span className="del-num is-strong">{fmtHours(p.loggedHours)}</span>
                </div>

                {isOpen && (
                  <div className="del-tasks">
                    {tasks.length === 0 ? (
                      <div className="del-task-empty">No tasks on this project.</div>
                    ) : (
                      tasks.map((t) => (
                        <div key={t.id} className="del-task">
                          <span className="del-task-id">{t.id}</span>
                          <span className="del-task-name">
                            {t.name}
                            <em>
                              {fmtDate(parseDb(t.start))}
                              {t.end && t.end !== t.start ? ` – ${fmtDate(parseDb(t.end))}` : ''}
                            </em>
                          </span>
                          <span className="del-bar-col">
                            <Bars estimateHours={t.estimateHours} plannedHours={t.plannedHours} loggedHours={t.loggedHours} task />
                          </span>
                          <span className="del-num">{cell(t.estimateHours)}</span>
                          <span className="del-num">{cell(t.plannedHours)}</span>
                          <span className="del-num">{fmtHours(t.loggedHours)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="avail-foot">
        <span>
          A booking is a day in a calendar, not a budget, so hours far past the planned figure are common on a task that stays open. Read the three
          together rather than as one number against another.
        </span>
        <span className="del-legend">
          <i className="del-swatch-est" /> Estimate
          <i className="del-swatch-plan" /> Planned
          <i className="del-swatch-done" /> Done
        </span>
      </div>
    </>
  );
}
