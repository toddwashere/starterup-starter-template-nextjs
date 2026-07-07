import { PrismaClient, Prisma } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { keys } from "../keys";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  const { DATABASE_URL } = keys();
  const max = Number(process.env.DATABASE_POOL_MAX ?? "5");
  const adapter = new PrismaPg({ connectionString: DATABASE_URL, max });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient, Prisma };
