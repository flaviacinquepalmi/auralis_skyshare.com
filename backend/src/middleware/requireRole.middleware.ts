import { Request, Response, NextFunction } from "express";

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const dbUser = req.dbUser;
    if (!dbUser) {
      return res.status(401).json({ error: "Non autenticato" });
    }
    if (!allowedRoles.includes(dbUser.role)) {
      return res.status(403).json({ error: "Accesso negato per questo ruolo" });
    }
    next();
  };
}