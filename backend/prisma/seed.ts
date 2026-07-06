import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@auralis-demo.local" },
    update: {},
    create: {
      auth0Sub: "seed|admin-placeholder",
      email: "admin@auralis-demo.local",
      firstName: "Admin",
      lastName: "Demo",
      role: "ADMIN",
    },
  });

  const operatorUser = await prisma.user.upsert({
    where: { email: "operator@auralis-demo.local" },
    update: {},
    create: {
      auth0Sub: "seed|operator-placeholder",
      email: "operator@auralis-demo.local",
      firstName: "Operatore",
      lastName: "Demo",
      role: "OPERATOR",
    },
  });

  const operator = await prisma.operator.upsert({
    where: { userId: operatorUser.id },
    update: {},
    create: {
      userId: operatorUser.id,
      companyName: "Demo Air Charter",
      contactEmail: "operator@auralis-demo.local",
      status: "APPROVED",
    },
  });

  const aircraft1 = await prisma.aircraft.create({
    data: {
      operatorId: operator.id,
      manufacturer: "Cessna",
      model: "Citation CJ2+",
      maxPax: 6,
    },
  });

  const aircraft2 = await prisma.aircraft.create({
    data: {
      operatorId: operator.id,
      manufacturer: "Embraer",
      model: "Phenom 300",
      maxPax: 8,
    },
  });

  const now = new Date();
  const routes = [
    { from: "LIN", to: "OLB", days: 3, dur: 75, pax: 6, price: 8500, saving: 35, aircraftId: aircraft1.id },
    { from: "FCO", to: "NCE", days: 5, dur: 60, pax: 4, price: 6200, saving: 28, aircraftId: aircraft1.id },
    { from: "MXP", to: "IBZ", days: 7, dur: 95, pax: 8, price: 11000, saving: 40, aircraftId: aircraft2.id },
    { from: "VCE", to: "GVA", days: 10, dur: 55, pax: 6, price: 5800, saving: 22, aircraftId: aircraft1.id },
    { from: "NAP", to: "CTA", days: 14, dur: 45, pax: 8, price: 4200, saving: 30, aircraftId: aircraft2.id },
  ];

  for (const r of routes) {
    const departureAt = new Date(now.getTime() + r.days * 24 * 60 * 60 * 1000);
    await prisma.emptyLeg.create({
      data: {
        operatorId: operator.id,
        aircraftId: r.aircraftId,
        fromAirport: r.from,
        toAirport: r.to,
        departureAt,
        durationMin: r.dur,
        availablePax: r.pax,
        priceTotal: r.price,
        savingPct: r.saving,
        status: "PUBLISHED",
      },
    });
  }

  console.log("Seed completato:", { admin: admin.email, operator: operator.companyName });
}

main()
  .catch((e) => {
    console.error("Errore durante il seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });