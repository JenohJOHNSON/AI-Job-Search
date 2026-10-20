// In-process fixed-window limiter. Adequate for the single web instance this app targets; replace with a shared store if scaled out.
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, maximum: number, windowMs: number) {
  const now = Date.now(); const existing = buckets.get(key);
  if (buckets.size > 5_000) for (const [name, bucket] of buckets) if (bucket.reset < now) buckets.delete(name);
  if (!existing || existing.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return true; }
  existing.count += 1;
  return existing.count <= maximum;
}
/** Best-effort client identity behind Railway's proxy. */
export const clientKey = (request: { headers: Headers }) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
