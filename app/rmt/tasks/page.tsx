import RmtTasksClient from './RmtTasksClient';
import { getMeta } from '@/lib/meta';

// Reads the live ERP on every request; never prerender at build time.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const meta = await getMeta().catch(() => null);
  const companies = meta?.companies?.length
    ? meta.companies
    : [
        { id: 1, name: 'Company 1' },
        { id: 2, name: 'Company 2' },
      ];
  const defaultCompany = Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1);
  return <RmtTasksClient companies={companies} defaultCompany={defaultCompany} />;
}
