import RmtDeliveryClient, { type DeliveryInitial } from './RmtDeliveryClient';
import { getMeta } from '@/lib/meta';

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

  const initial: DeliveryInitial = {
    company: Number(first(sp.company)) || defaultCompany,
    open: first(sp.open) ?? null,
  };
  return <RmtDeliveryClient companies={companies} initial={initial} />;
}
