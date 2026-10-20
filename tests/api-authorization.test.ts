import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static regression guard: every API route handler must authenticate (requireUser) unless it is explicitly public,
// and every state-changing handler must check the request origin.
const root = path.resolve(__dirname, "..", "app", "api");
const routes: string[] = [];
(function walk(dir: string) { for (const entry of readdirSync(dir)) { const full = path.join(dir, entry); if (statSync(full).isDirectory()) walk(full); else if (entry === "route.ts") routes.push(full); } })(root);
const relative = (file: string) => path.relative(root, file).replace(/\\/g, "/");

// Public by design: liveness probe, session probe/login/setup/logout (own checks), and the bearer-secret runner endpoint.
const publicRoutes = new Set(["health/route.ts", "auth/session/route.ts", "auth/login/route.ts", "auth/setup/route.ts", "auth/logout/route.ts", "internal/jobs/run/route.ts"]);

describe("API authorization", () => {
  it("discovers the routes", () => { expect(routes.length).toBeGreaterThan(25); });
  it.each(routes.map(file => [relative(file), readFileSync(file, "utf8")] as const))("%s requires an authenticated owner", (name, source) => {
    if (publicRoutes.has(name)) return;
    expect(source, `${name} must call requireUser()`).toContain("requireUser()");
  });
  it.each(routes.map(file => [relative(file), readFileSync(file, "utf8")] as const))("%s checks the origin of state-changing requests", (name, source) => {
    if (!/export async function (POST|PUT|PATCH|DELETE)/.test(source) || name === "internal/jobs/run/route.ts") return;
    expect(source, `${name} must call assertSameOrigin()`).toContain("assertSameOrigin(");
  });
  it("authenticates the runner endpoint with a constant-time secret comparison", () => {
    const source = readFileSync(path.join(root, "internal/jobs/run/route.ts"), "utf8"); expect(source).toContain("timingSafeEqual"); expect(source).toContain("JOB_RUNNER_SECRET");
  });
});
