import type Stripe from "stripe";
import type { PrismaClient } from "../../generated/prisma/client";
import { sendSplitPaymentShareEmail } from "./email.service";
import { sendBookingEmailOnce } from "./bookingNotifications.service";
import { logger } from "../utils/logger";

export async function ensureSplitInvitations(prisma: PrismaClient, stripe: Stripe, bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: {
    emptyLeg: true, passengers: true, payments: { include: { passenger: true } },
  } });
  if (booking.bookingType !== "SPLIT" || booking.status !== "PENDING_PAYMENT") return { failed: 0 };
  // A crash halfway through Checkout creation must never distribute partial invites.
  if (booking.payments.length !== booking.passengers.length || booking.payments.some(payment => !payment.stripeCheckoutSessionId)) return { failed: 1 };
  let failed = 0;
  for (const payment of booking.payments) {
    if (payment.status !== "PENDING") continue;
    try {
      const receipt = await prisma.auditLog.findUnique({ where: { id: `email:${bookingId}:invite-${payment.id}` } });
      if (receipt?.action === "BOOKING_EMAIL_ACCEPTED") continue;
      const session = await stripe.checkout.sessions.retrieve(payment.stripeCheckoutSessionId!);
      if (session.metadata?.bookingId !== booking.id || session.metadata?.bookingPaymentId !== payment.id
          || session.amount_total !== Math.round(Number(payment.amount) * 100) || session.currency !== payment.currency.toLowerCase()) throw new Error("Invito non associato alla quota");
      if (session.status !== "open" || !session.url || session.expires_at * 1000 <= Date.now()) continue;
      const accepted = await sendBookingEmailOnce(prisma, booking.id, `invite-${payment.id}`, () => sendSplitPaymentShareEmail({
        deliveryKey: `email:${booking.id}:invite-${payment.id}`,
        to: payment.payerEmail, firstName: payment.passenger?.firstName || "", bookerFirstName: booking.bookerFirstName,
        fromAirport: booking.emptyLeg.fromAirport, toAirport: booking.emptyLeg.toAirport,
        amount: String(payment.amount), currency: payment.currency, checkoutUrl: session.url!,
        expiresAt: new Date(session.expires_at * 1000),
      }));
      if (!accepted) failed++;
    } catch (_error) { failed++; logger.warn({ bookingId, paymentId: payment.id }, "Invito quota da riprovare"); }
  }
  return { failed };
}
