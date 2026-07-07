import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";
import { requireRole } from "../middleware/requireRole.middleware";
import { sendOperatorApprovedEmail, sendOperatorRejectedEmail } from "../services/email.service";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const adminRouter = Router();

adminRouter.use(requireAuth, syncAuth0User, requireRole("ADMIN"));

async function writeAuditLog(params: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown> | null;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as any,
    },
  });
}

// --- Users ---

adminRouter.get("/users", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: users });
  } catch (err) {
    next(err);
  }
});

// --- Operators ---

adminRouter.get("/operators", async (req, res, next) => {
  try {
    const operators = await prisma.operator.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } } },
    });
    res.json({ data: operators });
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/operators/:id/approve", async (req, res, next) => {
  try {
    const operator = await prisma.operator.update({
      where: { id: String(req.params.id) },
      data: { status: "APPROVED" },
    });

    await writeAuditLog({
      actorUserId: req.dbUser!.id,
      action: "OPERATOR_APPROVED",
      entityType: "Operator",
      entityId: operator.id,
    });

    await sendOperatorApprovedEmail({
      to: operator.contactEmail,
      companyName: operator.companyName,
    });

    res.json(operator);
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/operators/:id/reject", async (req, res, next) => {
  try {
    const operator = await prisma.operator.update({
      where: { id: String(req.params.id) },
      data: { status: "REJECTED" },
    });

    await writeAuditLog({
      actorUserId: req.dbUser!.id,
      action: "OPERATOR_REJECTED",
      entityType: "Operator",
      entityId: operator.id,
    });

    await sendOperatorRejectedEmail({
      to: operator.contactEmail,
      companyName: operator.companyName,
    });

    res.json(operator);
  } catch (err) {
    next(err);
  }
});

// --- Empty-legs (vista globale) ---

adminRouter.get("/empty-legs", async (req, res, next) => {
  try {
    const legs = await prisma.emptyLeg.findMany({
      orderBy: { departureAt: "desc" },
      include: {
        aircraft: true,
        operator: { select: { companyName: true } },
      },
    });
    res.json({ data: legs });
  } catch (err) {
    next(err);
  }
});

// --- Bookings (vista globale) ---

adminRouter.get("/bookings", async (req, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        emptyLeg: { select: { fromAirport: true, toAirport: true, departureAt: true } },
      },
    });
    res.json({ data: bookings });
  } catch (err) {
    next(err);
  }
});

const validStatuses = ["PENDING_PAYMENT", "PAID", "CONFIRMED", "CANCELLED", "EXPIRED"] as const;
const updateBookingStatusSchema = z.object({
  status: z.enum(validStatuses),
});

adminRouter.put("/bookings/:id/status", async (req, res, next) => {
  try {
    const parsed = updateBookingStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Status non valido", details: parsed.error.flatten() });
    }

    const booking = await prisma.booking.update({
      where: { id: String(req.params.id) },
      data: { status: parsed.data.status },
    });

    await writeAuditLog({
      actorUserId: req.dbUser!.id,
      action: "BOOKING_STATUS_CHANGED",
      entityType: "Booking",
      entityId: booking.id,
      metadata: { newStatus: parsed.data.status },
    });

    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// --- Contact requests ---

adminRouter.get("/contact-requests", async (req, res, next) => {
  try {
    const requests = await prisma.contactRequest.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: requests });
  } catch (err) {
    next(err);
  }
});

const updateContactStatusSchema = z.object({
  status: z.enum(["NEW", "READ", "CLOSED"]),
});

adminRouter.put("/contact-requests/:id/status", async (req, res, next) => {
  try {
    const parsed = updateContactStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Status non valido", details: parsed.error.flatten() });
    }

    const contactRequest = await prisma.contactRequest.update({
      where: { id: String(req.params.id) },
      data: { status: parsed.data.status },
    });

    res.json(contactRequest);
  } catch (err) {
    next(err);
  }
});