-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "aiAverageScore" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "JobScoring" (
    "id" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "averageScore" DECIMAL(5,2),
    "slotsPlanned" INTEGER NOT NULL,
    "slotsScored" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "jobId" TEXT NOT NULL,

    CONSTRAINT "JobScoring_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobModelScore" (
    "id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "primaryModel" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "result" JSONB,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scoringId" TEXT NOT NULL,

    CONSTRAINT "JobModelScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobScoring_jobId_createdAt_idx" ON "JobScoring"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobScoring_jobId_inputHash_key" ON "JobScoring"("jobId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "JobModelScore_scoringId_slot_key" ON "JobModelScore"("scoringId", "slot");

-- AddForeignKey
ALTER TABLE "JobScoring" ADD CONSTRAINT "JobScoring_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobModelScore" ADD CONSTRAINT "JobModelScore_scoringId_fkey" FOREIGN KEY ("scoringId") REFERENCES "JobScoring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

