import RmtPlanClient from './RmtPlanClient';
import { getMeta } from '@/lib/meta';

// Reads the live ERP on every request; never prerender at build time.
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * One project's plan, the detail behind a row of the projects table. The project is the path
 * segment, so the address names what is on screen and can be shared as it is; company stays a
 * query parameter because it selects the ledger, not the thing being looked at.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ prjc: string }>; searchParams: Promise<SearchParams> }) {
  const { prjc: prjcRaw } = await params;
  const sp = await searchParams;
  const meta = await getMeta().catch(() => null);
  const companies = meta?.companies?.length
    ? meta.companies
    : [
        { id: 1, name: 'Company 1' },
        { id: 2, name: 'Company 2' },
      ];
  const defaultCompany = Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1);
  const company = Number(first(sp.company)) || defaultCompany;
  const prjc = Number(prjcRaw) || null;
  return <RmtPlanClient companies={companies} initialCompany={company} initialPrjc={prjc} />;
}
