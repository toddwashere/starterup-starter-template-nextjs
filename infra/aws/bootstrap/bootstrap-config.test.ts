import { describe, expect, it } from "vitest";
import {
  buildAppReleaseAssumeRolePolicy,
  validatedGithubRepo,
} from "./bootstrap-config";

describe("validatedGithubRepo", () => {
  it("accepts owner/repo", () => {
    expect(validatedGithubRepo("example-org/platform")).toBe(
      "example-org/platform",
    );
  });

  it("rejects missing or malformed values", () => {
    expect(() => validatedGithubRepo(undefined)).toThrow(/githubRepo/);
    expect(() => validatedGithubRepo("not-a-repo")).toThrow(/owner\/repo/);
    expect(() => validatedGithubRepo("", "customKey")).toThrow(/customKey/);
  });
});


describe("buildAppReleaseAssumeRolePolicy", () => {
  const providerArn =
    "arn:aws:iam::123:oidc-provider/token.actions.githubusercontent.com";

  it("scopes OIDC trust to platform staging-aws environment", () => {
    const doc = JSON.parse(
      buildAppReleaseAssumeRolePolicy({
        providerArn,
        githubRepo: "example-org/platform",
        environment: "staging",
      }),
    ) as {
      Statement: Array<{ Condition: { StringEquals: Record<string, string> } }>;
    };

    expect(doc.Statement[0]?.Condition.StringEquals).toEqual({
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub":
        "repo:example-org/platform:environment:staging-aws",
    });

    // Scoped by environment claim on purpose — not a branch/tag (`:ref:`) or
    // wildcard (`:*`) claim, which would let any ref release.
    const raw = JSON.stringify(doc);
    expect(raw).not.toContain(":ref:");
    expect(raw).not.toContain(":*");
  });

  it("uses production-aws for production", () => {
    const doc = JSON.parse(
      buildAppReleaseAssumeRolePolicy({
        providerArn,
        githubRepo: "example-org/platform",
        environment: "production",
      }),
    ) as {
      Statement: Array<{ Condition: { StringEquals: Record<string, string> } }>;
    };

    expect(
      doc.Statement[0]?.Condition.StringEquals[
        "token.actions.githubusercontent.com:sub"
      ],
    ).toBe("repo:example-org/platform:environment:production-aws");
  });

  it("trusts only the passed OIDC provider via AssumeRoleWithWebIdentity", () => {
    const doc = JSON.parse(
      buildAppReleaseAssumeRolePolicy({
        providerArn,
        githubRepo: "example-org/platform",
        environment: "staging",
      }),
    ) as {
      Statement: Array<{
        Action: string;
        Effect: string;
        Principal: { Federated: string };
      }>;
    };

    expect(doc.Statement).toHaveLength(1);
    expect(doc.Statement[0]?.Effect).toBe("Allow");
    expect(doc.Statement[0]?.Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(doc.Statement[0]?.Principal.Federated).toBe(providerArn);
  });
});
