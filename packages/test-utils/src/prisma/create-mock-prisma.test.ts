import { describe, it, expect, vi } from "vitest";
import { createMockPrisma } from "./create-mock-prisma";

describe("createMockPrisma", () => {
  it("returns nested model delegates with vi.fn methods", () => {
    const prisma = createMockPrisma();
    expect(prisma.contact.findMany).toBeTypeOf("function");
    expect(vi.isMockFunction(prisma.contact.findMany)).toBe(true);
  });

  it("applies per-model overrides", async () => {
    const prisma = createMockPrisma({
      contact: {
        findMany: vi.fn().mockResolvedValue([{ id: "contact_x" }]),
      },
    });
    const rows = await prisma.contact.findMany();
    expect(rows).toEqual([{ id: "contact_x" }]);
  });
});
