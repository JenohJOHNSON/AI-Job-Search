import { NextResponse } from "next/server";
import { requireUser, routeError } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { parisDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { jobInclude, serializeJob } from "@/lib/services/jobs";
import { providerView } from "@/lib/services/providers";
import { loadSettings } from "@/lib/services/settings";
import { labelFor } from "@/matching/score";

const submitted = ["APPLIED", "RECRUITER_CONTACT", "INTERVIEW", "TECHNICAL_INTERVIEW", "FINAL_INTERVIEW", "OFFER"] as const;
const interviewStages = ["INTERVIEW", "TECHNICAL_INTERVIEW", "FINAL_INTERVIEW"] as const;
const open = { status: "ACTIVE" as const, dismissedAt: null };

export async function GET() {
  try {
    const user = await requireUser(); const settings = await loadSettings(); const now = new Date(); const dayAgo = new Date(now.getTime() - 86_400_000); const today = parisDate();
    const [total, newJobs, highMatches, saved, submittedCount, interviewApps, followUps, failuresToday, topJobs, recentJobs, providers, recentRuns, usage, lastRun] = await Promise.all([
      db.job.count({ where: open }),
      db.job.count({ where: { ...open, discoveredAt: { gte: dayAgo } } }),
      db.job.count({ where: { ...open, rankScore: { gte: settings.notifications.minScore } } }),
      db.application.count({ where: { userId: user.id, status: { in: ["SAVED", "APPLY"] } } }),
      db.application.count({ where: { userId: user.id, status: { in: [...submitted] } } }),
      db.application.findMany({ where: { userId: user.id, status: { notIn: ["ARCHIVED", "REJECTED", "WITHDRAWN"] } }, include: { job: { select: { id: true, title: true, companyName: true } } } }),
      db.application.findMany({ where: { userId: user.id, nextActionDate: { not: null, lte: new Date(now.getTime() + 7 * 86_400_000) }, status: { notIn: ["ARCHIVED", "REJECTED", "WITHDRAWN"] } }, include: { job: { select: { id: true, title: true, companyName: true } } }, orderBy: { nextActionDate: "asc" }, take: 5 }),
      db.providerRun.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
      db.job.findMany({ where: { ...open, rankScore: { not: null } }, include: jobInclude, orderBy: { rankScore: "desc" }, take: 5 }),
      db.job.findMany({ where: open, include: jobInclude, orderBy: { discoveredAt: "desc" }, take: 6 }),
      providerView(),
      db.searchRun.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      db.aIUsage.aggregate({ where: { calendarDate: today, status: "COMPLETED" }, _count: true, _sum: { estimatedCost: true } }),
      db.searchRun.findFirst({ where: { status: "FINISHED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } })
    ]);
    const upcomingInterviews = interviewApps.flatMap(application => (Array.isArray(application.interviewDates) ? application.interviewDates : []).filter((value): value is string => typeof value === "string" && new Date(value) >= now).map(date => ({ date, applicationId: application.id, jobId: application.job.id, title: application.job.title, companyName: application.job.companyName, stage: application.status })))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    const withLabel = <T extends { rankScore: number | null }>(job: T) => ({ ...job, matchLabel: job.rankScore === null ? null : labelFor(job.rankScore) });
    return NextResponse.json({
      stats: { total, newJobs, highMatches, saved, submitted: submittedCount, interviewing: interviewApps.filter(item => (interviewStages as readonly string[]).includes(item.status)).length, upcomingInterviews: upcomingInterviews.length, activeProviders: providers.filter(provider => provider.enabled).length, failures: failuresToday, lastSearchAt: lastRun?.completedAt ?? null },
      topJobs: topJobs.map(job => withLabel(serializeJob(job))), recentJobs: recentJobs.map(job => withLabel(serializeJob(job))), providers, recentRuns, upcomingInterviews, followUps: followUps.map(item => ({ applicationId: item.id, jobId: item.job.id, title: item.job.title, companyName: item.job.companyName, nextAction: item.nextAction, nextActionDate: item.nextActionDate })),
      usage: { analyses: usage._count, cost: Number(usage._sum.estimatedCost ?? 0), maxAnalyses: settings.ai.maxAnalysesPerDay, maxCost: settings.ai.maxCostPerDay, configured: aiConfigured() },
      threshold: settings.notifications.minScore
    });
  } catch (error) { return routeError(error); }
}
