import { readQuery } from '@/lib/sql';

/**
 * Anonymous liveness probe for IIS and uptime monitors, same contract as FastQuote's
 * /api/health. Pings SOFT1_ERP through the read-only path so a dead TELDB2 connection
 * shows up as 503 here instead of as a grid that never loads. Never leaks SQL error text.
 *
 * The pool's requestTimeout is 30 s, too slow for a probe, so the query is raced against
 * a 5 s timer: the probe answers promptly and the late query result is discarded.
 */
const PROBE = 'SELECT 1 AS ok';
const PROBE_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe exceeded ${ms} ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function GET() {
  const started = Date.now();
  const base = {
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  try {
    await withTimeout(readQuery(PROBE), PROBE_TIMEOUT_MS);
    return Response.json({
      ok: true,
      status: 'healthy',
      database: 'connected',
      responseTimeMs: Date.now() - started,
      ...base,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/health] probe failed', { message });
    return Response.json(
      {
        ok: false,
        status: 'unhealthy',
        database: 'error',
        responseTimeMs: Date.now() - started,
        ...base,
      },
      { status: 503 },
    );
  }
}
