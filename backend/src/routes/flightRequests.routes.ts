import { randomUUID } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { flightRequestsDb, synchronizeFlightRequest } from "../services/flightRequests.service";

export const flightRequestsRouter = Router();
const flightRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." },
});
const blankToUndefined = (value: unknown) => value === "" || value === null ? undefined : value;
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const flightRequestSchema = z.object({
  submissionKey: z.string().uuid().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  phone: optionalText(40), from: optionalText(120), to: optionalText(120),
  departureDate: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(value => { const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Data non valida").optional()),
  preferredTime: z.preprocess(blankToUndefined, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()),
  passengers: z.preprocess(value => value === 0 ? undefined : blankToUndefined(value), z.number().int().min(1).max(20).optional()),
  aircraftCategory: optionalText(120),
  requestType: z.enum(["Richiesta Empty Leg", "Richiesta volo su misura", "Altro"]).default("Richiesta volo su misura"),
  leadSource: z.string().trim().min(1).max(80).default("Website"),
});

// Guests may submit; a supplied token must be valid, never silently downgraded.
flightRequestsRouter.post("/", flightRequestLimiter, (req, res, next) => {
  if (req.headers.authorization) return requireAuth(req, res, next);
  next();
}, async (req, res, next) => {
  try {
    const parsed = flightRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    const { submissionKey = randomUUID(), ...input } = parsed.data;
    const customerAuth0Sub = req.auth?.payload.sub || null;
    const saved = await flightRequestsDb.flightRequest.upsert({
      where: { submissionKey }, update: {},
      create: { requestId: `AFR-${randomUUID().toUpperCase()}`, submissionKey, customerAuth0Sub, ...input },
    });
    // A key can retry the same submission, never change its content or owner.
    const contentChanged = Object.entries(input).some(([key, value]) =>
      (saved[key as keyof typeof saved] ?? null) !== (value ?? null));
    if (saved.customerAuth0Sub !== customerAuth0Sub || contentChanged) {
      return res.status(409).json({ error: "I dati della richiesta sono cambiati. Avvia un nuovo invio." });
    }
    const synced = await synchronizeFlightRequest(saved.requestId);
    if (!synced) {
      return res.status(503).json({ requestId: saved.requestId,
        error: `Richiesta ${saved.requestId} salvata. L’inoltro al team è temporaneamente in attesa: riprova tra 5 minuti senza modificare il form.` });
    }
    return res.status(201).json({ requestId: saved.requestId, status: "received" });
  } catch (error) { next(error); }
});
