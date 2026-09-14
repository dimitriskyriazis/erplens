/**
 * Turns one project's RMT timeline (tasks, planned/estimate actions, logged actions) into
 * the rows of the plan grid: a task row per task, a person row per resource under it,
 * every row carrying the bars its timeline cell draws. Pure functions, no React.
 */
import type { ProjectTimeline } from './timelineQueries';

export const DAY_MS = 86_400_000;
export const NO_TASK = 'Logged without a task';

export type Range = { start: number; end: number };

/** Shared by the header and every timeline cell: domain in ms plus zoom. */
export type TimeScale = { start: number; end: number; pxPerDay: number; now: number };

export type BarKind = 'task' | 'estimate' | 'planned' | 'done';

export type PlanBar = {
  kind: BarKind;
  start: number;
  end: number;
  who: string;
  colour: string | null;
  detail: string;
  hours: number | null;
};

export type PlanRowKind = 'task' | 'notask' | 'person' | 'estimate';

export type PlanRow = {
  id: string;
  /** Tree path for AG Grid: [task] or [task, personKey]. */
  path: string[];
  kind: PlanRowKind;
  task: string;
  /** Display name in the tree column. */
  name: string;
  who: string | null;
  colour: string | null;
  start: number | null;
  end: number | null;
  phase: string | null;
  status: string | null;
  percent: number | null;
  plannedDays: number | null;
  doneHours: number | null;
  estimateDays: number | null;
  /** Number of person/estimate rows under a task row. */
  people: number;
  bars: PlanBar[];
};

export type PlanModel = {
  rows: PlanRow[];
  people: Array<{ who: string; colour: string }>;
  full: Range;
  workRange: Range | null;
};

/** Distinct colours for people, assigned in order of first appearance. */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0d9488', '#ea580c', '#4f46e5', '#b45309'];

/** Activity spans up to this long open in full; longer ones open on their densest stretch. */
const OPEN_FULL_UP_TO_DAYS = 270;

/** 'yyyy-MM-dd HH:mm' from the API, as a local wall-clock instant in ms. */
export const parseDb = (v: string | null): number | null => {
  if (!v) return null;
  const [d, t = '00:00'] = v.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const ms = new Date(y, m - 1, day, hh, mm).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export const fmtDateTime = (ms: number | null): string => {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const fmtDate = (ms: number | null): string => {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * Display name for a resource: drops the employer in brackets ("(QUANTUM ELECTRIC
 * TECHNOLOGIES)") and the "_… Generic" dressing of estimate resources.
 */
export const shortName = (who: string): string =>
  who
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^_+/, '')
    .replace(/\s*generic\s*$/i, '')
    .trim() || who;

/** Inclusive calendar days covered by an interval (09:00 to 17:00 same day = 1). */
const calendarDays = (start: number, end: number): number => {
  const a = new Date(start);
  const b = new Date(end);
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dayB - dayA) / DAY_MS) + 1;
};

type Interval = {
  task: string;
  who: string;
  kind: 'planned' | 'estimate' | 'done';
  start: number;
  end: number;
  detail: string;
  hours: number | null;
  estimateDays: number | null;
};

/**
 * The shortest window holding `share` of the intervals (by midpoint), widened to the
 * full extent of the intervals inside it: where the work actually happened.
 */
function denseWindow(items: Interval[], share = 0.8): Range | null {
  if (items.length === 0) return null;
  const mid = (b: Interval) => (b.start + b.end) / 2;
  const mids = items.map(mid).sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(mids.length * share));
  let best = { start: mids[0], end: mids[mids.length - 1] };
  for (let i = 0; i + k - 1 < mids.length; i += 1) {
    if (mids[i + k - 1] - mids[i] < best.end - best.start) best = { start: mids[i], end: mids[i + k - 1] };
  }
  const inside = items.filter((b) => mid(b) >= best.start && mid(b) <= best.end);
  const start = Math.min(...inside.map((b) => b.start));
  const end = Math.max(...inside.map((b) => b.end));
  const span = Math.max(end - start, 14 * DAY_MS);
  const pad = Math.max(DAY_MS, span * 0.06);
  const centre = (start + end) / 2;
  return { start: Math.min(start, centre - span / 2) - pad, end: Math.max(end, centre + span / 2) + pad };
}

