import type Stripe from "stripe";
import type { PrismaClient } from "../../generated/prisma/client";

export async function recordPaidCheckout(prisma: PrismaClient, session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.bookingId;
  const bookingPaymentId = session.metadata?.bookingPaymentId;
  if (!bookingId) throw new Error("Metadata booking mancante");
  const initial = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (session.payment_status !== "paid" || !paymentIntentId) return { terminal: false, paid: false };
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.emptyLegId}))`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const terminal = booking.status === "CANCELLED" || booking.status === "EXPIRED";
    if (booking.bookingType === "SPLIT") {
      if (!bookingPaymentId) throw new Error("Metadata quota mancante");
      const payment = await tx.bookingPayment.findUnique({ where: { id: bookingPaymentId } });
      if (!payment || payment.bookingId !== bookingId ||
          (payment.stripeCheckoutSessionId && payment.stripeCheckoutSessionId !== session.id)) throw new Error("Sessione non associata alla quota");
      if (session.amount_total !== Math.round(Number(payment.amount) * 100) || session.currency !== payment.currency.toLowerCase()) throw new Error("Importo quota non coerente");
      if (payment.status !== "REFUNDED") {
        await tx.bookingPayment.update({ where: { id: payment.id }, data: { status: "PAID", stripePaymentIntentId: paymentIntentId } });
      }
      if (terminal) return { terminal: true, paid: false };
      const remaining = await tx.bookingPayment.count({ where: { bookingId, status: { not: "PAID" } } });
      if (remaining) return { terminal: false, paid: false };
    } else {
      if (bookingPaymentId || (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== session.id)) throw new Error("Sessione non associata alla prenotazione");
      if (session.amount_total !== Math.round(Number(booking.totalAmount) * 100) || session.currency !== booking.currency.toLowerCase()) throw new Error("Importo prenotazione non coerente");
      await tx.booking.update({ where: { id: bookingId }, data: { stripePaymentIntentId: paymentIntentId } });
      if (terminal) return { terminal: true, paid: false };
    }
    const transitioned = await tx.booking.updateMany({ where: { id: bookingId, status: "PENDING_PAYMENT" }, data: { status: "PAID" } });
    return { terminal: false, paid: transitioned.count === 1 };
  });
}
