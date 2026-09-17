import { z } from 'zod';
import { getDelivery } from '@/lib/rmt/deliveryQueries';

const querySchema = z.object({
  company: z.coerce.number().int().min(1).max(99).default(Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1)),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

/** Planned person-days against logged hours, per project and per task. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;
  try {
    const data = await getDelivery(q.company, q.limit);
    return Response.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/rmt/delivery] failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Query failed' : message;
    return Response.json({ ok: false, error: exposed }, { status: 500 });
  }
}