/** Task labels must be unique tree keys; disambiguate repeats with the line number. */
function taskLabels(tasks: ProjectTimeline['tasks']): Map<number, string> {
  const seen = new Map<string, number>();
  tasks.forEach((t) => seen.set(t.name, (seen.get(t.name) ?? 0) + 1));
  const labels = new Map<number, string>();
  tasks.forEach((t) => {
    const base = t.name || `Task line ${t.lineNum}`;
    labels.set(t.taskLineId, (seen.get(t.name) ?? 0) > 1 ? `${base} (#${t.lineNum})` : base);
  });
  return labels;
}

export function buildPlanModel(data: Pick<ProjectTimeline, 'tasks' | 'actions' | 'done'>, now: number): PlanModel {
  const labels = taskLabels(data.tasks);
  const taskOf = (taskLineId: number) => labels.get(taskLineId) ?? NO_TASK;

  const intervals: Interval[] = [];
  data.actions.forEach((a) => {
    const start = parseDb(a.start);
    const end = parseDb(a.end);
    if (start === null || end === null || end < start) return;
    intervals.push({
      task: taskOf(a.taskLineId),
      who: a.resource ?? a.initials ?? 'unassigned',
      kind: a.kind,
      start,
      end,
      detail: [a.isTravel ? 'travel' : '', a.remarks ?? ''].filter(Boolean).join(' · '),
      hours: null,
      estimateDays: a.estimatePersonDays,
    });
  });
  data.done.forEach((d) => {
    const start = parseDb(d.start);
    const end = parseDb(d.end);
    if (start === null || end === null || end < start) return;
    intervals.push({
      task: taskOf(d.taskLineId),
      who: d.resource ?? d.initials ?? 'unknown',
      kind: 'done',
      start,
      end,
      detail: [d.description ?? '', d.remarks ?? ''].filter(Boolean).join(' · '),
      hours: d.hours,
      estimateDays: null,
    });
  });

  // One colour per named person, in order of first appearance (planned first, then logged).
  const colours = new Map<string, string>();
  [...intervals.filter((i) => i.kind === 'planned'), ...intervals.filter((i) => i.kind === 'done')].forEach((i) => {
    if (!colours.has(i.who)) colours.set(i.who, PALETTE[colours.size % PALETTE.length]);
  });

  const taskOrder = data.tasks.map((t) => taskOf(t.taskLineId));
  if (intervals.some((i) => i.task === NO_TASK)) taskOrder.push(NO_TASK);

  const rows: PlanRow[] = [];
  taskOrder.forEach((task) => {
    const t = data.tasks.find((x) => taskOf(x.taskLineId) === task);
    const tStart = t ? parseDb(t.start) : null;
    const tEnd = t ? parseDb(t.end) : null;
    const own = intervals.filter((i) => i.task === task);

    // Person rows: generic estimates first, then people by when they first appear.
    const byKey = new Map<string, Interval[]>();
    own.forEach((i) => {
      const key = `${task}|${i.kind === 'estimate' ? '~' : ''}${i.who}`;
      byKey.set(key, [...(byKey.get(key) ?? []), i]);
    });
    const personKeys = Array.from(byKey.keys()).sort((a, b) => {
      const ea = a.includes('|~');
      const eb = b.includes('|~');
      if (ea !== eb) return ea ? -1 : 1;
      const fa = Math.min(...(byKey.get(a) ?? []).map((i) => i.start));
      const fb = Math.min(...(byKey.get(b) ?? []).map((i) => i.start));
      return fa - fb;
    });

    const taskRow: PlanRow = {
      id: task,
      path: [task],
      kind: task === NO_TASK ? 'notask' : 'task',
      task,
      name: task,
      who: null,
      colour: null,
      start: tStart,
      end: tEnd,
      phase: t?.phase ?? null,
      status: t?.status ?? null,
      percent: t?.percentComplete ?? null,
      plannedDays: null,
      doneHours: null,
      estimateDays: null,
      people: personKeys.length,
      bars:
        tStart !== null && tEnd !== null && tEnd >= tStart
          ? [{ kind: 'task', start: tStart, end: tEnd, who: '', colour: null, detail: [t?.phase, t?.status].filter(Boolean).join(' · '), hours: null }]
          : [],
    };
    rows.push(taskRow);

    let plannedDaysTotal = 0;
    let doneHoursTotal = 0;
    personKeys.forEach((key) => {
      const items = byKey.get(key) ?? [];
      const who = items[0].who;
      const estimate = key.includes('|~');
      const colour = estimate ? null : (colours.get(who) ?? '#64748b');
      const bars: PlanBar[] = items.map((i) => ({ kind: i.kind, start: i.start, end: i.end, who, colour, detail: i.detail, hours: i.hours }));
      const plannedDays = estimate ? null : items.filter((i) => i.kind === 'planned').reduce((s, i) => s + calendarDays(i.start, i.end), 0);
      const doneHours = estimate ? null : items.filter((i) => i.kind === 'done').reduce((s, i) => s + (i.hours ?? 0), 0);
      const estimateDays = estimate ? items.reduce((s, i) => s + (i.estimateDays ?? 0), 0) : null;
      plannedDaysTotal += plannedDays ?? 0;
      doneHoursTotal += doneHours ?? 0;
      rows.push({
        id: key,
        path: [task, key],
        kind: estimate ? 'estimate' : 'person',
        task,
        name: `${shortName(who)}${estimate ? ' (estimate)' : ''}`,
        who,
        colour,
        start: Math.min(...items.map((i) => i.start)),
        end: Math.max(...items.map((i) => i.end)),
        phase: null,
        status: null,
        percent: null,
        plannedDays: plannedDays && plannedDays > 0 ? plannedDays : null,
        doneHours: doneHours && doneHours > 0 ? Math.round(doneHours * 10) / 10 : null,
        estimateDays: estimateDays && estimateDays > 0 ? estimateDays : null,
        people: 0,
        bars,
      });
    });
    taskRow.plannedDays = plannedDaysTotal > 0 ? plannedDaysTotal : null;
    taskRow.doneHours = doneHoursTotal > 0 ? Math.round(doneHoursTotal * 10) / 10 : null;
  });

  // Domain: everything, padded.
  const allStarts = rows.flatMap((r) => r.bars.map((b) => b.start));
  const allEnds = rows.flatMap((r) => r.bars.map((b) => b.end));
  const minT = allStarts.length ? Math.min(...allStarts) : now - 30 * DAY_MS;
  const maxT = allEnds.length ? Math.max(...allEnds) : now + 30 * DAY_MS;
  const pad = Math.max(DAY_MS, (maxT - minT) * 0.03);
  const full: Range = { start: minT - pad, end: maxT + pad };

  // Opening view: the named people's work (planned and logged). Short spans open in full;
  // long ones open on their densest stretch. Today joins only when it is already close.
  const named = intervals.filter((i) => i.kind !== 'estimate');
  const work = named.length ? named : intervals;
  let workRange: Range | null = null;
  if (work.length) {
    const wStart = Math.min(...work.map((b) => b.start));
    const wEnd = Math.max(...work.map((b) => b.end));
    if (wEnd - wStart <= OPEN_FULL_UP_TO_DAYS * DAY_MS) {
      const wPad = Math.max(DAY_MS, (wEnd - wStart) * 0.04);
      workRange = { start: wStart - wPad, end: wEnd + wPad };
    } else {
      workRange = denseWindow(work);
    }
  }
  if (workRange) {
    const slack = (workRange.end - workRange.start) * 0.25;
    if (now >= workRange.start - slack && now <= workRange.end + slack) {
      workRange = { start: Math.min(workRange.start, now - 3 * DAY_MS), end: Math.max(workRange.end, now + 3 * DAY_MS) };
    }
    workRange = { start: Math.max(full.start, workRange.start), end: Math.min(full.end, workRange.end) };
  }

  return { rows, people: Array.from(colours.entries()).map(([who, colour]) => ({ who, colour })), full, workRange };
}
