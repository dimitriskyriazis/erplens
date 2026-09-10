import { getMeta } from '@/lib/meta';

export async function GET() {
  try {
    const meta = await getMeta();
    return Response.json({ ok: true, ...meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/meta] failed', { message });
    const exposed = process.env.NODE_ENV === 'production' ? 'Database unavailable' : message;
    return Response.json({ ok: false, error: exposed }, { status: 503 });
  }
}
