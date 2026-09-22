import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { syncFlightRequestToHubSpot, listFlightRequestsForEmail, readCustomerDeals, CustomerCrmRequest } from "./hubspot.service";
import { logger } from "../utils/logger";

export const flightRequestsDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });

export async function synchronizeFlightRequest(requestId: string): Promise<boolean> {
  const db = flightRequestsDb.flightRequest;
  const current = await db.findUnique({ where: { requestId } });
  if (!current) return false;
  if (current.crmSyncedAt) return true;
  // A short lease prevents simultaneous retries. Failed attempts can retry after
  // five minutes, allowing HubSpot's search index to catch up after a timeout.
  const claimed = await db.updateMany({
    where: { requestId, crmSyncedAt: null, OR: [
      { crmSyncStartedAt: null },
      { crmSyncStartedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
    ] }, data: { crmSyncStartedAt: new Date() },
  });
  if (!claimed.count) return false;
  try {
    const crm = await syncFlightRequestToHubSpot({
      requestId: current.requestId,
      firstName: current.firstName, lastName: current.lastName, email: current.email,
      phone: current.phone ?? undefined, from: current.from ?? undefined, to: current.to ?? undefined,
      departureDate: current.departureDate ?? undefined, preferredTime: current.preferredTime ?? undefined,
      passengers: current.passengers ?? undefined, aircraftCategory: current.aircraftCategory ?? undefined,
      requestType: current.requestType as "Richiesta Empty Leg" | "Richiesta volo su misura" | "Altro",
      leadSource: current.leadSource,
    });
    if (!crm) return false;
    await db.update({ where: { requestId }, data: {
      hubspotDealId: crm.dealId, crmSyncedAt: new Date(), crmSyncStartedAt: null,
    } });
    return true;
  } catch (error) {
    logger.error({ error, requestId }, "Richiesta salvata in Neon; sincronizzazione HubSpot da riprovare");
    return false;
  }
}

export async function verifiedRequestEmail(authorization: string, sub: string): Promise<string | null> {
  const response = await fetch(new URL("userinfo", env.auth0IssuerBaseUrl.replace(/\/?$/, "/")), {
    headers: { Authorization: authorization }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Auth0 userinfo non disponibile");
  const profile = await response.json() as { sub?: string; email?: string; email_verified?: boolean };
  if (profile.sub !== sub || profile.email_verified !== true || typeof profile.email !== "string") return null;
  return profile.email.trim().toLowerCase();
}

async function importHistoricalRequests(sub: string, email: string, requests: CustomerCrmRequest[]) {
  for (const request of requests) {
    // An existing row is never reassigned, even if another account knows its email.
    await flightRequestsDb.flightRequest.upsert({
      where: { requestId: request.requestId }, update: {},
      create: {
        ...request, submissionKey: `hubspot:${request.hubspotDealId}`,
        customerAuth0Sub: sub, email, firstName: "", lastName: "", crmSyncedAt: new Date(),
      },
    });
  }
}

export async function customerFlightRequests(sub: string, verifiedEmail: string | null) {
  const db = flightRequestsDb.flightRequest;
  const warnings: string[] = [];
  if (verifiedEmail) {
    // Only guest requests can be claimed through verified email ownership.
    await db.updateMany({ where: { customerAuth0Sub: null, email: verifiedEmail }, data: { customerAuth0Sub: sub } });
    try {
      const historical = await listFlightRequestsForEmail(verifiedEmail);
      await importHistoricalRequests(sub, verifiedEmail, historical);
    } catch (error) {
      logger.warn({ error }, "Recupero storico HubSpot non disponibile");
      warnings.push("Le richieste precedenti non sono aggiornate al momento.");
    }
  }
  let rows = await db.findMany({ where: { customerAuth0Sub: sub }, orderBy: { createdAt: "desc" } });
  // Recover pending deliveries whenever the customer returns to the dashboard.
  for (const row of rows.filter(item => !item.crmSyncedAt).slice(0, 3)) {
    await synchronizeFlightRequest(row.requestId);
  }
  rows = await db.findMany({ where: { customerAuth0Sub: sub }, orderBy: { createdAt: "desc" } });
  try {
    const remote = await readCustomerDeals(rows.flatMap(row => row.hubspotDealId ? [row.hubspotDealId] : []));
    for (const request of remote) {
      await db.updateMany({
        where: { requestId: request.requestId, customerAuth0Sub: sub, hubspotDealId: request.hubspotDealId },
        data: { status: request.status, from: request.from, to: request.to,
          departureDate: request.departureDate, passengers: request.passengers },
      });
    }
  } catch (error) {
    logger.warn({ error }, "Mostro l’ultimo stato salvato delle richieste");
    warnings.push("Gli stati mostrati sono gli ultimi salvati: aggiornamento HubSpot temporaneamente non disponibile.");
  }
  const data = await db.findMany({
    where: { customerAuth0Sub: sub }, orderBy: { createdAt: "desc" },
    select: { requestId: true, from: true, to: true, departureDate: true,
      passengers: true, status: true, createdAt: true, crmSyncedAt: true },
  });
  return {
    data: data.map(({ crmSyncedAt, ...row }) => ({ ...row,
      status: crmSyncedAt ? row.status : "Ricevuta — inoltro in corso", pendingCrmSync: !crmSyncedAt,
    })), warnings,
  };
}
