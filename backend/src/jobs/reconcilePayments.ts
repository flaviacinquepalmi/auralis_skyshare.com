import Stripe from "stripe";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { reconcileBooking } from "../services/paymentReconciliation.service";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });
const apply = process.argv.includes("--apply");
const knownArgs = new Set(["--apply"]);

async function main() {
  if (process.argv.slice(2).some(arg => !knownArgs.has(arg))) throw new Error("Uso: reconcile:payments [--apply]");
  // Dry run is DB-read-only. No Stripe calls, mail, or updates without --apply.
  const stripe = apply ? new Stripe(env.stripeSecretKey) : null;
  let cursor: string | undefined;
  let scanned = 0, failed = 0;
  for (;;) {
    const bookings = await prisma.booking.findMany({
      where: { status: { in: ["PENDING_PAYMENT", "PAID", "CONFIRMED", "CANCELLED", "EXPIRED"] } },
      select: { id: true, status: true }, orderBy: { id: "asc" }, take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!bookings.length) break;
    for (const booking of bookings) {
      scanned++;
      if (!stripe) { logger.info({ bookingId: booking.id, status: booking.status }, "Candidato riconciliazione (dry run)"); continue; }
      try { await reconcileBooking(prisma, stripe, booking.id); }
      catch (error) { failed++; logger.error({ bookingId: booking.id, error }, "Riconciliazione da riprovare"); }
    }
    cursor = bookings[bookings.length - 1].id;
  }
  logger.info({ mode: apply ? "apply" : "dry-run", scanned, failed }, "Riconciliazione completata");
  if (failed) process.exitCode = 1;
}
main().catch(error => { logger.error({ error }, "Riconciliazione interrotta"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
