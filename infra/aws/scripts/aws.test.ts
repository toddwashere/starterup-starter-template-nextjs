import { describe, expect, it } from "vitest";
import { withRefresh } from "./aws";

/**
 * Guards the fix for a real incident: a local `pnpm infra:aws apps up` rolled
 * every staging App Runner service back to an older image, because Pulumi sends
 * the whole `sourceConfiguration` from STATE and the state predated the last
 * release. `ignoreChanges` on the image does not prevent that -- refreshing
 * first does.
 */
describe("withRefresh", () => {
  it("adds --refresh to `up`, immediately after the command", () => {
    expect(withRefresh(["up", "--stack", "production", "--yes"])).toEqual([
      "up",
      "--refresh",
      "--stack",
      "production",
      "--yes",
    ]);
  });

  it("leaves read-only commands alone", () => {
    for (const command of ["preview", "refresh", "stack", "config"]) {
      expect(withRefresh([command, "--stack", "staging"])).toEqual([
        command,
        "--stack",
        "staging",
      ]);
    }
  });

  it("does not double up when --refresh is already present", () => {
    expect(withRefresh(["up", "--refresh", "--yes"])).toEqual([
      "up",
      "--refresh",
      "--yes",
    ]);
  });

  it("honours an explicit --skip-refresh escape hatch", () => {
    // Deliberately applying state-as-written is a legitimate, rare choice; it
    // just must be explicit rather than the default.
    expect(withRefresh(["up", "--skip-refresh", "--yes"])).toEqual([
      "up",
      "--skip-refresh",
      "--yes",
    ]);
  });

  it("returns a copy rather than mutating the caller's array", () => {
    const args = ["up", "--yes"];
    const out = withRefresh(args);
    expect(args).toEqual(["up", "--yes"]);
    expect(out).not.toBe(args);
  });

  it("handles an empty argument list", () => {
    expect(withRefresh([])).toEqual([]);
  });
});
