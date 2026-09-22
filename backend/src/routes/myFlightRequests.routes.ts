import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { customerFlightRequests, verifiedRequestEmail } from "../services/flightRequests.service";
import { logger } from "../utils/logger";

export const myFlightRequestsRouter = Router();
myFlightRequestsRouter.get("/", requireAuth, async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sub = req.auth?.payload.sub;
    if (!sub) return res.status(401).json({ error: "Accedi per consultare le richieste." });
    let email: string | null = null;
    let identityWarning = "";
    try {
      email = await verifiedRequestEmail(req.headers.authorization!, sub);
      if (!email) identityWarning = "Verifica l’email del tuo account per recuperare anche le richieste inviate prima dell’accesso, poi esci e rientra.";
    } catch (error) {
      logger.warn({ error }, "Verifica email non disponibile; mostro solo le richieste già associate all’account");
      identityWarning = "Non è stato possibile recuperare le richieste precedenti tramite email. Riprova tra poco.";
    }
    const result = await customerFlightRequests(sub, email);
    if (identityWarning) result.warnings.unshift(identityWarning);
    return res.json(result);
  } catch (error) { next(error); }
});
