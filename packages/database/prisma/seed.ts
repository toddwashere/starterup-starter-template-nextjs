import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...\n");

  const passwordHash = await hashPassword("password123");

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      name: "Admin User",
      email: "admin@example.com",
      emailVerified: true,
      role: "admin",
    },
  });
  console.log("Created admin user:", adminUser.email);

  // Create credential account for admin
  await prisma.account.upsert({
    where: {
      providerId_accountId: {
        providerId: "credential",
        accountId: adminUser.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      providerId: "credential",
      accountId: adminUser.id,
      password: passwordHash,
    },
  });

  // Create regular user
  const regularUser = await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: {},
    create: {
      name: "Regular User",
      email: "user@example.com",
      emailVerified: true,
      role: "user",
    },
  });
  console.log("Created regular user:", regularUser.email);

  // Create credential account for regular user
  await prisma.account.upsert({
    where: {
      providerId_accountId: {
        providerId: "credential",
        accountId: regularUser.id,
      },
    },
    update: {},
    create: {
      userId: regularUser.id,
      providerId: "credential",
      accountId: regularUser.id,
      password: passwordHash,
    },
  });

  // Create organization
  const org = await prisma.organization.upsert({
    where: { slug: "acme-inc" },
    update: {},
    create: {
      name: "Acme Inc",
      slug: "acme-inc",
    },
  });
  console.log("Created organization:", org.name, `(/${org.slug})`);

  // Add admin as owner
  await prisma.member.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: adminUser.id,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: adminUser.id,
      role: "owner",
    },
  });
  console.log("Added admin as owner of", org.name);

  // Add regular user as member
  await prisma.member.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: regularUser.id,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: regularUser.id,
      role: "member",
    },
  });
  console.log("Added regular user as member of", org.name);

  // Default contact stages for the demo org
  const defaultStages = [
    { name: "New", color: "#6366f1", sortOrder: 0, isDefault: true },
    { name: "Active", color: "#22c55e", sortOrder: 1, isDefault: false },
    { name: "Nurturing", color: "#f59e0b", sortOrder: 2, isDefault: false },
    { name: "Customer", color: "#3b82f6", sortOrder: 3, isDefault: false },
    { name: "Partner", color: "#8b5cf6", sortOrder: 4, isDefault: false },
    { name: "Inactive", color: "#94a3b8", sortOrder: 5, isDefault: false },
  ];

  for (const stage of defaultStages) {
    const stageId = `cstage_${stage.name.toLowerCase()}`;
    await prisma.contactStage.upsert({
      where: { organizationId_name: { organizationId: org.id, name: stage.name } },
      update: {},
      create: { id: stageId, organizationId: org.id, ...stage },
    });
    console.log(`Upserted stage: ${stage.name}`);
  }

  // Default contact task statuses for the demo org
  const defaultTaskStatuses = [
    { name: "To Do", color: "#94a3b8", sortOrder: 0, isDefault: true, isTerminal: false },
    { name: "In Progress", color: "#3b82f6", sortOrder: 1, isDefault: false, isTerminal: false },
    { name: "Done", color: "#22c55e", sortOrder: 2, isDefault: false, isTerminal: true },
  ];

  for (const status of defaultTaskStatuses) {
    const statusId = `ctstatus_${status.name.toLowerCase().replace(/ /g, "_")}`;
    await prisma.contactTaskStatus.upsert({
      where: { organizationId_name: { organizationId: org.id, name: status.name } },
      update: {},
      create: { id: statusId, organizationId: org.id, ...status },
    });
    console.log(`Upserted task status: ${status.name}`);
  }

  // Billing plans. Replace the placeholder price IDs with real Stripe test-mode
  // price IDs, or set STRIPE_PRICE_* env vars, before Checkout will work.
  const billingPlans = [
    { id: "bplan_free", name: "free", displayName: "Free", stripePriceIdMonthly: "", stripePriceIdAnnual: null, limits: { contacts: 50 }, freeTrialDays: null, isActive: true, sortOrder: 0 },
    { id: "bplan_pro", name: "pro", displayName: "Pro", stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "price_pro_monthly_placeholder", stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null, limits: { contacts: 1000 }, freeTrialDays: 14, isActive: true, sortOrder: 1 },
    { id: "bplan_team", name: "team", displayName: "Team", stripePriceIdMonthly: process.env.STRIPE_PRICE_TEAM_MONTHLY ?? "price_team_monthly_placeholder", stripePriceIdAnnual: null, limits: { contacts: 5000, seats: 10 }, freeTrialDays: null, isActive: true, sortOrder: 2 },
  ];
  for (const plan of billingPlans) {
    const { id, name, ...rest } = plan;
    await prisma.billingPlan.upsert({
      where: { name },
      update: rest,
      create: { id, name, ...rest },
    });
    console.log(`Upserted billing plan: ${name}`);
  }

  console.log("\nSeeding complete!");
  console.log("\nCredentials:");
  console.log("  Admin: admin@example.com / password123");
  console.log("  User:  user@example.com / password123");
  console.log("  Org:   /acme-inc");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
