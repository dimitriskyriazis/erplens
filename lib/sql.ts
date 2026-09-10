/**
 * Connection to the live Soft1 ERP database (SOFT1_ERP on TELDB2).
 *
 * TelERP is READ-ONLY against this database. That is a hard rule, not a convention:
 * every statement goes through readQuery(), which refuses anything that is not a
 * SELECT. Schema work (tlm views/procs) is delivered as scripts under scripts/sql and
 * run by a person, never by the app.
 */
import sql from 'mssql';
import type { ConnectionPool, config as SqlConfig } from 'mssql';

export type QueryParam = { key: string; value: string | number | boolean | Date | null };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function buildErpConfig(): SqlConfig {
  return {
    server: requiredEnv('SOFT1_ERP_HOST'),
    port: Number(process.env.SOFT1_ERP_PORT ?? 1433),
    database: requiredEnv('SOFT1_ERP_DB'),
    user: requiredEnv('SOFT1_ERP_USER'),
    password: requiredEnv('SOFT1_ERP_PASSWORD'),
    options: {
      encrypt: process.env.SOFT1_ERP_ENCRYPT === 'true',
      trustServerCertificate: process.env.SOFT1_ERP_TRUST_CERT === 'true',
      requestTimeout: Number(process.env.SOFT1_ERP_REQUEST_TIMEOUT ?? 30000),
      appName: 'TelERP',
      // ApplicationIntent=ReadOnly. Ignored by a standalone instance; routes to a
      // readable secondary if the ERP ever moves into an availability group.
      readOnlyIntent: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

// Cached on globalThis so `next dev` hot reloads reuse the pool instead of opening a
// new one per module instance.
declare global {
  var __TELERP_ERP_POOL__: Promise<ConnectionPool> | undefined;
}

export async function getErpPool(): Promise<ConnectionPool> {
  if (!globalThis.__TELERP_ERP_POOL__) {
    const config = buildErpConfig();
    globalThis.__TELERP_ERP_POOL__ = new sql.ConnectionPool(config)
      .connect()
      .catch((err: unknown) => {
        globalThis.__TELERP_ERP_POOL__ = undefined;
        throw err;
      });
  }
  const pool = await globalThis.__TELERP_ERP_POOL__;
  if (!pool.connected) {
    globalThis.__TELERP_ERP_POOL__ = undefined;
    return getErpPool();
  }
  return pool;
}

const WRITE_OR_DDL =
  /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BULK|BACKUP|RESTORE|DBCC|OPENROWSET|OPENQUERY|OPENDATASOURCE|INTO|WRITETEXT|UPDATETEXT|KILL|SHUTDOWN|RECONFIGURE|ENABLE|DISABLE|SP_\w*|XP_\w*)\b/i;

/**
 * Throws unless `text` is a plain read: a SELECT or WITH ... SELECT with no write,
 * DDL, or procedure call anywhere in it. Comments are stripped first so a keyword
 * hidden in one cannot slip through. A keyword inside a string literal still fails
 * closed: better a false rejection than a write.
 */
export function assertReadOnlySql(text: string): void {
  const stripped = text.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (!/^\s*(SELECT|WITH)\b/i.test(stripped)) {
    throw new Error('Refused: SOFT1_ERP statements must start with SELECT or WITH');
  }
  const hit = stripped.match(WRITE_OR_DDL);
  if (hit) {
    throw new Error(`Refused: SOFT1_ERP is read-only for TelERP (found ${hit[1].toUpperCase()})`);
  }
}

/** Runs a parameterised read against SOFT1_ERP and returns the first result set. */
export async function readQuery<T = Record<string, unknown>>(
  text: string,
  params: QueryParam[] = [],
): Promise<T[]> {
  assertReadOnlySql(text);
  const pool = await getErpPool();
  const request = pool.request();
  for (const p of params) request.input(p.key, p.value);
  const result = await request.query<T>(text);
  return result.recordset ?? [];
}

/** Like readQuery but returns every result set: one round trip for several SELECTs. */
export async function readQuerySets(
  text: string,
  params: QueryParam[] = [],
): Promise<Record<string, unknown>[][]> {
  assertReadOnlySql(text);
  const pool = await getErpPool();
  const request = pool.request();
  for (const p of params) request.input(p.key, p.value);
  const result = await request.query(text);
  return (result.recordsets as unknown as Record<string, unknown>[][]) ?? [];
}
