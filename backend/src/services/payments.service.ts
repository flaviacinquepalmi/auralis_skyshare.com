import Stripe from "stripe";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
const stripe = new Stripe(env.stripeSecretKey);


async function refundPaymentIntent(paymentIntentId: string, bookingId: string) {
  const receiptId = `refund:${paymentIntentId}`;
  if (await prisma.auditLog.findUnique({ where: { id: receiptId } })) return;
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      metadata: { bookingId },
    }, { idempotencyKey: `auralis-refund-${paymentIntentId}` });
    const current = refund.status === "succeeded" ? refund : await stripe.refunds.retrieve(refund.id);
    if (current.status !== "succeeded") throw new Error(`Rimborso ${current.id}: ${current.status}; riconciliazione richiesta`);
  } catch (error: any) {
    if (error?.code !== "charge_already_refunded") throw error;
    const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const settled = refunds.data.filter(refund => refund.status === "succeeded").reduce((sum, refund) => sum + refund.amount, 0);
    if (!intent.amount_received || settled < intent.amount_received) throw error;
  }
  await prisma.auditLog.upsert({ where: { id: receiptId }, update: {}, create: {
    id: receiptId, action: "BOOKING_REFUND_SUCCEEDED", entityType: "Booking", entityId: bookingId,
  } });
}

export async function refundBookingPayments(bookingId: string, context = "booking_cancelled") {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true },
  });
  if (!booking) throw new Error(`Booking ${bookingId} non trovato`);

  const refundedEmails = new Set<string>();
  let refundCount = 0;
  const failures: unknown[] = [];

  if (booking.bookingType === "SPLIT") {
    for (const payment of booking.payments) {
      if (payment.status !== "PAID" || !payment.stripePaymentIntentId) continue;
      try {
        await refundPaymentIntent(payment.stripePaymentIntentId, bookingId);
        await prisma.bookingPayment.update({
          where: { id: payment.id },
          data: { status: "REFUNDED", refundedAt: new Date() },
        });
        refundedEmails.add(payment.payerEmail);
        refundCount += 1;
      } catch (err) { failures.push(err); }
    }
  } else if (booking.stripePaymentIntentId) {
    try {
      await refundPaymentIntent(booking.stripePaymentIntentId, bookingId);
      refundedEmails.add(booking.bookerEmail);
      refundCount += 1;
    } catch (err) { failures.push(err); }
  }

  if (failures.length) throw new AggregateError(failures, "Alcuni rimborsi richiedono un nuovo tentativo");
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
        .filter((p) => p.stripeCheckoutSessionId)
        .map((p) => p.stripeCheckoutSessionId as string)
    : booking.stripeCheckoutSessionId
      ? [booking.stripeCheckoutSessionId]
      : [];

  const failures: unknown[] = [];
  for (const sessionId of sessionIds) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
    } catch (err) {
      logger.warn({ err, sessionId, bookingId }, "Impossibile scadere Checkout Session");
      failures.push(err);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Alcune sessioni non sono state chiuse");
}
