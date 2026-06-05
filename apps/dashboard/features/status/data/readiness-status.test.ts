import { describe, expect, it, vi } from "vitest";
import { getDatabaseReadinessStatus } from "./readiness-status";

describe("getDatabaseReadinessStatus", () => {
  it("reports the database as connected when /api/ready returns ready", async () => {
    const fetchReady = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ready", db: true }),
    });

    await expect(getDatabaseReadinessStatus(fetchReady)).resolves.toMatchObject({
      databaseConnected: true,
      status: "ready",
    });
  });

  it("reports the database as disconnected when /api/ready fails", async () => {
    const fetchNotReady = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ status: "not-ready", db: false }),
    });

    await expect(
      getDatabaseReadinessStatus(fetchNotReady),
    ).resolves.toMatchObject({
      databaseConnected: false,
      status: "not-ready",
    });
  });
});
