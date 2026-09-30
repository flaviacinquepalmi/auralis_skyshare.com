import { ensureSplitInvitations } from "./splitInvitations.service";
import type Stripe from "stripe";
import type { PrismaClient } from "../../generated/prisma/client";
import { recordPaidCheckout } from "./checkoutState.service";
import { closeBooking } from "./bookingState.service";
import { refundBookingPayments, expirePendingCheckoutSessions } from "./payments.service";
import { ensureBookingNotifications } from "./bookingNotifications.service";

// Both webhook and sweep use the same transactional payment transition.
export async function reconcileBooking(prisma: PrismaClient, stripe: Stripe, bookingId: string) {
  let booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payments: true, emptyLeg: true } });
  const failures: unknown[] = [];
  const now = Date.now();
  const sessionIds = booking.bookingType === "SPLIT"
    ? booking.payments.flatMap(payment => payment.stripeCheckoutSessionId ? [payment.stripeCheckoutSessionId] : [])
    : booking.stripeCheckoutSessionId ? [booking.stripeCheckoutSessionId] : [];

  // Fetch before deciding about expiry: an on-time payment may have lost its webhook.
  const sessions: Stripe.Checkout.Session[] = [];
  for (const id of sessionIds) {
    try {
      const session = await stripe.checkout.sessions.retrieve(id);
      if (session.metadata?.bookingId !== booking.id) throw new Error("Metadata sessione non coerenti");
      sessions.push(session);
      if (session.payment_status === "paid") await recordPaidCheckout(prisma, session);
    } catch (error) { failures.push(error); }
  }
  booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payments: true, emptyLeg: true } });
  if (booking.status === "PENDING_PAYMENT" && failures.length === 0) {
    const due = (booking.splitExpiresAt && booking.splitExpiresAt.getTime() <= now)
      || sessions.some(session => session.status === "expired")
      || booking.emptyLeg.departureAt.getTime() <= now;
    // Do not cancel an asynchronous payment that Checkout reports complete/unpaid.
    const processing = sessions.some(session => session.status === "complete" && session.payment_status === "unpaid");
    const orphan = sessionIds.length === 0 && booking.createdAt.getTime() < now - 35 * 60_000;
    if ((due && !processing) || orphan) await closeBooking(prisma, booking.id, "EXPIRED", true);
  }
  booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payments: true, emptyLeg: true } });
  if (booking.status === "PAID" && booking.emptyLeg.departureAt.getTime() <= now) {
    await closeBooking(prisma, booking.id, "CANCELLED", false, "PAID");
    booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payments: true, emptyLeg: true } });
  }
  if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
    // Attempt both operations even if one session cannot be closed.
    try { await expirePendingCheckoutSessions(bookingId); } catch (error) { failures.push(error); }
    try { await refundBookingPayments(bookingId, "scheduled_reconciliation"); } catch (error) { failures.push(error); }
  }
  if (booking.status === "PENDING_PAYMENT") {
    try {
      const invitations = await ensureSplitInvitations(prisma, stripe, bookingId);
      if (invitations.failed) throw new Error("Inviti quote da riprovare");
    } catch (error) { failures.push(error); }
  }
  // Booking state and audit delivery markers survive a process crash.
  try { await ensureBookingNotifications(prisma, bookingId); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, `Booking ${bookingId}: riconciliazione incompleta`);
}
