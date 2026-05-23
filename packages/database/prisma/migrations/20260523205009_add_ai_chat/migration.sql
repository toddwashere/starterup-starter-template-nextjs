-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "AiMessageFeedback" AS ENUM ('helpful', 'not_helpful');

-- CreateTable
CREATE TABLE "aiThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aiThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolPayload" JSONB,
    "feedback" "AiMessageFeedback",
    "feedbackComment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aiThread_organizationId_updatedAt_idx" ON "aiThread"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "aiThread_userId_organizationId_idx" ON "aiThread"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "aiMessage_threadId_createdAt_idx" ON "aiMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "aiThread" ADD CONSTRAINT "aiThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiThread" ADD CONSTRAINT "aiThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiMessage" ADD CONSTRAINT "aiMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "aiThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
