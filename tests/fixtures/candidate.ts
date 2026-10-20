import { candidateProfileSchema, normalizedJobSchema, searchProfileInputSchema } from "@/lib/schemas";

// Synthetic test data only: not a real person and not a production vacancy.
export const candidate = candidateProfileSchema.parse({
  preferredName: "Test Candidate", location: "Metz", workAuthorization: "EU citizen", languages: ["French (native)", "English (professional)"],
  currentTitle: "Data Engineer", yearsExperience: 5,
  targetRoles: ["Data Engineer", "Ingénieur Data", "Développeur ETL", "Azure Data Engineer"], secondaryRoles: ["DevOps Engineer", "Data Analyst", "Business Analyst"],
  coreSkills: ["SQL Server", "SSIS", "Python", "Azure Data Factory"], secondarySkills: ["Docker", "Power BI", "C++"], tools: ["Git", "Azure DevOps"], technologies: ["Azure", "Databricks"],
  locations: ["Metz", "Nancy", "Luxembourg", "Grand Est", "Remote France", "Remote Europe"], maxCommuteKm: 80, remote: true, hybrid: true, onsite: true,
  contractTypes: ["CDI"], minimumSalary: 38_000
});
export const searchProfile = searchProfileInputSchema.parse({ name: "Data roles", targetTitles: ["Data Engineer", "Ingénieur Data"], alternativeTitles: ["Développeur ETL"], keywords: ["SQL", "Python"], locations: ["Metz", "Nancy"], minimumMatchScore: 40 });

let counter = 0;
export function job(overrides: Record<string, unknown>) {
  counter++;
  return normalizedJobSchema.parse({ source: "fixture", sourceJobId: `fx-${counter}`, sourceUrl: `https://jobs.example.test/${counter}`, companyName: "Exemple SA", title: "Ingénieur Data (H/F)", location: "Metz", extractor: "fixture", descriptionClean: "", ...overrides });
}
export const strongDescription = "Vous rejoindrez l'équipe Data pour concevoir et maintenir des pipelines ETL. Compétences requises : SQL Server, SSIS, Python, Azure Data Factory. Au moins 3 ans d'expérience. Poste en CDI, télétravail partiel possible 2 jours par semaine. Nice to have : Power BI.";
