-- AlterTable
ALTER TABLE "EmailSequenceStep" ADD COLUMN     "composedBodyHtml" TEXT,
ADD COLUMN     "composedBodyText" TEXT,
ADD COLUMN     "contentSource" TEXT NOT NULL DEFAULT 'registry',
ADD COLUMN     "editorDocument" JSONB,
ALTER COLUMN "templateKey" SET DEFAULT 'nurture-intro';
