const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, maximum: number, windowMs: number) {
  const now = Date.now(); const existing = buckets.get(key);
  if (!existing || existing.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return true; }
  existing.count += 1;
  return existing.count <= maximum;
}
