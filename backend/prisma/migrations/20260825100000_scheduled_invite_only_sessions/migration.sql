ALTER TYPE "LiveSessionStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "LiveSessionStatus" ADD VALUE IF NOT EXISTS 'CANCELED';

ALTER TABLE "LiveSession"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "canceledAt" TIMESTAMP(3);

ALTER TABLE "LiveSessionPlayer"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "LiveSession_status_scheduledFor_idx" ON "LiveSession"("status", "scheduledFor");
CREATE INDEX "LiveSession_hostId_createdAt_idx" ON "LiveSession"("hostId", "createdAt");
