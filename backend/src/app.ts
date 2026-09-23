import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { healthRouter } from "./routes/health.routes";
import { meRouter } from "./routes/me.routes";
import { emptyLegsRouter } from "./routes/emptyLegs.routes";
import { errorMiddleware } from "./middleware/error.middleware";
import { bookingsRouter } from "./routes/bookings.routes";
import { stripeWebhookRouter } from "./routes/stripeWebhook.routes";
import { myBookingsRouter } from "./routes/myBookings.routes";
import { operatorRouter } from "./routes/operator.routes";
import { adminRouter } from "./routes/admin.routes";
import { contactRequestsRouter } from "./routes/contactRequests.routes";
import { flightRequestsRouter } from "./routes/flightRequests.routes";

import { myFlightRequestsRouter } from "./routes/myFlightRequests.routes";
import { newsletterRouter } from "./routes/newsletter.routes";

export const app = express();
app.set("trust proxy", 1);

app.use(helmet());
const allowedOrigins = [
  "https://auralisair.it",
  "https://auralis-skyshare-com.vercel.app",
  env.frontendUrl,
].map((origin) => origin.replace(/\/$/, ""));

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (for example server-to-server
      // calls and direct browser navigation) are allowed.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/$/, "");

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin non consentita da CORS: ${origin}`));
    },
  })
);
app.use("/api/webhooks/stripe", stripeWebhookRouter);
app.use(express.json());
app.use(pinoHttp({ logger }));

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(publicLimiter);

app.use("/api/health", healthRouter);
app.use("/api/me", meRouter);

app.use("/api/empty-legs", emptyLegsRouter);

app.use("/api/bookings", bookingsRouter);
app.use("/api/my/bookings", myBookingsRouter);
app.use("/api/my/flight-requests", myFlightRequestsRouter);

app.use("/api/operator", operatorRouter);

app.use("/api/admin", adminRouter);

app.use("/api/contact-requests", contactRequestsRouter);
app.use("/api/flight-requests", flightRequestsRouter);
app.use("/api/newsletter", newsletterRouter);

app.use(errorMiddleware);
