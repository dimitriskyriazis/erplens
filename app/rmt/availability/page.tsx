import RmtAvailabilityClient, { type AvailabilityInitial } from './RmtAvailabilityClient';
import { getMeta } from '@/lib/meta';
import { NEED_OPTIONS, TYPE_OPTIONS, WINDOW_OPTIONS, isoDate, mondayOf } from '@/lib/rmt/availabilityModel';

// Reads the live ERP on every request; never prerender at build time.
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const oneOf = <T extends number>(v: string | undefined, allowed: readonly T[], fallback: T): T => {
  const n = Number(v);
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback;
};

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
  const initial: AvailabilityInitial = {
    company: Number(first(sp.company)) || defaultCompany,
    team: Number(first(sp.team)) || 0,
    type: TYPE_OPTIONS.some((t) => t.code === typeRaw) ? typeRaw : '',
    spec: Number(first(sp.spec)) || 0,
    start,
    thisMonday,
    weeks: oneOf(first(sp.weeks), WINDOW_OPTIONS, 2),
    need: oneOf(first(sp.need), NEED_OPTIONS, 5),
  };
  return <RmtAvailabilityClient companies={companies} initial={initial} />;
}
