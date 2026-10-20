import { describe, expect, it } from "vitest";
import { canonicalJobHash, cleanLocation, cleanTitle, contentFingerprint, tokenSimilarity } from "@/lib/deduplication";
describe("deduplication", () => {
  it("normalizes accents, casing, punctuation and title spacing", () => { expect(canonicalJobHash("Société Générale", "Senior Product Manager – AI", "Paris, FR")).toBe(canonicalJobHash("societe generale", "Senior Product Manager AI", "Paris FR")); });
  it("fingerprints normalized descriptions", () => { expect(contentFingerprint("Build AI products.\nRemote")).toBe(contentFingerprint("build  ai products remote")); });
  it("keeps meaningfully different jobs apart", () => { expect(tokenSimilarity("Product Manager Paris", "Data Engineer Lyon")).toBeLessThan(0.3); });
  it("ignores gender markers and département numbers that differ between sources", () => {
    expect(cleanTitle("Ingénieur Data (H/F)")).toBe("Ingénieur Data"); expect(cleanTitle("Data Engineer (m/f/d)")).toBe("Data Engineer"); expect(cleanTitle("Senior Data Engineer (x/f/m) - Paris")).toBe("Senior Data Engineer - Paris");
    expect(cleanLocation("METZ (57)")).toBe("METZ"); expect(cleanLocation("Nancy, France")).toBe("Nancy");
    expect(canonicalJobHash("Acme", "Data Engineer (H/F)", "Metz (57)")).toBe(canonicalJobHash("ACME", "Data Engineer", "Metz"));
  });
});
