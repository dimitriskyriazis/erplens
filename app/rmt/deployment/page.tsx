import RmtDeploymentClient, { type DeploymentInitial } from './RmtDeploymentClient';
import { getMeta } from '@/lib/meta';
import { TYPE_OPTIONS, isoDate, mondayOf } from '@/lib/rmt/availabilityModel';
import { SPAN_OPTIONS, WEEKLY_UP_TO, type Granularity, type Span } from '@/lib/rmt/deploymentModel';

// Reads the live ERP on every request; never prerender at build time.
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const meta = await getMeta().catch(() => null);
  const companies = meta?.companies?.length
    ? meta.companies
    : [
        { id: 1, name: 'Company 1' },
        { id: 2, name: 'Company 2' },
      ];
  const defaultCompany = Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1);

  // The window always starts on a Monday; a date in the URL is snapped to its week.
  const thisMonday = mondayOf(isoDate(new Date()));
  const startRaw = first(sp.start);
  const start = startRaw && /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? mondayOf(startRaw) : thisMonday;
  const typeRaw = first(sp.type) ?? '';
  const spanRaw = Number(first(sp.span));
  const span = (SPAN_OPTIONS as readonly number[]).includes(spanRaw) ? (spanRaw as Span) : 8;
  const granRaw = first(sp.step);
  // A 26-week board is unreadable one column per week, so long spans open stepped by month.
  const gran: Granularity = granRaw === 'week' || granRaw === 'month' ? granRaw : span > WEEKLY_UP_TO ? 'month' : 'week';

  const initial: DeploymentInitial = {
    company: Number(first(sp.company)) || defaultCompany,
    team: Number(first(sp.team)) || 0,
    type: TYPE_OPTIONS.some((t) => t.code === typeRaw) ? typeRaw : '',
    spec: Number(first(sp.spec)) || 0,
    start,
    thisMonday,
    span,
    gran,
    colourBy: first(sp.by) === 'project' ? 'project' : 'place',
  };
  return <RmtDeploymentClient companies={companies} initial={initial} />;
}
