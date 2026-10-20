-- AlterEnum
ALTER TYPE "ErrorCode" ADD VALUE 'NOT_FOUND';

-- DropIndex
DROP INDEX "Notification_channel_recipientHash_calendarDate_key";

-- AlterTable
ALTER TABLE "GeneratedDocument" ADD COLUMN     "evidenceUsed" JSONB,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "suggestedLearning" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "matchDetails" JSONB,
ADD COLUMN     "matchProfileVersion" INTEGER,
ADD COLUMN     "rankScore" INTEGER,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobPostingSource" ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT;

-- CreateTable
CREATE TABLE "JobNotification" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "notificationId" TEXT,

    CONSTRAINT "JobNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobNotification_jobId_channel_key" ON "JobNotification"("jobId", "channel");

-- CreateIndex
CREATE INDEX "Job_rankScore_idx" ON "Job"("rankScore");

-- CreateIndex
CREATE INDEX "Job_lastSeenAt_idx" ON "Job"("lastSeenAt");

-- CreateIndex
CREATE INDEX "JobPostingSource_provider_scope_idx" ON "JobPostingSource"("provider", "scope");

-- CreateIndex
CREATE INDEX "Notification_channel_calendarDate_idx" ON "Notification"("channel", "calendarDate");

-- AddForeignKey
ALTER TABLE "JobNotification" ADD CONSTRAINT "JobNotification_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobNotification" ADD CONSTRAINT "JobNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing rows rank by AI score when present, otherwise by the rule-based score.
UPDATE "Job" SET "rankScore" = COALESCE("matchScore", "preliminaryScore") WHERE "rankScore" IS NULL;
