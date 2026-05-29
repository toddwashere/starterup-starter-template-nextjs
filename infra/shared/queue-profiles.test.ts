import { describe, it, expect } from "vitest";
import {
  QUEUE_PROFILES,
  getQueueProfile,
  type ProfileName,
} from "./queue-profiles";

describe("QUEUE_PROFILES", () => {
  it("defines exactly one adapter and consumer mode per profile", () => {
    const profiles = Object.keys(QUEUE_PROFILES) as ProfileName[];
    for (const name of profiles) {
      const profile = QUEUE_PROFILES[name];
      expect(profile.adapter).toBeTruthy();
      expect(profile.consumerMode).toBeTruthy();
    }
  });

  it("covers all six expected profiles", () => {
    const names = Object.keys(QUEUE_PROFILES);
    expect(names).toEqual(
      expect.arrayContaining(["local", "render", "vercel", "gcp", "aws", "azure"]),
    );
    expect(names).toHaveLength(6);
  });

  it("vercel uses drain consumer mode", () => {
    expect(QUEUE_PROFILES.vercel.consumerMode).toBe("drain");
  });

  it("render uses poll consumer mode", () => {
    expect(QUEUE_PROFILES.render.consumerMode).toBe("poll");
  });

  it("gcp uses pubsub adapter", () => {
    expect(QUEUE_PROFILES.gcp.adapter).toBe("pubsub");
  });

  it("aws uses sqs adapter", () => {
    expect(QUEUE_PROFILES.aws.adapter).toBe("sqs");
  });

  it("azure uses servicebus adapter", () => {
    expect(QUEUE_PROFILES.azure.adapter).toBe("servicebus");
  });

  it("local and render use bullmq adapter", () => {
    expect(QUEUE_PROFILES.local.adapter).toBe("bullmq");
    expect(QUEUE_PROFILES.render.adapter).toBe("bullmq");
  });

  it("vercel uses bullmq adapter", () => {
    expect(QUEUE_PROFILES.vercel.adapter).toBe("bullmq");
  });
});

describe("getQueueProfile", () => {
  it("returns the same object as direct lookup", () => {
    expect(getQueueProfile("gcp")).toBe(QUEUE_PROFILES.gcp);
    expect(getQueueProfile("local")).toBe(QUEUE_PROFILES.local);
  });
});
