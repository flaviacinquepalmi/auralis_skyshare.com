import { Router } from "express";
import express from "express";
import Stripe from "stripe";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
const stripe = new Stripe(env.stripeSecretKey);

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature as string,
        env.stripeWebhookSecret
      );
    } catch (err: any) {
      logger.error({ err }, "Webhook signature non valida");
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logger.info({ type: event.type }, "Evento Stripe ricevuto");

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;

      if (!bookingId) {
        logger.error("Nessun bookingId nei metadata della sessione Stripe");
        return res.status(400).json({ error: "bookingId mancante" });
      }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking) {
        logger.error({ bookingId }, "Booking non trovato per il webhook");
        return res.status(404).json({ error: "Booking non trovato" });
      }

      // Idempotenza: se è già stato marcato, non rifare nulla
      if (booking.status === "PAID" || booking.status === "CONFIRMED") {
        logger.info({ bookingId }, "Booking già confermato, evento ignorato");
        return res.json({ received: true });
      }

      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "CONFIRMED",
          stripePaymentIntentId: session.payment_intent as string,
        },
      });

      logger.info({ bookingId }, "Booking confermato dopo pagamento");

      // Email di conferma: le aggiungeremo nella FASE 8
    }

    res.json({ received: true });
  }
);