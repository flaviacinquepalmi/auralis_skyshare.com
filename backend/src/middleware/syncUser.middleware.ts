import { Request, Response, NextFunction } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

declare global {
  namespace Express {
    interface Request {
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
    const email = (auth0Payload["email"] as string) || `${auth0Sub}@placeholder.local`;

    const user = await prisma.user.upsert({
      where: { auth0Sub },
      update: { email },
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
  } catch (err) {
    next(err);
  }
}