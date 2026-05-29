/**
 * Fetch-style handler for public-mcp — Vercel / Edge-compatible entry point.
 *
 * STATUS: STUB — returns 501 Not Implemented.
 *
 * WHY: `StreamableHTTPServerTransport.handleRequest()` from
 * `@modelcontextprotocol/sdk` is built for Node.js `IncomingMessage` /
 * `ServerResponse`. There is no official fetch-style adapter yet.
 *
 * Bridging approaches considered:
 *
 *   (A) Synthetic Node req/res shim — wraps a `Request` body as a Readable
 *       and captures `ServerResponse` writes into a `Response`. This is ~100+
 *       lines and brittle against SDK internals (piped streams, async chunks).
 *
 *   (B) `@vercel/node` raw handler — Vercel's `module.exports = (req, res)`
 *       pattern exposes Node `IncomingMessage`/`ServerResponse` directly and
 *       would work without a shim. However it requires a separate
 *       `vercel-node.ts` entrypoint and the `@vercel/node` build step.
 *
 * RECOMMENDED WORKAROUND for production:
 *   Run public-mcp as a long-lived service on Render, Railway, or Fly.io
 *   rather than as a Vercel serverless function. MCP sessions can be
 *   long-lived (streaming), which conflicts with Vercel's 10s function limit.
 *
 * TODO: Once @modelcontextprotocol/sdk ships a fetch-compatible transport
 * (tracked upstream), replace this stub with the real implementation.
 * Alternatively, implement option (B) above and document in infra/vercel/README.md.
 */

export async function createFetchHandler(_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: {
        code: "NOT_IMPLEMENTED",
        message:
          "MCP serverless adapter is not yet implemented. " +
          "Run public-mcp as a long-lived service (Render/Railway/Fly.io). " +
          "See infra/vercel/README.md for details.",
      },
    }),
    {
      status: 501,
      headers: { "content-type": "application/json" },
    },
  );
}
