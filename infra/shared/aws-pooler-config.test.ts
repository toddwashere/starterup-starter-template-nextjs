import { describe, expect, it } from "vitest";
import { resolveAwsPoolerConfig } from "./aws-pooler-config";

describe("resolveAwsPoolerConfig", () => {
  it("derives names and accepts multiple individual addresses", () => {
    expect(
      resolveAwsPoolerConfig("sandbox", {
        rootDomain: "example.com",
        appEgressCidrs: "203.0.113.10/32, 203.0.113.11/32",
        developerCidrs:
          "198.51.100.10/32,198.51.100.11/32,198.51.100.12/32,198.51.100.13/32,198.51.100.14/32",
      }),
    ).toEqual({
      rootDomain: "example.com",
      zoneName: "sandbox.aws.example.com",
      hostname: "db.sandbox.aws.example.com",
      allowedCidrs: [
        { cidr: "203.0.113.10/32", source: "application" },
        { cidr: "203.0.113.11/32", source: "application" },
        { cidr: "198.51.100.10/32", source: "developer" },
        { cidr: "198.51.100.11/32", source: "developer" },
        { cidr: "198.51.100.12/32", source: "developer" },
        { cidr: "198.51.100.13/32", source: "developer" },
        { cidr: "198.51.100.14/32", source: "developer" },
      ],
    });
  });

  it("deduplicates repeated addresses within a source", () => {
    const result = resolveAwsPoolerConfig("sandbox", {
      rootDomain: "example.com",
      appEgressCidrs: "203.0.113.10/32, 203.0.113.10/32, 203.0.113.11/32",
      developerCidrs: "198.51.100.20/32,198.51.100.20/32",
    });

    expect(result.allowedCidrs).toEqual([
      { cidr: "203.0.113.10/32", source: "application" },
      { cidr: "203.0.113.11/32", source: "application" },
      { cidr: "198.51.100.20/32", source: "developer" },
    ]);
  });

  it.each([
    ["", "required"],
    ["https://example.com", "domain"],
    ["example.com.", "domain"],
  ])("rejects root domain %j", (rootDomain, message) => {
    expect(() =>
      resolveAwsPoolerConfig("sandbox", {
        rootDomain,
        appEgressCidrs: "203.0.113.10/32",
        developerCidrs: "",
      }),
    ).toThrow(message);
  });

  it.each(["0.0.0.0/0", "203.0.113.7", "203.0.113.7/33", "2001:db8::1/128", "203.0.113.7/24"])(
    "rejects unsafe or noncanonical CIDR %s",
    (cidr) => {
      expect(() =>
        resolveAwsPoolerConfig("sandbox", {
          rootDomain: "example.com",
          appEgressCidrs: cidr,
          developerCidrs: "",
        }),
      ).toThrow();
    },
  );
});
