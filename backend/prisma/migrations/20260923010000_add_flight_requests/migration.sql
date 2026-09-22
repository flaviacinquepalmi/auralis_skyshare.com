CREATE TABLE "flight_requests" (
    "requestId" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "customerAuth0Sub" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "from" TEXT,
    "to" TEXT,
    "departureDate" TEXT,
    "preferredTime" TEXT,
    "passengers" INTEGER,
    "aircraftCategory" TEXT,
    "requestType" TEXT NOT NULL DEFAULT 'Richiesta volo su misura',
    "leadSource" TEXT NOT NULL DEFAULT 'Website',
    "status" TEXT NOT NULL DEFAULT 'Richiesta ricevuta',
    "hubspotDealId" TEXT,
    "crmSyncedAt" TIMESTAMP(3),
    "crmSyncStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "flight_requests_pkey" PRIMARY KEY ("requestId")
);
CREATE UNIQUE INDEX "flight_requests_submissionKey_key" ON "flight_requests"("submissionKey");
CREATE UNIQUE INDEX "flight_requests_hubspotDealId_key" ON "flight_requests"("hubspotDealId");
CREATE INDEX "flight_requests_customerAuth0Sub_createdAt_idx" ON "flight_requests"("customerAuth0Sub", "createdAt");
CREATE INDEX "flight_requests_email_idx" ON "flight_requests"("email");
