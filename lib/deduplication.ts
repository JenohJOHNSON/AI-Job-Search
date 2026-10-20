import { createHash } from "node:crypto";

export const normalizeText = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
/** Drops gender markers such as "(H/F)", "(F/H)", "(m/f/d)" and "(x/f/m)" that vary between sources for the same vacancy. */
export const cleanTitle = (title: string) => title.replace(/\(\s*[hfmxwd](?:\s*[/|*]\s*[hfmxwd])+\s*\)|\b[hf]\s*\/\s*[hf]\b/gi, " ").replace(/\s+/g, " ").trim();
/** Drops département numbers and country suffixes: "METZ (57)", "Metz, France" and "Metz" are the same place. */
export const cleanLocation = (location: string) => location.replace(/\(\s*\d{2,3}\s*\)|\b\d{5}\b/g, " ").replace(/,?\s*\bfrance\b/gi, " ").replace(/\s+/g, " ").trim();
export const canonicalJobHash = (company: string, title: string, location: string) => hash([company, cleanTitle(title), cleanLocation(location)].map(normalizeText).join("|"));
export const contentFingerprint = (description: string) => hash(normalizeText(description));
export function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean)); const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0; for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
