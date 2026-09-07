import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { analysisSchema } from "@/lib/schemas";
describe("security and AI validation", () => {
  it("stores password derivations with random salts", async () => { const first = await hashPassword("a sufficiently long password"); const second = await hashPassword("a sufficiently long password"); expect(first).not.toBe(second); expect(await verifyPassword("a sufficiently long password", first)).toBe(true); expect(await verifyPassword("wrong", first)).toBe(false); });
  it("rejects malformed AI output", () => { expect(() => analysisSchema.parse({ overallMatchScore: 150 })).toThrow(); });
});
