/** Today's calendar date in Europe/Paris, as a UTC-midnight Date suitable for @db.Date columns. */
export function parisDate(now = new Date()) {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${key}T00:00:00.000Z`);
}
