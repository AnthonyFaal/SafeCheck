ALTER TABLE "LiveSessionPlayer" ADD COLUMN "guestTokenKey" TEXT;
CREATE UNIQUE INDEX "LiveSessionPlayer_guestTokenKey_key" ON "LiveSessionPlayer"("guestTokenKey");
