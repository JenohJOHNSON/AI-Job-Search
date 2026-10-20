// Starts the production web server and the background worker, waits until /api/health is ok, runs the given command
// with BASE_URL pointing at it, and always stops both processes.
//   npm run build && node scripts/with-services.mjs npx playwright test
//   npm run build && node scripts/with-services.mjs node scripts/smoke.mjs
// The database must be migrated; the owner-setup steps expect it to be empty.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const require = createRequire(import.meta.url);
const port = process.env.E2E_PORT ?? "3100";
const base = `http://localhost:${port}`;
const env = { ...process.env, PORT: port, APP_URL: base, BASE_URL: base, NODE_ENV: "production" };

// Node is launched directly (no npx/shell wrapper) so that stopping a child really stops the server.
const web = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", port], { env, stdio: "inherit" });
const worker = spawn(process.execPath, [require.resolve("tsx/cli"), "workers/main.ts"], { env, stdio: "inherit" });
let stopped = false;
function stop() {
  if (stopped) return; stopped = true;
  for (const child of [web, worker]) { if (child.exitCode !== null || !child.pid) continue; if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else child.kill("SIGTERM"); }
}
process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("exit", stop);
web.on("exit", code => { if (!stopped) { console.error(`The web service exited unexpectedly (${code}).`); stop(); process.exit(1); } });

let healthy = false;
for (let attempt = 0; attempt < 60 && !healthy; attempt++) {
  try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* not up yet */ }
  if (!healthy) await new Promise(resolve => setTimeout(resolve, 1_000));
}
if (!healthy) { console.error("The web service did not become healthy."); stop(); process.exit(1); }

const [command, ...args] = process.argv.slice(2);
if (!command) { console.error("Usage: node scripts/with-services.mjs <command> [args]"); stop(); process.exit(2); }
const child = spawn(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
const code = await new Promise(resolve => child.on("exit", resolve));
stop(); process.exit(code ?? 1);
