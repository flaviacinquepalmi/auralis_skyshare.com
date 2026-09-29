import Stripe from "stripe";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
const stripe = new Stripe(env.stripeSecretKey);

export async function refundBookingPayments(bookingId: string, context = "booking_cancelled") {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true },
  });
  if (!booking) throw new Error(`Booking ${bookingId} non trovato`);

  const refundedEmails = new Set<string>();
  let refundCount = 0;

  if (booking.bookingType === "SPLIT") {
    for (const payment of booking.payments) {
      if (payment.status !== "PAID" || !payment.stripePaymentIntentId) continue;
      try {
        await stripe.refunds.create({
          payment_intent: payment.stripePaymentIntentId,
          metadata: { bookingId, bookingPaymentId: payment.id, context },
        });
        await prisma.bookingPayment.update({
          where: { id: payment.id },
          data: { status: "REFUNDED", refundedAt: new Date() },
        });
        refundedEmails.add(payment.payerEmail);
        refundCount += 1;
      } catch (err: any) {
        // Idempotenza: se Stripe segnala che il pagamento e' gia' completamente rimborsato,
        // allineiamo comunque lo stato locale.
        const message = String(err?.message || "");
        if (/already been refunded|fully refunded/i.test(message)) {
          await prisma.bookingPayment.update({
            where: { id: payment.id },
            data: { status: "REFUNDED", refundedAt: payment.refundedAt || new Date() },
          });
          refundedEmails.add(payment.payerEmail);
          continue;
        }
        throw err;
      }
    }
  } else if (booking.stripePaymentIntentId) {
    try {
      await stripe.refunds.create({
        payment_intent: booking.stripePaymentIntentId,
        metadata: { bookingId, context },
      });
      refundedEmails.add(booking.bookerEmail);
      refundCount += 1;
    } catch (err: any) {
      const message = String(err?.message || "");
      if (!/already been refunded|fully refunded/i.test(message)) throw err;
      refundedEmails.add(booking.bookerEmail);
    }
  }

  logger.info({ bookingId, refundCount, context }, "Rimborsi booking completati");
  return { refundCount, refundedEmails: [...refundedEmails] };
}

export async function expirePendingCheckoutSessions(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true },
  });
  if (!booking) return;

  const sessionIds = booking.bookingType === "SPLIT"
    ? booking.payments
        .filter((p) => p.status === "PENDING" && p.stripeCheckoutSessionId)
        .map((p) => p.stripeCheckoutSessionId as string)
    : booking.stripeCheckoutSessionId
      ? [booking.stripeCheckoutSessionId]
      : [];

  for (const sessionId of sessionIds) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
    } catch (err) {
      logger.warn({ err, sessionId, bookingId }, "Impossibile scadere Checkout Session");
    }
  }
}
