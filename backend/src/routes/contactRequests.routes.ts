import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { sendAdminContactRequestNotification } from "../services/email.service";
import { logger } from "../utils/logger";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const contactRequestsRouter = Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." },
});

const contactRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  topic: z.string().min(1),
  message: z.string().min(1),
});

contactRequestsRouter.post("/", contactLimiter, async (req, res, next) => {
  try {
    const parsed = contactRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const contactRequest = await prisma.contactRequest.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        topic: data.topic,
        message: data.message,
        status: "NEW",
      },
    });

    try {
      await sendAdminContactRequestNotification({
        name: data.name,
        email: data.email,
        topic: data.topic,
        message: data.message,
      });
    } catch (emailErr) {
      logger.error({ emailErr }, "Notifica email admin fallita, contact request comunque salvata");
    }

    res.status(201).json({ id: contactRequest.id, status: contactRequest.status });
  } catch (err) {
    next(err);
  }
});