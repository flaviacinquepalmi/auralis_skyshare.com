import { verifiedIdentityEmail } from "../services/identity.service";
import { logger } from "../utils/logger";
import { Request, Response, NextFunction } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

declare global {
  namespace Express {
    interface Request {
      identityWarning?: string;
      dbUser?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

export async function syncAuth0User(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const auth0Payload = req.auth?.payload;
    if (!auth0Payload || !auth0Payload.sub) {
      return res.status(401).json({ error: "Token non valido" });
    }

    const auth0Sub = auth0Payload.sub as string;
    let verifiedEmail: string | null = null;
    try {
      verifiedEmail = await verifiedIdentityEmail(req.headers.authorization || "", auth0Sub, auth0Payload);
      if (!verifiedEmail) req.identityWarning = "Verifica l'email del tuo account per completare il profilo.";
    } catch (_error) {
      logger.warn({ auth0Sub }, "Recupero email verificata Auth0 temporaneamente non disponibile");
      req.identityWarning = "Email account non aggiornata: riprova tra poco.";
    }
    if (verifiedEmail) {
      const owner = await prisma.user.findUnique({ where: { email: verifiedEmail }, select: { auth0Sub: true } });
      if (owner && owner.auth0Sub !== auth0Sub) {
        // A verified email alone is not permission to merge Auth0 identities or roles.
        verifiedEmail = null;
        req.identityWarning = "Questo indirizzo è associato a un altro account. Contatta Auralis per collegarli.";
      }
    }
    const email = verifiedEmail || `${auth0Sub}@placeholder.local`;

    const user = await prisma.user.upsert({
      where: { auth0Sub },
      update: verifiedEmail ? { email: verifiedEmail } : {},
      create: {
        auth0Sub,
        email,
        role: "CUSTOMER",
      },
    });

    req.dbUser = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Identità già associata a un account. Riprova o contatta Auralis." });
    next(err);
  }
}