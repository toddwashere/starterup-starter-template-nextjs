import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDraining, startHealthServer } from "./health";

async function get(
  server: Server,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: body ? JSON.parse(body) : {},
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function waitForListen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve();
    } else {
      server.once("listening", resolve);
    }
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("health server graceful shutdown", () => {
  let server: Server;

  beforeEach(() => {
    // Reset draining state before each test
    setDraining(false);
  });

  afterEach(async () => {
    setDraining(false);
    if (server?.listening) {
      await closeServer(server);
    }
  });

  it("/ready returns 200 by default (no checks, not draining)", async () => {
    server = startHealthServer(0);
    await waitForListen(server);

    const result = await get(server, "/ready");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ready" });
  });

  it("/ready returns 503 with status draining after setDraining(true)", async () => {
    server = startHealthServer(0);
    await waitForListen(server);

    setDraining(true);
    const result = await get(server, "/ready");

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: "draining" });
  });

  it("/ready returns 200 when both checkDb and checkRedis resolve true", async () => {
    server = startHealthServer(0, {
      checkDb: async () => true,
      checkRedis: async () => true,
    });
    await waitForListen(server);

    const result = await get(server, "/ready");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ready", db: true, redis: true });
  });

  it("/ready returns 503 if checkRedis resolves false", async () => {
    server = startHealthServer(0, {
      checkDb: async () => true,
      checkRedis: async () => false,
    });
    await waitForListen(server);

    const result = await get(server, "/ready");

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: "not-ready", db: true, redis: false });
  });

  it("/ready returns 503 if checkDb throws (caught by safeCheck)", async () => {
    server = startHealthServer(0, {
      checkDb: async () => {
        throw new Error("DB connection refused");
      },
      checkRedis: async () => true,
    });
    await waitForListen(server);

    const result = await get(server, "/ready");

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: "not-ready", db: false, redis: true });
  });

  it("/health always returns 200 regardless of draining", async () => {
    server = startHealthServer(0);
    await waitForListen(server);

    setDraining(true);
    const result = await get(server, "/health");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ok" });
  });

  it("setDraining(false) resets state so /ready returns 200 again", async () => {
    server = startHealthServer(0);
    await waitForListen(server);

    setDraining(true);
    const draining = await get(server, "/ready");
    expect(draining.status).toBe(503);

    setDraining(false);
    const ready = await get(server, "/ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: "ready" });
  });
});
