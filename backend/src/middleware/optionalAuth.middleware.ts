import { Request, Response, NextFunction } from "express";
import { requireAuth } from "./auth.middleware";
import { syncAuth0User } from "./syncUser.middleware";

// Se c'è un token valido, identifica l'utente; se non c'è (o non è valido),
// prosegue come anonimo senza bloccare la richiesta.
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) return next();
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(); // token assente/scaduto: si procede da anonimi
    next();
  });
}

export async function optionalSyncUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.payload?.sub) return next();
  return syncAuth0User(req, res, next);
}