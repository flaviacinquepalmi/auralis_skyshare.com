import dotenv from "dotenv";

dotenv.config();

const requiredVars = ["PORT", "FRONTEND_URL"] as const;

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Variabile ambiente mancante: ${key}. Controlla il file .env`);
  }
}

export const env = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL as string,
  databaseUrl: process.env.DATABASE_URL || "",
  auth0Domain: process.env.AUTH0_DOMAIN || "",
  auth0Audience: process.env.AUTH0_AUDIENCE || "",
  auth0IssuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL || "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "",
  adminEmail: process.env.ADMIN_EMAIL || "",
};