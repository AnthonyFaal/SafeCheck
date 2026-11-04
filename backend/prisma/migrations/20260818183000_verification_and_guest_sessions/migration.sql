ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "EmailOtp" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailOtp_userId_createdAt_idx" ON "EmailOtp"("userId", "createdAt");
ALTER TABLE "EmailOtp" ADD CONSTRAINT "EmailOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSessionPlayer" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "LiveSessionPlayer" ADD COLUMN "guestTokenHash" TEXT;
ALTER TABLE "LiveSessionPlayer" ADD COLUMN "displayName" TEXT;
CREATE INDEX "LiveSessionPlayer_sessionId_guestTokenHash_idx" ON "LiveSessionPlayer"("sessionId", "guestTokenHash");
