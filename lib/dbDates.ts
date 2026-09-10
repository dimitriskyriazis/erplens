/**
 * Soft1 stores wall-clock datetimes (a task from 09:00 to 17:00). The tedious driver
 * reads them as UTC by default, so the stored hour lands in the Date's UTC fields.
 * Formatting through the UTC getters therefore reproduces exactly what the database
 * holds, independent of server or browser time zone. Never use toISOString() or the
 * local getters on these values.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** 'yyyy-MM-dd HH:mm' as stored, or null. */
export function formatDbDateTime(value: unknown): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

/** 'yyyy-MM-dd' as stored, or null. */
export function formatDbDate(value: unknown): string | null {
  const full = formatDbDateTime(value);
  return full ? full.slice(0, 10) : null;
}
