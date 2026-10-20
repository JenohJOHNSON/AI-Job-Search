import type { Prisma } from "@prisma/client";
import { applicationStatusSchema } from "@/lib/schemas";

export const number = (value: string | null) => { if (value === null || value.trim() === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const views = new Set(["active", "saved", "dismissed", "closed", "all"]);

export function buildJobFilter(query: URLSearchParams): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = []; const text = query.get("q")?.trim(); const view = views.has(query.get("view") ?? "") ? query.get("view")! : "active";
  if (view === "active") and.push({ status: "ACTIVE", dismissedAt: null });
  if (view === "saved") and.push({ application: { is: { status: { notIn: ["ARCHIVED", "WITHDRAWN", "REJECTED"] } } } });
  if (view === "dismissed") and.push({ dismissedAt: { not: null } });
  if (view === "closed") and.push({ status: { in: ["EXPIRED", "REMOVED"] } });
  if (text) and.push({ OR: [{ title: { contains: text, mode: "insensitive" } }, { companyName: { contains: text, mode: "insensitive" } }, { descriptionClean: { contains: text, mode: "insensitive" } }] });
  const score = number(query.get("score")); if (score !== null) and.push({ rankScore: { gte: score } });
  if (query.get("provider")) and.push({ sources: { some: { provider: query.get("provider")!, removedAt: null } } });
  if (query.get("company")) and.push({ companyName: { contains: query.get("company")!, mode: "insensitive" } });
  if (query.get("location")) and.push({ location: { contains: query.get("location")!, mode: "insensitive" } });
  if (["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"].includes(query.get("remoteType") ?? "")) and.push({ remoteType: query.get("remoteType")! });
  const salary = number(query.get("salaryMin")); if (salary !== null) and.push({ OR: [{ salaryMax: { gte: salary } }, { salaryMin: { gte: salary } }] });
  if (query.get("contractType")) and.push({ contractType: { contains: query.get("contractType")!, mode: "insensitive" } });
  const status = applicationStatusSchema.safeParse(query.get("status")); if (status.success) and.push({ application: { is: { status: status.data } } });
  const published = number(query.get("publishedDays")); if (published !== null) and.push({ publishedAt: { gte: daysAgo(published) } });
  const discovered = number(query.get("discoveredDays")); if (discovered !== null) and.push({ discoveredAt: { gte: daysAgo(discovered) } });
  return and.length ? { AND: and } : {};
}
export const orderings: Record<string, Prisma.JobOrderByWithRelationInput[]> = {
  score: [{ rankScore: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }], newest: [{ discoveredAt: "desc" }], published: [{ publishedAt: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
  freshness: [{ lastSeenAt: "desc" }, { discoveredAt: "desc" }], salary: [{ salaryMax: { sort: "desc", nulls: "last" } }], company: [{ companyName: "asc" }, { title: "asc" }]
};

