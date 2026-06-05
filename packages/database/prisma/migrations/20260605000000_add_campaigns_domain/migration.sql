CREATE TABLE "EmailSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "templateKey" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "templateProps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaignRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "enrolledCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "campaignRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "enrolledById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailStepSend" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailStepSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLinkClick" (
    "id" TEXT NOT NULL,
    "stepSendId" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "utmContent" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryEvent" (
    "id" TEXT NOT NULL,
    "stepSendId" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bounceClass" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "rawType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEmailPreference" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'subscribed',
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEmailPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEmailSequenceOptOut" (
    "contactId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "optedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEmailSequenceOptOut_pkey" PRIMARY KEY ("contactId","sequenceId")
CREATE INDEX "EmailSequence_organizationId_kind_idx" ON "EmailSequence"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "EmailSequence_organizationId_status_idx" ON "EmailSequence"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSequence_organizationId_slug_key" ON "EmailSequence"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "EmailSequenceStep_sequenceId_sortOrder_idx" ON "EmailSequenceStep"("sequenceId", "sortOrder");

-- CreateIndex
CREATE INDEX "EmailCampaignRun_organizationId_sequenceId_idx" ON "EmailCampaignRun"("organizationId", "sequenceId");

-- CreateIndex
CREATE INDEX "EmailCampaignRun_organizationId_status_idx" ON "EmailCampaignRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EmailEnrollment_organizationId_sequenceId_idx" ON "EmailEnrollment"("organizationId", "sequenceId");

-- CreateIndex
CREATE INDEX "EmailEnrollment_organizationId_contactId_idx" ON "EmailEnrollment"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "EmailEnrollment_campaignRunId_idx" ON "EmailEnrollment"("campaignRunId");

-- CreateIndex
CREATE INDEX "EmailEnrollment_contactId_sequenceId_status_idx" ON "EmailEnrollment"("contactId", "sequenceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailStepSend_idempotencyKey_key" ON "EmailStepSend"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailStepSend_enrollmentId_idx" ON "EmailStepSend"("enrollmentId");

-- CreateIndex
CREATE INDEX "EmailStepSend_stepId_idx" ON "EmailStepSend"("stepId");

-- CreateIndex
CREATE INDEX "EmailStepSend_providerMessageId_idx" ON "EmailStepSend"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailLinkClick_stepSendId_idx" ON "EmailLinkClick"("stepSendId");

-- CreateIndex
CREATE INDEX "EmailDeliveryEvent_providerMessageId_idx" ON "EmailDeliveryEvent"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailDeliveryEvent_stepSendId_idx" ON "EmailDeliveryEvent"("stepSendId");

-- CreateIndex
CREATE INDEX "ContactEmailPreference_organizationId_status_idx" ON "ContactEmailPreference"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmailPreference_contactId_organizationId_key" ON "ContactEmailPreference"("contactId", "organizationId");

-- CreateIndex
CREATE INDEX "ContactEmailSequenceOptOut_sequenceId_idx" ON "ContactEmailSequenceOptOut"("sequenceId");
ALTER TABLE "EmailSequenceStep" ADD CONSTRAINT "EmailSequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "EmailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaignRun" ADD CONSTRAINT "EmailCampaignRun_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "EmailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEnrollment" ADD CONSTRAINT "EmailEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "EmailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEnrollment" ADD CONSTRAINT "EmailEnrollment_campaignRunId_fkey" FOREIGN KEY ("campaignRunId") REFERENCES "EmailCampaignRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailStepSend" ADD CONSTRAINT "EmailStepSend_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "EmailEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailStepSend" ADD CONSTRAINT "EmailStepSend_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "EmailSequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLinkClick" ADD CONSTRAINT "EmailLinkClick_stepSendId_fkey" FOREIGN KEY ("stepSendId") REFERENCES "EmailStepSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_stepSendId_fkey" FOREIGN KEY ("stepSendId") REFERENCES "EmailStepSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmailSequenceOptOut" ADD CONSTRAINT "ContactEmailSequenceOptOut_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "EmailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
