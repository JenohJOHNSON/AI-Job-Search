// Runs the multi-model scoring browser test: the production build and the worker talk to a local fake OpenRouter that the
// test itself starts, so no key is needed and nothing is billed.   npm run build && npm run e2e:scoring
import { spawnSync } from "node:child_process";
const env = { ...process.env, OPENROUTER_API_KEY: "e2e-fake-key", OPENROUTER_BASE_URL: "http://127.0.0.1:3199/api/v1", E2E_PORT: process.env.E2E_PORT ?? "3101" };
const result = spawnSync(process.execPath, ["scripts/with-services.mjs", "npx", "playwright", "test", "e2e/04-multi-model-scoring.spec.ts"], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
