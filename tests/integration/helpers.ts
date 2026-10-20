import { describe } from "vitest";
import { candidateProfileSchema, emptyCandidateProfile, searchProfileInputSchema } from "@/lib/schemas";
import { candidate, searchProfile } from "@/tests/fixtures/candidate";

// Integration tests need a disposable PostgreSQL database with migrations applied:
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/elan_test npm test
export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
export const describeDb = hasDatabase ? describe : describe.skip;

export async function database() { return (await import("@/lib/db")).db; }

/** Empties every application table (never the migration history). */
export async function resetDatabase() {
  const db = await database();
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map(table => `"${table.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** Creates the single owner with the synthetic candidate profile and one enabled search profile. */
export async function seedOwner(options: { searchProfile?: Record<string, unknown> | null; profile?: Record<string, unknown> } = {}) {
  const db = await database();
  const user = await db.user.create({ data: { email: "owner@example.test", passwordHash: "x", profile: { create: { data: (options.profile ? candidateProfileSchema.parse(options.profile) : candidate) ?? emptyCandidateProfile } } } });
  if (options.searchProfile !== null) { const data = searchProfileInputSchema.parse({ ...searchProfile, ...options.searchProfile }); await db.searchProfile.create({ data: { userId: user.id, name: data.name, enabled: data.enabled, data } }); }
  return user;
}
