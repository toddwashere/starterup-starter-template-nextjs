import { createServer, type Server } from "node:http";

let draining = false;

export function setDraining(value: boolean): void {
  draining = value;
}

export function isDraining(): boolean {
  return draining;
}

export interface HealthChecks {
  /** Resolve true if the dependency is reachable. Reject or false → 503. */
  checkDb?: () => Promise<boolean>;
  checkRedis?: () => Promise<boolean>;
}

export function startHealthServer(port: number, checks: HealthChecks = {}): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/ready") {
      if (draining) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "draining" }));
        return;
      }
      const dbOk = checks.checkDb ? await safeCheck(checks.checkDb) : true;
      const redisOk = checks.checkRedis ? await safeCheck(checks.checkRedis) : true;
      const ok = dbOk && redisOk;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: ok ? "ready" : "not-ready", db: dbOk, redis: redisOk }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, () => {
    console.log(`[workers] health server listening on :${port}`);
  });
  return server;
}

async function safeCheck(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}
