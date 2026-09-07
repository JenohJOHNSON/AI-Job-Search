import { describe, expect, it } from "vitest";
import { canonicalJobHash, contentFingerprint, tokenSimilarity } from "@/lib/deduplication";
describe("deduplication", () => {
  it("normalizes accents, casing, punctuation and title spacing", () => { expect(canonicalJobHash("Société Générale", "Senior Product Manager – AI", "Paris, FR")).toBe(canonicalJobHash("societe generale", "Senior Product Manager AI", "Paris FR")); });
  it("fingerprints normalized descriptions", () => { expect(contentFingerprint("Build AI products.\nRemote")).toBe(contentFingerprint("build  ai products remote")); });
  it("keeps meaningfully different jobs apart", () => { expect(tokenSimilarity("Product Manager Paris", "Data Engineer Lyon")).toBeLessThan(0.3); });
});
