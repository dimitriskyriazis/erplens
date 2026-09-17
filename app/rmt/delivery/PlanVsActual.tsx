'use client';

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
};

/**
 * The plan sits at two thirds of the track, so a bar that reaches the marker is exactly on
 * estimate and anything past it is visibly over. Keeping the marker in a fixed place lets
 * rows be compared down the column without reading the numbers.
 */
const PLAN_AT = 66.6;

type Bar = { done: number; over: number; ratio: number | null };

const barOf = (planned: number, logged: number): Bar => {
  if (planned <= 0) return { done: 0, over: 0, ratio: null };
  const ratio = logged / planned;
  return { done: Math.min(ratio, 1) * PLAN_AT, over: Math.max(0, ratio - 1) * PLAN_AT, ratio };
};

const deltaLabel = (planned: number, logged: number): string => {
  const d = Math.round(logged - planned);
  return `${d > 0 ? '+' : ''}${d.toLocaleString('en-GB')}`;
};

/**
 * Work logged against no estimate at all. An empty track would read as "nothing happened",
 * which is the opposite of the truth, so it gets its own label — and the delta stays neutral,
 * because hours cannot be over a plan that was never set.
 */
const NoPlan = () => <span className="del-no-plan">no estimate</span>;

const Comparison = ({ planned, logged, task }: { planned: number; logged: number; task?: boolean }) => {
  const bar = barOf(planned, logged);
  if (bar.ratio === null) return <NoPlan />;
  return (
    <span className={`del-bar${task ? ' is-task' : ''}`}>
      <i className="del-bar-done" style={{ width: `${bar.done}%` }} />
      {bar.over > 0 && <i className="del-bar-over" style={{ left: `${PLAN_AT}%`, width: `${Math.min(bar.over, 100 - PLAN_AT)}%` }} />}
      <i className="del-bar-plan" style={{ left: `${PLAN_AT}%` }} />
    </span>
  );
};

/** Planned person-days at 8 hours against logged hours, per project and per task. */
export default function PlanVsActual({ projects, tasksByProject, open, onToggle, loading }: Props) {
  return (
    <>
      <div className="avail-head">
        <div>
          <h2>Plan against actual</h2>
          <p className="avail-sub">
            Planned person-days at 8 hours against logged hours. Click a project for its tasks. The tick is the estimate; red is past it.
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
            <span className="del-bar-col">Logged vs planned</span>
            <span className="del-num">Planned h</span>
            <span className="del-num">Logged h</span>
            <span className="del-num">Delta</span>
          </div>

          {projects.map((p) => {
            const isOpen = open === p.code;
            const bar = barOf(p.plannedHours, p.loggedHours);
            const tasks = tasksByProject.get(p.prjc) ?? [];
            const tip = {
              heading: `${p.code} · ${p.name}`,
              rows: [
                ['Planned', `${fmtHours(p.plannedHours)} h`],
                ['Logged', `${fmtHours(p.loggedHours)} h`],
                ['Against plan', bar.ratio === null ? 'no estimate' : `${Math.round(bar.ratio * 100)}%`],
                ['Tasks', String(p.tasks)],
              ] as Array<[string, string]>,
            };
            return (
              <div key={p.code} className={`del-group${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="del-row"
                  aria-expanded={isOpen}
                  onClick={() => onToggle(p.code)}
                  {...tipHandlers(tip)}
                >
                  <span className="del-code">
                    <i className="del-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </i>
                    {p.code}
                  </span>
                  <span className="del-name">{p.name}</span>
                  <span className="del-bar-col">
                    <Comparison planned={p.plannedHours} logged={p.loggedHours} />
                  </span>
                  <span className="del-num">{p.plannedHours > 0 ? fmtHours(p.plannedHours) : '—'}</span>
                  <span className="del-num is-strong">{fmtHours(p.loggedHours)}</span>
                  <span className={`del-num${p.plannedHours > 0 && p.loggedHours > p.plannedHours ? ' is-over' : ''}`}>
                    {p.plannedHours > 0 ? deltaLabel(p.plannedHours, p.loggedHours) : '—'}
                  </span>
                </button>

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
                            <Comparison planned={t.plannedHours} logged={t.loggedHours} task />
                          </span>
                          <span className="del-num">{t.plannedHours > 0 ? fmtHours(t.plannedHours) : '—'}</span>
                          <span className="del-num">{fmtHours(t.loggedHours)}</span>
                          <span className={`del-num${t.plannedHours > 0 && t.loggedHours > t.plannedHours ? ' is-over' : ''}`}>
                            {t.plannedHours > 0 ? deltaLabel(t.plannedHours, t.loggedHours) : '—'}
                          </span>
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
          Delta is logged minus planned hours. A project still running reads negative until the work is done, so read it with the task dates.
        </span>
        <span className="del-legend">
          <i className="del-swatch-done" /> Within plan
          <i className="del-swatch-over" /> Past plan
        </span>
      </div>
    </>
  );
}
