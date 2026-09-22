import { randomUUID } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { syncFlightRequestToHubSpot } from "../services/hubspot.service";
import { logger } from "../utils/logger";

export const flightRequestsRouter = Router();

const flightRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." },
});

const flightRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().max(40).optional(),
  from: z.string().trim().min(2).max(120),
  to: z.string().trim().min(2).max(120),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  passengers: z.number().int().min(1).max(20),
  aircraftCategory: z.string().trim().max(120).optional(),
  requestType: z
    .enum(["Richiesta Empty Leg", "Richiesta volo su misura", "Altro"])
    .default("Richiesta volo su misura"),
  leadSource: z.string().trim().min(1).max(80).default("Website"),
});

flightRequestsRouter.post("/", flightRequestLimiter, async (req, res, next) => {
  try {
    const parsed = flightRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Dati non validi",
        details: parsed.error.flatten(),
      });
    }

    const requestId = `AFR-${randomUUID().slice(0, 8).toUpperCase()}`;
    const data = parsed.data;

    const crm = await syncFlightRequestToHubSpot({
      requestId,
      ...data,
    });

    if (!crm) {
      return res.status(503).json({
        error: "CRM temporaneamente non disponibile. Riprova tra poco.",
      });
    }

    return res.status(201).json({
      requestId,
      status: "received",
    });
  } catch (error) {
    logger.error({ error }, "Errore invio richiesta volo a HubSpot");
    next(error);
  }
});
