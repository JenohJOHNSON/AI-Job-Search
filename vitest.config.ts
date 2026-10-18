import { defineConfig } from "vitest/config";
import path from "node:path";
// Integration tests share one PostgreSQL database, so test files run one at a time.
export default defineConfig({ test: { environment: "node", setupFiles: ["tests/setup.ts"], fileParallelism: false, testTimeout: 30_000, coverage: { reporter: ["text"] } }, resolve: { alias: { "@": path.resolve(__dirname) } } });
