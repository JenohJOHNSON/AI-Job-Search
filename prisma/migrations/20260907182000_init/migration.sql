-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'REVIEWED', 'SAVED', 'APPLY', 'APPLIED', 'RECRUITER_CONTACT', 'INTERVIEW', 'TECHNICAL_INTERVIEW', 'FINAL_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'FINISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'GITHUB_ACTION', 'SCHEDULED', 'API');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('STRONG_APPLY', 'APPLY', 'MAYBE', 'SKIP');

-- CreateEnum
CREATE TYPE "ErrorCode" AS ENUM ('RATE_LIMIT', 'TIMEOUT', 'PARSER_CHANGED', 'BLOCKED', 'AUTH', 'NETWORK', 'AI_PROVIDER', 'DATABASE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "suggestions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "searchProfileId" TEXT NOT NULL,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "logo" TEXT,
    "metadata" JSONB,
    "enrichedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyDomain" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "remoteType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "contractType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "employmentType" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "descriptionRaw" TEXT NOT NULL,
    "descriptionClean" TEXT NOT NULL,
    "responsibilities" JSONB NOT NULL DEFAULT '[]',
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "preferredRequirements" JSONB NOT NULL DEFAULT '[]',
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "experienceMin" INTEGER,
    "experienceMax" INTEGER,
    "education" TEXT,
    "skillsRequired" JSONB NOT NULL DEFAULT '[]',
    "skillsPreferred" JSONB NOT NULL DEFAULT '[]',
    "languagesRequired" JSONB NOT NULL DEFAULT '[]',
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "recruiterName" TEXT,
    "recruiterUrl" TEXT,
    "applicationUrl" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "preliminaryScore" INTEGER,
    "matchScore" INTEGER,
    "companyId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPostingSource" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "extractor" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceMetadata" JSONB,
    "rawPayload" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "JobPostingSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAnalysis" (
    "id" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "JobAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "appliedAt" TIMESTAMP(3),
    "notes" TEXT,
    "salaryDiscussed" INTEGER,
    "contact" TEXT,
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "interviewDates" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationHistory" (
    "id" TEXT NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "ApplicationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "RunTrigger" NOT NULL,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providersAttempted" INTEGER NOT NULL DEFAULT 0,
    "providersSuccessful" INTEGER NOT NULL DEFAULT 0,
    "providersFailed" INTEGER NOT NULL DEFAULT 0,
    "jobsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "jobsNew" INTEGER NOT NULL DEFAULT 0,
    "jobsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "jobsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "jobsHighMatch" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSetting" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "supported" BOOLEAN NOT NULL DEFAULT false,
    "maxJobs" INTEGER NOT NULL DEFAULT 50,
    "rateLimitMs" INTEGER NOT NULL DEFAULT 500,
    "strategies" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderHealth" (
    "id" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'DISABLED',
    "message" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "jobsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "extractionStats" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "providerId" TEXT NOT NULL,

    CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRun" (
    "id" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL,
    "jobsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "jobsValid" INTEGER NOT NULL DEFAULT 0,
    "jobsInvalid" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "errorCode" "ErrorCode",
    "errorMessage" TEXT,
    "extractorStats" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,

    CONSTRAINT "ProviderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leasedUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "searchRunId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "calendarDate" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,6) NOT NULL,
    "reservedCost" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "calendarDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile"("userId");

-- CreateIndex
CREATE INDEX "Resume_userId_createdAt_idx" ON "Resume"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchProfile_userId_enabled_idx" ON "SearchProfile"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SearchQuery_searchProfileId_fingerprint_key" ON "SearchQuery"("searchProfileId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalizedName_key" ON "Company"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Job_canonicalHash_key" ON "Job"("canonicalHash");

-- CreateIndex
CREATE INDEX "Job_publishedAt_idx" ON "Job"("publishedAt");

-- CreateIndex
CREATE INDEX "Job_discoveredAt_idx" ON "Job"("discoveredAt");

-- CreateIndex
CREATE INDEX "Job_matchScore_idx" ON "Job"("matchScore");

-- CreateIndex
CREATE INDEX "Job_companyName_idx" ON "Job"("companyName");

-- CreateIndex
CREATE INDEX "Job_normalizedTitle_idx" ON "Job"("normalizedTitle");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_contentFingerprint_idx" ON "Job"("contentFingerprint");

-- CreateIndex
CREATE INDEX "JobPostingSource_provider_idx" ON "JobPostingSource"("provider");

-- CreateIndex
CREATE INDEX "JobPostingSource_jobId_idx" ON "JobPostingSource"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPostingSource_provider_sourceJobId_key" ON "JobPostingSource"("provider", "sourceJobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPostingSource_sourceUrl_key" ON "JobPostingSource"("sourceUrl");

-- CreateIndex
CREATE INDEX "JobAnalysis_score_idx" ON "JobAnalysis"("score");

-- CreateIndex
CREATE UNIQUE INDEX "JobAnalysis_jobId_profileVersion_contentFingerprint_key" ON "JobAnalysis"("jobId", "profileVersion", "contentFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_key" ON "Application"("jobId");

-- CreateIndex
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");

-- CreateIndex
CREATE INDEX "ApplicationHistory_applicationId_createdAt_idx" ON "ApplicationHistory"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchRun_idempotencyKey_key" ON "SearchRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SearchRun_createdAt_idx" ON "SearchRun"("createdAt");

-- CreateIndex
CREATE INDEX "SearchRun_status_idx" ON "SearchRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderHealth_providerId_key" ON "ProviderHealth"("providerId");

-- CreateIndex
CREATE INDEX "ProviderRun_runId_idx" ON "ProviderRun"("runId");

-- CreateIndex
CREATE INDEX "ProviderRun_providerId_createdAt_idx" ON "ProviderRun"("providerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_idempotencyKey_key" ON "Task"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Task_status_runAt_idx" ON "Task"("status", "runAt");

-- CreateIndex
CREATE INDEX "Task_leasedUntil_idx" ON "Task"("leasedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AIUsage_reservationId_key" ON "AIUsage"("reservationId");

-- CreateIndex
CREATE INDEX "AIUsage_calendarDate_status_idx" ON "AIUsage"("calendarDate", "status");

-- CreateIndex
CREATE INDEX "GeneratedDocument_userId_jobId_idx" ON "GeneratedDocument"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_channel_recipientHash_calendarDate_key" ON "Notification"("channel", "recipientHash", "calendarDate");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchProfile" ADD CONSTRAINT "SearchProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_searchProfileId_fkey" FOREIGN KEY ("searchProfileId") REFERENCES "SearchProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostingSource" ADD CONSTRAINT "JobPostingSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationHistory" ADD CONSTRAINT "ApplicationHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderHealth" ADD CONSTRAINT "ProviderHealth_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRun" ADD CONSTRAINT "ProviderRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRun" ADD CONSTRAINT "ProviderRun_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderSetting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce one active search across web and worker processes.
CREATE UNIQUE INDEX "SearchRun_single_active_idx" ON "SearchRun" ((1)) WHERE "status" IN ('QUEUED', 'RUNNING');
