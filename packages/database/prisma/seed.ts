import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { seedBillingPlans } from "./seeds/seed-billing-plans";
import { seedDemoOrg } from "./seeds/seed-demo-org";
// Add optional modules under ./seeds and wire them below.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...\n");

  // Required — keep in all environments
  await seedBillingPlans(prisma);

  // Local demo + E2E (safe to comment out; do not run in prod)
  await seedDemoOrg(prisma);

  console.log("\nSeeding complete!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
