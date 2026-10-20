import { ApifyPortalProvider } from "@/providers/apify";
import { AshbyProvider } from "@/providers/ashby";
import { EmailAlertsProvider } from "@/providers/email-alerts";
import { FranceTravailProvider } from "@/providers/france-travail";
import { GenericProvider } from "@/providers/generic";
import { GreenhouseProvider } from "@/providers/greenhouse";
import { LeverProvider } from "@/providers/lever";
import { portals, type PortalId } from "@/providers/portals";
import type { JobProvider, ProviderConfig } from "@/providers/types";

export * from "@/providers/types";
export type CatalogEntry = { id: string; name: string; method: string; supported: boolean; requiresConfiguration: boolean; description: string; costPerJobUsd?: number };
const isPortal = (id: string): id is PortalId => Object.hasOwn(portals, id);

export const providerCatalog: CatalogEntry[] = [
  { id: "france_travail", name: "France Travail", method: "OFFICIAL_API", supported: true, requiresConfiguration: true, description: "Official partner API; OAuth application credentials required." },
  { id: "greenhouse", name: "Greenhouse", method: "PUBLIC_ENDPOINT", supported: true, requiresConfiguration: true, description: "Public Job Board API; configure company board slugs." },
  { id: "lever", name: "Lever", method: "PUBLIC_ENDPOINT", supported: true, requiresConfiguration: true, description: "Public postings API; configure company site slugs." },
  { id: "ashby", name: "Ashby", method: "PUBLIC_ENDPOINT", supported: true, requiresConfiguration: true, description: "Public job board API; configure company board names." },
  { id: "generic", name: "Company career pages", method: "STATIC_HTML", supported: true, requiresConfiguration: true, description: "Explicitly allowlisted HTTPS pages with schema.org JobPosting data and robots permission." },
  { id: "email_alerts", name: "Job-alert emails", method: "EMAIL_ALERTS", supported: true, requiresConfiguration: true, description: "Reads, read-only, the job alerts LinkedIn, Indeed, HelloWork and Welcome to the Jungle send to your mailbox and imports every listed posting. Free and within the portals' terms; alerts carry title, employer and place, not the full description." },
  ...Object.values(portals).map(portal => ({ id: portal.id, name: portal.name, method: "APIFY", supported: true, requiresConfiguration: true, costPerJobUsd: portal.usdPerItem, description: `Opt-in third-party scraping through the Apify actor ${portal.actor}, billed to your Apify account (about $${portal.usdPerItem} per job). ${portal.name}'s terms forbid automated collection, so enabling it is your decision and your risk.` })),
  ...["jobijoba", "apec", "cadremploi"].map(id => ({ id, name: ({ jobijoba: "Jobijoba", apec: "Apec", cadremploi: "Cadremploi" } as Record<string, string>)[id]!, method: "UNSUPPORTED", supported: false, requiresConfiguration: false, description: "Disabled: no permitted, reliable public integration is currently configured." }))
];

export function createProvider(id: string, config: ProviderConfig): JobProvider {
  if (id === "greenhouse") return new GreenhouseProvider(config);
  if (id === "lever") return new LeverProvider(config);
  if (id === "ashby") return new AshbyProvider(config);
  if (id === "france_travail") return new FranceTravailProvider();
  if (id === "generic") return new GenericProvider(config);
  if (id === "email_alerts") return new EmailAlertsProvider();
  if (isPortal(id)) return new ApifyPortalProvider(portals[id]);
  throw new Error(`Provider ${id} is not supported.`);
}
