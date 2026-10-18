import { fold, groupsFor } from "@/matching/score";

// Proper-cased search phrases per role family, used for server-side searches (e.g. France Travail keywords).
const searchTerms: Record<string, string[]> = {
  "data-engineer": ["Data Engineer", "Ingénieur Data"],
  "etl-developer": ["Développeur ETL", "SSIS", "Talend"],
  "sql-developer": ["Développeur SQL Server"],
  "azure-data": ["Azure Data Engineer"],
  devops: ["DevOps", "Ingénieur DevOps"],
  "cpp-developer": ["Développeur C++", "C++ Developer"],
  "data-analyst": ["Data Analyst", "Analyste de données"],
  "business-analyst": ["Business Analyst", "Analyste métier"],
  "product-definition": ["Product Definition Analyst"]
};

/** The owner's own titles first, then bilingual synonyms of the same role family, de-duplicated and bounded. */
export function expandTitles(titles: string[], limit = 12): string[] {
  const output: string[] = []; const seen = new Set<string>();
  const add = (value: string) => { const key = fold(value); if (key && !seen.has(key)) { seen.add(key); output.push(value.trim()); } };
  for (const title of titles) add(title);
  for (const title of titles) for (const group of groupsFor(fold(title))) for (const term of searchTerms[group.id] ?? []) add(term);
  return output.slice(0, limit);
}
