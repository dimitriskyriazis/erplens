import { z } from 'zod';

/**
 * Body the ServerSideGrid component posts. Built explicitly on the client (not the raw
 * AG Grid request), so it can be strict here.
 */
export const gridRequestSchema = z.strictObject({
  startRow: z.number().int().min(0).default(0),
  endRow: z.number().int().min(1).max(1_000_000).default(100),
  filterModel: z.record(z.string().max(128), z.unknown()).nullable().optional(),
  sortModel: z
    .array(z.strictObject({ colId: z.string().max(128), sort: z.enum(['asc', 'desc']) }))
    .max(20)
    .optional(),
  quickFilterText: z.string().max(200).nullable().optional(),
  company: z.number().int().min(1).max(99).optional(),
});

export type GridRequest = z.infer<typeof gridRequestSchema>;

export async function readGridRequest(
  req: Request,
): Promise<{ ok: true; request: GridRequest } | { ok: false; response: Response }> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: Response.json({ ok: false, error: 'Body must be JSON' }, { status: 400 }) };
  }
  const inner =
    body && typeof body === 'object' && 'request' in body ? (body as { request: unknown }).request : body;
  const parsed = gridRequestSchema.safeParse(inner);
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: 'Invalid grid request', issues: parsed.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, request: parsed.data };
}

/** Page size clamp shared by every grid endpoint. */
export function pageWindow(request: GridRequest, maxRows = 1000): { offset: number; limit: number } {
  const offset = request.startRow;
  const limit = Math.max(1, Math.min(maxRows, request.endRow - request.startRow));
  return { offset, limit };
}
