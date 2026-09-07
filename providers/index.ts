import { AshbyProvider } from "@/providers/ashby";
import { FranceTravailProvider } from "@/providers/france-travail";
import { GenericProvider } from "@/providers/generic";
import { GreenhouseProvider } from "@/providers/greenhouse";
import { LeverProvider } from "@/providers/lever";
import type { JobProvider, ProviderConfig } from "@/providers/types";

export * from "@/providers/types";
export const providerCatalog = [
  { id: "france_travail", name: "France Travail", method: "OFFICIAL_API", supported: true, requiresConfiguration: true, description: "Official partner API; OAuth application credentials required." },
  { id: "greenhouse", name: "Greenhouse", method: "PUBLIC_ENDPOINT", supported: true, requiresConfiguration: true, description: "Public Job Board API; configure company board slugs." },
  { id: "lever", name: "Lever", method: "PUBLIC_ENDPOINT", supported: true, requiresConfiguration: true, description: "Public postings API; configure company site slugs." },
  { id: "ashby", name: "Ashby", method: "PUBLIC_ENDPOINT", supported: true, requiresConfiguration: true, description: "Public job board API; configure company board names." },
  { id: "generic", name: "Company career pages", method: "STATIC_HTML", supported: true, requiresConfiguration: true, description: "Explicitly allowlisted HTTPS pages with schema.org JobPosting data and robots permission." },
  ...["linkedin", "indeed", "hellowork", "jobijoba", "apec", "wttj", "cadremploi"].map(id => ({ id, name: ({ linkedin: "LinkedIn", indeed: "Indeed France", hellowork: "HelloWork", jobijoba: "Jobijoba", apec: "Apec", wttj: "Welcome to the Jungle", cadremploi: "Cadremploi" } as Record<string, string>)[id]!, method: "UNSUPPORTED", supported: false, requiresConfiguration: false, description: "Disabled: no permitted, reliable public integration is currently configured." }))
];

export function createProvider(id: string, config: ProviderConfig): JobProvider {
  if (id === "greenhouse") return new GreenhouseProvider(config);
  if (id === "lever") return new LeverProvider(config);
  if (id === "ashby") return new AshbyProvider(config);
  if (id === "france_travail") return new FranceTravailProvider();
  if (id === "generic") return new GenericProvider(config);
  throw new Error(`Provider ${id} is not supported.`);
}
