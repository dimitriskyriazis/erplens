import { z } from 'zod';
import { getProjectTimeline } from '@/lib/rmt/timelineQueries';

const querySchema = z.object({
  company: z.coerce.number().int().min(1).max(99).default(Number(process.env.TELERP_DEFAULT_COMPANY ?? 1)),
  prjc: z.coerce.number().int().min(1),
});

/** Tasks, planned/estimate actions and done actions for one project. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const timeline = await getProjectTimeline(parsed.data.company, parsed.data.prjc);
    return Response.json({ ok: true, ...timeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/rmt/timeline] failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Query failed' : message;
    return Response.json({ ok: false, error: exposed }, { status: 500 });
  }
}
