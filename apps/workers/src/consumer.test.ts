import type {
  PgmqConsumer,
  ReceivedMessage,
} from "@workspace/worker-queue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeBackoffSeconds,
  type ConsumerConfig,
  type ConsumerDeps,
  pollOnce,
  processMessage,
  startConsumer,
} from "./consumer";
import type { HandlerRegistry } from "./registry";

const QUEUE = "jobs";

function makeAdapter(): PgmqConsumer {
  return {
    receive: vi.fn(async () => []),
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
  };
}

function makeRegistry(
  overrides: Partial<HandlerRegistry> = {},
): HandlerRegistry {
  return {
    "user.welcome-email": vi.fn(async () => {}),
    "cleanup.expired-sessions": vi.fn(async () => {}),
    "webhook.deliver": vi.fn(async () => {}),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ConsumerConfig> = {}): ConsumerConfig {
  return {
    queue: QUEUE,
    maxAttempts: 5,
    pollIntervalMs: 1000,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ReceivedMessage> = {}): ReceivedMessage {
  return {
    msgId: "1",
    readCount: 1,
    envelope: {
      event: "user.welcome-email",
      payload: { userId: "u1" },
    },
    ...overrides,
  };
}

describe("computeBackoffSeconds", () => {
  it("grows exponentially from a small base", () => {
    expect(computeBackoffSeconds(1)).toBe(2);
    expect(computeBackoffSeconds(2)).toBe(4);
    expect(computeBackoffSeconds(3)).toBe(8);
    expect(computeBackoffSeconds(4)).toBe(16);
  });

  it("caps at the maximum backoff", () => {
    expect(computeBackoffSeconds(20)).toBe(300);
  });
});

describe("processMessage", () => {
  let adapter: PgmqConsumer;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  it("acks on handler success and does not nack/archive", async () => {
    const registry = makeRegistry();
    const deps: ConsumerDeps = { adapter, registry, config: makeConfig() };

    await processMessage(deps, makeMessage({ msgId: "42" }));

    expect(adapter.ack).toHaveBeenCalledTimes(1);
    expect(adapter.ack).toHaveBeenCalledWith(QUEUE, "42");
    expect(adapter.nack).not.toHaveBeenCalled();
    expect(adapter.archive).not.toHaveBeenCalled();
  });

  it("dispatches the validated payload to the correct handler", async () => {
    const welcome = vi.fn(async () => {});
    const registry = makeRegistry({ "user.welcome-email": welcome });
    const deps: ConsumerDeps = { adapter, registry, config: makeConfig() };

    await processMessage(
      deps,
      makeMessage({
        envelope: { event: "user.welcome-email", payload: { userId: "u1" } },
      }),
    );

    expect(welcome).toHaveBeenCalledTimes(1);
    expect(welcome).toHaveBeenCalledWith({ userId: "u1" });
    expect(registry["webhook.deliver"]).not.toHaveBeenCalled();
  });

  it("nacks with backoff when the handler fails below maxAttempts", async () => {
    const welcome = vi.fn(async () => {
      throw new Error("boom");
    });
    const registry = makeRegistry({ "user.welcome-email": welcome });
    const deps: ConsumerDeps = {
      adapter,
      registry,
      config: makeConfig({ maxAttempts: 5 }),
    };

    await processMessage(deps, makeMessage({ msgId: "7", readCount: 1 }));

    expect(adapter.nack).toHaveBeenCalledTimes(1);
    expect(adapter.nack).toHaveBeenCalledWith(QUEUE, "7", {
      delaySeconds: computeBackoffSeconds(1),
    });
    expect(adapter.ack).not.toHaveBeenCalled();
    expect(adapter.archive).not.toHaveBeenCalled();
  });

  it("archives when the handler fails at maxAttempts", async () => {
    const welcome = vi.fn(async () => {
      throw new Error("boom");
    });
    const registry = makeRegistry({ "user.welcome-email": welcome });
    const deps: ConsumerDeps = {
      adapter,
      registry,
      config: makeConfig({ maxAttempts: 5 }),
    };

    await processMessage(deps, makeMessage({ msgId: "9", readCount: 5 }));

    expect(adapter.archive).toHaveBeenCalledTimes(1);
    expect(adapter.archive).toHaveBeenCalledWith(QUEUE, "9");
    expect(adapter.nack).not.toHaveBeenCalled();
    expect(adapter.ack).not.toHaveBeenCalled();
  });

  it("archives a poison message and never calls a handler", async () => {
    const registry = makeRegistry();
    const deps: ConsumerDeps = { adapter, registry, config: makeConfig() };

    await processMessage(
      deps,
      makeMessage({
        msgId: "13",
        envelope: {
          event: "does.not.exist",
          payload: {},
        } as ReceivedMessage["envelope"],
      }),
    );

    expect(adapter.archive).toHaveBeenCalledTimes(1);
    expect(adapter.archive).toHaveBeenCalledWith(QUEUE, "13");
    expect(adapter.ack).not.toHaveBeenCalled();
    expect(adapter.nack).not.toHaveBeenCalled();
    expect(registry["user.welcome-email"]).not.toHaveBeenCalled();
  });

  it("archives a message with a valid event but invalid payload (poison)", async () => {
    const registry = makeRegistry();
    const deps: ConsumerDeps = { adapter, registry, config: makeConfig() };

    await processMessage(
      deps,
      makeMessage({
        msgId: "14",
        envelope: {
          event: "user.welcome-email",
          payload: {}, // missing userId -> zod fails
        },
      }),
    );

    expect(adapter.archive).toHaveBeenCalledTimes(1);
    expect(adapter.archive).toHaveBeenCalledWith(QUEUE, "14");
    expect(registry["user.welcome-email"]).not.toHaveBeenCalled();
  });

  it("does not let a handler error escape", async () => {
    const registry = makeRegistry({
      "user.welcome-email": vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const deps: ConsumerDeps = { adapter, registry, config: makeConfig() };

    await expect(
      processMessage(deps, makeMessage()),
    ).resolves.toBeUndefined();
  });
});

describe("pollOnce", () => {
  it("processes every received message and returns the count", async () => {
    const adapter = makeAdapter();
    vi.mocked(adapter.receive).mockResolvedValue([
      makeMessage({ msgId: "1" }),
      makeMessage({ msgId: "2" }),
    ]);
    const registry = makeRegistry();
    const deps: ConsumerDeps = { adapter, registry, config: makeConfig() };

    const count = await pollOnce(deps);

    expect(count).toBe(2);
    expect(adapter.ack).toHaveBeenCalledTimes(2);
    expect(adapter.ack).toHaveBeenCalledWith(QUEUE, "1");
    expect(adapter.ack).toHaveBeenCalledWith(QUEUE, "2");
  });

  it("passes receiveOptions through to the adapter", async () => {
    const adapter = makeAdapter();
    const registry = makeRegistry();
    const receiveOptions = { batchSize: 10, visibilityTimeoutSeconds: 60 };
    const deps: ConsumerDeps = {
      adapter,
      registry,
      config: makeConfig({ receiveOptions }),
    };

    await pollOnce(deps);

    expect(adapter.receive).toHaveBeenCalledWith(QUEUE, receiveOptions);
  });
});

describe("startConsumer", () => {
  it("stops when the AbortSignal is aborted", async () => {
    const adapter = makeAdapter();
    const registry = makeRegistry();
    const deps: ConsumerDeps = {
      adapter,
      registry,
      config: makeConfig({ pollIntervalMs: 10 }),
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      startConsumer(deps, controller.signal),
    ).resolves.toBeUndefined();
  });
});
