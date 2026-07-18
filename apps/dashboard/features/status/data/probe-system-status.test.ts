import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@workspace/auth/keys", () => ({
  keys: () => ({ BETTER_AUTH_URL: "http://auth.test" }),
}));

import { prisma } from "@workspace/database";
import { getSystemStatus } from "./probe-system-status";

describe("getSystemStatus", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
  });

  it("probes database and auth then returns aggregated checks", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }]);
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 });

    const result = await getSystemStatus(fetchImpl, {
      RESEND_API_KEY: "re_abc",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://auth.test/api/auth/get-session",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.status).toBe("ready");
    expect(result.checks.map((c) => c.id)).toEqual([
      "database",
      "auth",
      "email",
    ]);
  });

  it("treats auth 5xx as unreachable", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }]);
    const fetchImpl = vi.fn().mockResolvedValue({ status: 503 });

    const result = await getSystemStatus(fetchImpl, {});
    expect(result.status).toBe("not-ready");
    expect(result.checks.find((c) => c.id === "auth")?.state).toBe("not-ready");
  });
});
