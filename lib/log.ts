type Fields = Record<string, string | number | boolean | null | undefined>;
const redact = new Set(["password", "passwordHash", "token", "secret", "apiKey", "resume", "description"]);
export function log(level: "info" | "warn" | "error", message: string, fields: Fields = {}) {
  const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => !redact.has(key)));
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...safe });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.info(line);
}
