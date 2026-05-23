import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnqueue = vi.hoisted(() => vi.fn());

vi.mock("@workspace/worker-queue", () => ({ enqueue: mockEnqueue }));

import { enqueueWelcomeEmail } from "./welcome-email-hook";

describe("enqueueWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a user.welcome-email job with the userId", async () => {
    mockEnqueue.mockResolvedValueOnce(undefined);

    await enqueueWelcomeEmail("user_123");

    expect(mockEnqueue).toHaveBeenCalledOnce();
    expect(mockEnqueue).toHaveBeenCalledWith("user.welcome-email", {
      userId: "user_123",
    });
  });

  it("resolves without throwing when enqueue rejects (queue failure must not break signup)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockEnqueue.mockRejectedValueOnce(new Error("queue down"));

    await expect(enqueueWelcomeEmail("user_123")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });
});
