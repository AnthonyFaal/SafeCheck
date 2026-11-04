-- DropIndex
DROP INDEX "LiveSession_status_createdAt_idx";

-- AlterTable
ALTER TABLE "LiveSession" ALTER COLUMN "updatedAt" DROP DEFAULT;
