import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import {
  sendNewsletterConfirmationEmail,
  sendNewsletterWelcomeEmail,
} from "../services/email.service";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const newsletterRouter = Router();

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." },
});

const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  consent: z.literal(true),
  source: z.string().trim().max(80).optional(),
  consentAt: z.string().datetime().optional(),
  company_website: z.string().optional(),
});

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function publicApiUrl() {
  return env.publicApiUrl.replace(/\/$/, "");
}

newsletterRouter.post("/subscribe", subscribeLimiter, async (req, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Inserisci un indirizzo email valido e presta il consenso." });
    }

    // Honeypot: rispondi come se fosse andato tutto bene senza salvare spam.
    if (parsed.data.company_website) {
      return res.status(202).json({ status: "pending" });
    }

    if (!publicApiUrl()) {
      return res.status(503).json({ error: "Newsletter non configurata: manca PUBLIC_API_URL." });
    }

    const rawToken = randomBytes(32).toString("hex");
    const rawUnsubscribeToken = randomBytes(32).toString("hex");
    const confirmationExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const email = parsed.data.email;
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });

    const subscriber = existing
      ? await prisma.newsletterSubscriber.update({
          where: { email },
          data: {
            status: existing.status === "ACTIVE" ? "ACTIVE" : "PENDING",
            consentGiven: true,
            consentAt: parsed.data.consentAt ? new Date(parsed.data.consentAt) : new Date(),
            source: parsed.data.source,
            confirmationTokenHash: hashToken(rawToken),
            unsubscribeTokenHash: hashToken(rawUnsubscribeToken),
            confirmationExpiresAt,
            unsubscribedAt: null,
          },
        })
      : await prisma.newsletterSubscriber.create({
          data: {
            email,
            status: "PENDING",
            consentGiven: true,
            consentAt: parsed.data.consentAt ? new Date(parsed.data.consentAt) : new Date(),
            source: parsed.data.source,
            confirmationTokenHash: hashToken(rawToken),
            unsubscribeTokenHash: hashToken(rawUnsubscribeToken),
            confirmationExpiresAt,
          },
        });

    if (subscriber.status !== "ACTIVE") {
      const confirmationUrl = `${publicApiUrl()}/api/newsletter/confirm?token=${rawToken}`;
      await sendNewsletterConfirmationEmail({ to: email, confirmationUrl });
    }

    return res.status(202).json({ status: subscriber.status === "ACTIVE" ? "active" : "pending" });
  } catch (error) {
    return next(error);
  }
});

newsletterRouter.get("/confirm", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return res.status(400).send("Link di conferma non valido.");

    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { confirmationTokenHash: hashToken(token) },
    });
    if (!subscriber || !subscriber.confirmationExpiresAt || subscriber.confirmationExpiresAt < new Date()) {
      return res.status(400).send("Il link di conferma è scaduto. Iscriviti nuovamente alla newsletter.");
    }

    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: {
        status: "ACTIVE",
        confirmedAt: new Date(),
        confirmationTokenHash: null,
        confirmationExpiresAt: null,
      },
    });
    const unsubscribeToken = randomBytes(32).toString("hex");
    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { unsubscribeTokenHash: hashToken(unsubscribeToken) },
    });
    await sendNewsletterWelcomeEmail({
      to: subscriber.email,
      unsubscribeUrl: `${publicApiUrl()}/api/newsletter/unsubscribe?token=${unsubscribeToken}`,
    });

    const redirectUrl = `${env.frontendUrl.replace(/\/$/, "")}/?newsletter=confirmed`;
    return res.redirect(303, redirectUrl);
  } catch (error) {
    return next(error);
  }
});

newsletterRouter.get("/unsubscribe", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return res.status(400).send("Link di annullamento non valido.");
    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { unsubscribeTokenHash: hashToken(token) },
    });
    if (!subscriber) return res.status(404).send("Iscrizione non trovata.");
    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { status: "UNSUBSCRIBED", consentGiven: false, unsubscribedAt: new Date(), unsubscribeTokenHash: null },
    });
    return res.status(200).send("Iscrizione annullata correttamente.");
  } catch (error) {
    return next(error);
  }
});
