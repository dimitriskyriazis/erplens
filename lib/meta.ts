import { readQuerySets } from './sql';

export type Company = { id: number; name: string };

export type Meta = {
  server: string;
  database: string;
  login: string;
  companies: Company[];
  rmtTasks: Array<{ company: number; tasks: number; openTasks: number }>;
};

/**
 * Connection facts and the small lookups every page needs. One round trip, three
 * result sets. Used by the home page, the RMT pages and /api/meta.
 */
export async function getMeta(): Promise<Meta> {
  const sets = await readQuerySets(`
SELECT @@SERVERNAME AS server, DB_NAME() AS [database], SUSER_SNAME() AS [login];
SELECT COMPANY AS id, NAME AS name FROM dbo.COMPANY WHERE ISACTIVE = 1 ORDER BY COMPANY;
SELECT COMPANY AS company,
       COUNT(*) AS tasks,
       SUM(CASE WHEN finaldate >= CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS openTasks
FROM   dbo.PRJLINES
WHERE  SOPLTYPE = 11
GROUP  BY COMPANY
ORDER  BY COMPANY;`);

  const [info] = sets[0] ?? [];
  return {
    server: String(info?.server ?? ''),
    database: String(info?.database ?? ''),
    login: String(info?.login ?? ''),
    companies: (sets[1] ?? []).map((r) => ({ id: Number(r.id), name: String(r.name ?? '') })),
    rmtTasks: (sets[2] ?? []).map((r) => ({
      company: Number(r.company),
      tasks: Number(r.tasks),
      openTasks: Number(r.openTasks),
    })),
  };
}
