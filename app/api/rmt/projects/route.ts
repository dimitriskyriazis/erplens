import { z } from 'zod';
import { searchRmtProjects } from '@/lib/rmt/timelineQueries';

const querySchema = z.object({
  company: z.coerce.number().int().min(1).max(99).default(Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1)),
  q: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Projects that carry RMT tasks, for the project picker. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const projects = await searchRmtProjects(parsed.data.company, parsed.data.q, parsed.data.limit);
    return Response.json({ ok: true, projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/rmt/projects] failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Query failed' : message;
    return Response.json({ ok: false, error: exposed }, { status: 500 });
  }
}
