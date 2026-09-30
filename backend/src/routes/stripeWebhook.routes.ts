import { ensureBookingNotifications } from "../services/bookingNotifications.service";
import { recordPaidCheckout } from "../services/checkoutState.service";
import { refundBookingPayments, expirePendingCheckoutSessions } from "../services/payments.service";
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

    try {
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.bookingId;
        const bookingPaymentId = session.metadata?.bookingPaymentId;

        if (!bookingId) {
          logger.error("Nessun bookingId nei metadata della sessione Stripe");
          return res.status(400).json({ error: "bookingId mancante" });
        }

        // checkout.session.completed puo' arrivare prima dell'effettivo incasso
        // per metodi di pagamento asincroni. In quel caso aspettiamo
        // checkout.session.async_payment_succeeded prima di segnare il booking come pagato.
        if (event.type === "checkout.session.completed" && session.payment_status === "unpaid") {
          logger.info({ bookingId }, "Checkout completato ma pagamento ancora pendente");
          return res.json({ received: true });
        }

        const result = await recordPaidCheckout(prisma, session);
        if (result.terminal) await refundBookingPayments(bookingId, "late_payment_after_terminal_booking");
        await ensureBookingNotifications(prisma, bookingId);
        return res.json({ received: true });
      }

      if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.bookingId;
        const bookingPaymentId = session.metadata?.bookingPaymentId;
        if (!bookingId) return res.json({ received: true });

        const initial = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!initial) return res.json({ received: true });
        const booking = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.emptyLegId}))`;
          const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { emptyLeg: true } });
          if (current.status === "PAID" || current.status === "CONFIRMED") return null;
          if (current.bookingType === "SPLIT") {
            if (!bookingPaymentId) throw new Error("Metadata quota mancante");
            const payment = await tx.bookingPayment.findUnique({ where: { id: bookingPaymentId } });
            if (!payment || payment.bookingId !== bookingId ||
                (payment.stripeCheckoutSessionId && payment.stripeCheckoutSessionId !== session.id)) throw new Error("Sessione non associata alla quota");
            if (current.status === "PENDING_PAYMENT" && payment.status !== "PENDING") return null;
            await tx.bookingPayment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "EXPIRED" } });
          } else if (bookingPaymentId || (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== session.id)) {
            throw new Error("Sessione non associata alla prenotazione");
          }
          await tx.booking.updateMany({ where: { id: bookingId, status: "PENDING_PAYMENT" }, data: { status: "EXPIRED" } });
          return current;
        });
        if (!booking) return res.json({ received: true });
        // Close locally BEFORE external calls; a concurrent successful payment is now refunded.
        // On retry, terminal bookings still reach cleanup and refunds.
        await expirePendingCheckoutSessions(bookingId);
        await refundBookingPayments(bookingId, "checkout_session_expired");

        await ensureBookingNotifications(prisma, bookingId);

        return res.json({ received: true });
      }

      return res.json({ received: true });
    } catch (err) {
      logger.error({ err, type: event.type }, "Errore gestione webhook Stripe");
      return res.status(500).json({ error: "Errore gestione webhook" });
    }
  }
);
