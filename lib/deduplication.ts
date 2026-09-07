import { createHash } from "node:crypto";

export const normalizeText = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const canonicalJobHash = (company: string, title: string, location: string) => hash([company, title, location].map(normalizeText).join("|"));
export const contentFingerprint = (description: string) => hash(normalizeText(description));
export function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean)); const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0; for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
