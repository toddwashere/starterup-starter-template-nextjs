import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDisabledAdapter,
  resetDisabledAdapterWarning,
} from "./disabled";

describe("createDisabledAdapter", () => {
  beforeEach(() => {
    resetDisabledAdapterWarning();
  });

  it("returns a synthetic id and warns once per process", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createDisabledAdapter();

    const id1 = await adapter.publish("jobs", {
      event: "user.welcome-email",
      payload: { userId: "u1" },
    });
    const id2 = await adapter.publish("jobs", {
      event: "webhook.deliver",
      payload: { deliveryId: "d1" },
    });

    expect(id1).toBe("disabled");
    expect(id2).toBe("disabled");
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
