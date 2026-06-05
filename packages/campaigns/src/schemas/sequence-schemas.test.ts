import { describe, expect, it } from "vitest";
import { CreateEmailSequenceStepSchema, delayPresetToMinutes } from "./sequence-schemas";

describe("CreateEmailSequenceStepSchema", () => {
  it("accepts registry steps with template props", () => {
    const result = CreateEmailSequenceStepSchema.safeParse({
      sortOrder: 0,
      delayMinutes: 0,
      contentSource: "registry",
      templateKey: "nurture-intro",
      subjectTemplate: "Hello",
      templateProps: { bodyIntro: "Hi" },
    });
    expect(result.success).toBe(true);
  });

  it("requires composedBodyHtml and editorDocument for editor steps", () => {
    const result = CreateEmailSequenceStepSchema.safeParse({
      sortOrder: 0,
      delayMinutes: 1440,
      contentSource: "editor",
      subjectTemplate: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("accepts editor steps with composed content", () => {
    const result = CreateEmailSequenceStepSchema.safeParse({
      sortOrder: 0,
      delayMinutes: 1440,
      contentSource: "editor",
      subjectTemplate: "Hello",
      editorDocument: { type: "doc", content: [] },
      composedBodyHtml: "<p>Hi</p>",
      composedBodyText: "Hi",
    });
    expect(result.success).toBe(true);
  });
});

describe("delayPresetToMinutes", () => {
  it("maps presets to minutes", () => {
    expect(delayPresetToMinutes("1_day", 0)).toBe(1440);
    expect(delayPresetToMinutes("custom", 90)).toBe(90);
  });
});
