import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorMiddleware(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error({ err }, "Errore non gestito");

  const status = err.status || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "Si è verificato un errore interno."
      : err.message || "Errore sconosciuto";

  res.status(status).json({ error: message });
}