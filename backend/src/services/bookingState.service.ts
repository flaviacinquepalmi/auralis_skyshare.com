import type { PrismaClient } from "../../generated/prisma/client";

// All writers use the same flight lock, including creation, confirmation and cancellation.
export async function confirmPaidBooking(prisma: PrismaClient, bookingId: string) {
  const initial = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.emptyLegId}))`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { emptyLeg: true } });
    if (booking.status !== "PAID" || booking.emptyLeg.status !== "PUBLISHED" || booking.emptyLeg.departureAt <= new Date()) {
      throw Object.assign(new Error("La prenotazione non è più confermabile"), { status: 409 });
    }
    await tx.emptyLeg.update({ where: { id: booking.emptyLegId }, data: { status: "BOOKED" } });
    return tx.booking.update({ where: { id: bookingId }, data: { status: "CONFIRMED" } });
  });
}

export async function closeBooking(prisma: PrismaClient, bookingId: string, status: "CANCELLED" | "EXPIRED", onlyPending = false, expectedStatus?: "PAID") {
  const initial = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.emptyLegId}))`;
    const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { emptyLeg: true } });
    // Retried terminal operations must continue cleanup/refunds after an earlier failure.
    if (current.status === "CANCELLED" || current.status === "EXPIRED") return current;
    if (expectedStatus && current.status !== expectedStatus) return null;
    if (onlyPending && current.status !== "PENDING_PAYMENT") return null;
    const booking = await tx.booking.update({ where: { id: bookingId }, data: { status } });
    // Never resurrect a cancelled flight, nor release a flight already owned by another booking.
    if (current.status === "CONFIRMED" && current.emptyLeg.status === "BOOKED" && current.emptyLeg.departureAt > new Date()) {
      await tx.emptyLeg.update({ where: { id: current.emptyLegId }, data: { status: "PUBLISHED" } });
    }
    return booking;
  });
}
