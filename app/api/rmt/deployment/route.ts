import { z } from 'zod';
import { getDeployment } from '@/lib/rmt/deploymentQueries';

const querySchema = z.object({
  company: z.coerce.number().int().min(1).max(99).default(Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1)),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be yyyy-MM-dd'),
  weeks: z.coerce.number().int().min(1).max(26).default(8),
  team: z.coerce.number().int().min(0).default(0),
  /** UTBL01 code for SODTYPE 25 ('Telm', 'Ext'), '' = all. */
  type: z.string().regex(/^[A-Za-z0-9_-]{0,20}$/).default(''),
  specialty: z.coerce.number().int().min(0).default(0),
});

/** Which project and location holds each named resource in each week of a window. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;
  try {
    const data = await getDeployment({
      company: q.company,
      start: q.start,
      weeks: q.weeks,
      team: q.team,
      type: q.type,
      specialty: q.specialty,
    });
    return Response.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/rmt/deployment] failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Query failed' : message;
    return Response.json({ ok: false, error: exposed }, { status: 500 });
  }
}
