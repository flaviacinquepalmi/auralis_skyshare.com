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

export const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
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

app.use("/api/operator", operatorRouter);

app.use("/api/admin", adminRouter);

app.use(errorMiddleware);