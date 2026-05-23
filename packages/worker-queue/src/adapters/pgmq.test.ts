import { describe, expect, it, vi } from "vitest";

import type { JobEnvelope } from "../types";

import { createPgmqAdapter, type Queryable } from "./pgmq";

/**
 * Build a mock Queryable so unit tests never touch a real database.
 * Tests assert on the exact SQL/params passed and the mapped return values.
 */
function mockDb() {
  return { query: vi.fn() } satisfies Queryable;
}

const envelope: JobEnvelope = {
  event: "user.welcome-email",
  payload: { userId: "u1" },
  enqueuedAt: "2026-05-23T00:00:00.000Z",
};

describe("PgmqAdapter.publish", () => {
  it("calls pgmq.send with the queue and serialized envelope, returning the msg id", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [{ msg_id: "42" }] });

    const adapter = createPgmqAdapter(db);
    const id = await adapter.publish("jobs", envelope);

    expect(id).toBe("42");
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("pgmq.send");
    expect(params).toEqual(["jobs", JSON.stringify(envelope)]);
  });

  it("normalizes a numeric msg_id to a string", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [{ msg_id: 42 }] });

    const adapter = createPgmqAdapter(db);
    const id = await adapter.publish("jobs", envelope);

    expect(id).toBe("42");
  });
});

describe("PgmqAdapter.receive", () => {
  it("reads with default visibility timeout and batch size, mapping rows to ReceivedMessage", async () => {
    const message = {
      event: "user.welcome-email",
      payload: { userId: "u1" },
    };
    const db = mockDb();
    db.query.mockResolvedValueOnce({
      rows: [{ msg_id: "7", read_ct: 2, message }],
    });

    const adapter = createPgmqAdapter(db);
    const received = await adapter.receive("jobs");

    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("pgmq.read");
    expect(params).toEqual(["jobs", 30, 1]);

    expect(received).toEqual([
      { msgId: "7", readCount: 2, envelope: message },
    ]);
  });

  it("passes custom visibilityTimeoutSeconds and batchSize through to pgmq.read", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [] });

    const adapter = createPgmqAdapter(db);
    await adapter.receive("jobs", {
      visibilityTimeoutSeconds: 60,
      batchSize: 5,
    });

    const [, params] = db.query.mock.calls[0]!;
    expect(params).toEqual(["jobs", 60, 5]);
  });

  it("normalizes a numeric msg_id from pgmq.read to a string", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({
      rows: [{ msg_id: 7, read_ct: 1, message: { event: "x", payload: {} } }],
    });

    const adapter = createPgmqAdapter(db);
    const received = await adapter.receive("jobs");

    expect(received[0]!.msgId).toBe("7");
  });
});

describe("PgmqAdapter.ack", () => {
  it("calls pgmq.delete with the queue and msg id", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [{ deleted: true }] });

    const adapter = createPgmqAdapter(db);
    await adapter.ack("jobs", "7");

    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("pgmq.delete");
    expect(params).toEqual(["jobs", "7"]);
  });
});

describe("PgmqAdapter.nack", () => {
  it("calls pgmq.set_vt with the provided retry delay", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [] });

    const adapter = createPgmqAdapter(db);
    await adapter.nack("jobs", "7", { delaySeconds: 15 });

    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("pgmq.set_vt");
    expect(params).toEqual(["jobs", "7", 15]);
  });

  it("defaults the retry delay to 0 seconds when none is provided", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [] });

    const adapter = createPgmqAdapter(db);
    await adapter.nack("jobs", "7");

    const [, params] = db.query.mock.calls[0]!;
    expect(params).toEqual(["jobs", "7", 0]);
  });
});

describe("PgmqAdapter.archive", () => {
  it("calls pgmq.archive with the queue and msg id", async () => {
    const db = mockDb();
    db.query.mockResolvedValueOnce({ rows: [{ archived: true }] });

    const adapter = createPgmqAdapter(db);
    await adapter.archive("jobs", "7");

    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("pgmq.archive");
    expect(params).toEqual(["jobs", "7"]);
  });
});
