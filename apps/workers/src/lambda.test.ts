import { describe, it, expect, vi } from "vitest";

vi.mock("./handlers", () => ({
  handlers: {
    "user.welcome-email": vi.fn(async () => {}),
    "webhook.deliver": vi.fn(async () => { throw new Error("boom"); }),
  },
}));

import { handler } from "./lambda";

function record(id: string, event: string) {
  return { messageId: id, body: JSON.stringify({ event, payload: {} }) } as never;
}

describe("workers lambda", () => {
  it("acks all when handlers succeed", async () => {
    const res = await handler({ Records: [record("1", "user.welcome-email")] } as never);
    expect(res.batchItemFailures).toEqual([]);
  });

  it("reports only the failing record", async () => {
    const res = await handler({
      Records: [record("1", "user.welcome-email"), record("2", "webhook.deliver")],
    } as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "2" }]);
  });

  it("reports poison (invalid JSON) as a failure, not a drop", async () => {
    const res = await handler({ Records: [{ messageId: "3", body: "not-json" } as never] } as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "3" }]);
  });
});
