import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";

/**
 * Local demo tenant + E2E login world.
 * Safe to comment out in seed.ts. Do not run in production.
 */
export async function seedDemoOrg(prisma: PrismaClient) {
  const passwordHash = await hashPassword("password123");

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

  const org = await prisma.organization.upsert({
    where: { slug: "acme-inc" },
    update: {},
    create: {
      name: "Acme Inc",
      slug: "acme-inc",
    },
  });
  console.log("Created organization:", org.name, `(/${org.slug})`);

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

  console.log("\nDemo credentials:");
  console.log("  Admin: admin@example.com / password123");
  console.log("  User:  user@example.com / password123");
  console.log("  Org:   /acme-inc");

  return { adminUser, regularUser, org };
}
