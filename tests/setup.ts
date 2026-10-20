// Deterministic, offline-safe environment for unit tests. Integration tests override DATABASE_URL with TEST_DATABASE_URL.
const defaults: Record<string, string> = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/elan_test",
  APP_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "01234567890123456789012345678901",
  SETUP_SECRET: "0123456789012345",
  JOB_RUNNER_SECRET: "012345678901234567890123",
  FRANCE_TRAVAIL_CLIENT_ID: "test-client",
  FRANCE_TRAVAIL_CLIENT_SECRET: "test-secret"
};
for (const [key, value] of Object.entries(defaults)) if (!process.env[key]) process.env[key] = value;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
