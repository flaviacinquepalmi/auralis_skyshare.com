import { auth } from "express-oauth2-jwt-bearer";
import { env } from "../config/env";

export const requireAuth = auth({
  audience: env.auth0Audience,
  issuerBaseURL: env.auth0IssuerBaseUrl,
});