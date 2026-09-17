import { z } from 'zod';
import { getAvailability } from '@/lib/rmt/availabilityQueries';

const querySchema = z.object({
  company: z.coerce.number().int().min(1).max(99).default(Number(process.env.ERPLENS_DEFAULT_COMPANY ?? 1)),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be yyyy-MM-dd'),
  weeks: z.coerce.number().int().min(1).max(26).default(2),
  team: z.coerce.number().int().min(0).default(0),
  /** UTBL01 code for SODTYPE 25 ('Telm', 'Ext', 'Gen'), '' = all. */
  type: z.string().regex(/^[A-Za-z0-9_-]{0,20}$/).default(''),
  specialty: z.coerce.number().int().min(0).default(0),
  history: z.enum(['0', '1']).default('1'),
});

/** Free and booked working days per resource per week over a window, with the bookings behind them. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;
  try {
    const data = await getAvailability({
      company: q.company,
      start: q.start,
      weeks: q.weeks,
      team: q.team,
      type: q.type,
      specialty: q.specialty,
      history: q.history === '1',
    });
    return Response.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/rmt/availability] failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Query failed' : message;
    return Response.json({ ok: false, error: exposed }, { status: 500 });
  }
}
