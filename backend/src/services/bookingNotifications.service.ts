import type { PrismaClient } from "../../generated/prisma/client";
import { sendPaymentConfirmedEmail, sendOperatorBookingNotification, sendBookingConfirmedEmail, sendRefundIssuedEmail } from "./email.service";

// Delivery markers in the existing audit log allow a later sweep to recover a
// notification missed after a committed booking transition. No tokens/HTML in the log.
export async function ensureBookingNotifications(prisma: PrismaClient, bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId }, include: { emptyLeg: { include: { operator: true } }, payments: true },
  });
  const pending: { key: string; send: () => Promise<boolean> }[] = [];
  const route = { fromAirport: booking.emptyLeg.fromAirport, toAirport: booking.emptyLeg.toAirport };
  if (booking.status === "PAID") {
    pending.push({ key: "paid-customer", send: () => sendPaymentConfirmedEmail({ deliveryKey: `email:${booking.id}:paid-customer`, ...route, to: booking.bookerEmail, bookerFirstName: booking.bookerFirstName }) });
    pending.push({ key: "paid-operator", send: () => sendOperatorBookingNotification({ deliveryKey: `email:${booking.id}:paid-operator`, ...route, to: booking.emptyLeg.operator.contactEmail, bookerFirstName: booking.bookerFirstName, bookerLastName: booking.bookerLastName }) });
  } else if (booking.status === "CONFIRMED") {
    pending.push({ key: "confirmed", send: () => sendBookingConfirmedEmail({ deliveryKey: `email:${booking.id}:confirmed`, ...route, to: booking.bookerEmail, bookerFirstName: booking.bookerFirstName }) });
  } else if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
    if (booking.bookingType === "SPLIT") {
      for (const payment of booking.payments.filter(payment => payment.status === "REFUNDED")) {
        pending.push({ key: `refunded-${payment.id}`, send: () => sendRefundIssuedEmail({ deliveryKey: `email:${booking.id}:refunded-${payment.id}`, ...route, to: payment.payerEmail }) });
      }
    } else if (booking.stripePaymentIntentId) {
      const refunded = await prisma.auditLog.findUnique({ where: { id: `refund:${booking.stripePaymentIntentId}` } });
      if (refunded) pending.push({ key: "refunded-full", send: () => sendRefundIssuedEmail({ deliveryKey: `email:${booking.id}:refunded-full`, ...route, to: booking.bookerEmail }) });
    }
  }
  let failed = 0;
  for (const notification of pending) {
    if (!await sendBookingEmailOnce(prisma, booking.id, notification.key, notification.send)) failed++;
  }
  if (failed) throw new Error(`${failed} notifiche booking da riprovare`);
}

export async function sendBookingEmailOnce(prisma: PrismaClient, bookingId: string, key: string, send: () => Promise<boolean>) {
  const id = `email:${bookingId}:${key}`;
  const claimedAt = new Date();
  const claimed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const receipt = await tx.auditLog.findUnique({ where: { id } });
    if (receipt?.action === "BOOKING_EMAIL_ACCEPTED") return false;
    if (receipt?.action === "BOOKING_EMAIL_SENDING" && receipt.createdAt.getTime() > Date.now() - 5 * 60_000) return false;
    const data = { action: "BOOKING_EMAIL_SENDING", createdAt: claimedAt, metadata: { notification: key } };
    await tx.auditLog.upsert({ where: { id }, update: data, create: { ...data, id, entityType: "Booking", entityId: bookingId } });
    return true;
  });
  if (!claimed) return true;
  let accepted = false;
  try { accepted = await send(); } catch (_error) { accepted = false; }
  await prisma.auditLog.updateMany({
    where: { id, action: "BOOKING_EMAIL_SENDING", createdAt: claimedAt },
    data: { action: accepted ? "BOOKING_EMAIL_ACCEPTED" : "BOOKING_EMAIL_FAILED" },
  });
  return accepted;
}
