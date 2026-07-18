import { describe, expect, it, vi } from "vitest";
import { fetchSystemStatus } from "./fetch-system-status";

describe("fetchSystemStatus", () => {
  it("returns the /api/status payload when valid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ready",
        checks: [
          {
            id: "database",
            label: "Database connection",
            state: "ready",
            message: "ok",
          },
        ],
      }),
    });

    await expect(fetchSystemStatus(fetchImpl)).resolves.toMatchObject({
      status: "ready",
      checks: [{ id: "database" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/status", {
      cache: "no-store",
    });
  });

  it("returns not-ready when the request fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    await expect(fetchSystemStatus(fetchImpl)).resolves.toMatchObject({
      status: "not-ready",
    });
  });
});
