import { z } from "zod";

export const SequenceKindSchema = z.enum(["campaign", "follow_up"]);
export type SequenceKind = z.infer<typeof SequenceKindSchema>;

export const SequenceStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export type SequenceStatus = z.infer<typeof SequenceStatusSchema>;

export const StepContentSourceSchema = z.enum(["registry", "editor"]);
export type StepContentSource = z.infer<typeof StepContentSourceSchema>;

export const CreateEmailSequenceSchema = z.object({
  kind: SequenceKindSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  status: SequenceStatusSchema.optional(),
});

export const UpdateEmailSequenceSchema = CreateEmailSequenceSchema.partial();

export type CreateEmailSequenceInput = z.infer<typeof CreateEmailSequenceSchema>;
export type UpdateEmailSequenceInput = z.infer<typeof UpdateEmailSequenceSchema>;

const EmailSequenceStepBaseSchema = z.object({
  sortOrder: z.number().int().min(0),
  delayMinutes: z.number().int().min(0).default(0),
  contentSource: StepContentSourceSchema.default("registry"),
  templateKey: z.string().min(1).default("nurture-intro"),
  subjectTemplate: z.string().min(1),
  templateProps: z.record(z.unknown()).optional(),
  editorDocument: z.unknown().optional(),
  composedBodyHtml: z.string().optional(),
  composedBodyText: z.string().optional(),
});

export const CreateEmailSequenceStepSchema = EmailSequenceStepBaseSchema.superRefine(
  (data, ctx) => {
    if (data.contentSource === "editor") {
      if (!data.composedBodyHtml?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Editor steps require composedBodyHtml",
          path: ["composedBodyHtml"],
        });
      }
      if (!data.editorDocument) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Editor steps require editorDocument",
          path: ["editorDocument"],
        });
      }
    }
  },
);

export const UpdateEmailSequenceStepSchema = EmailSequenceStepBaseSchema.partial();

export type CreateEmailSequenceStepInput = z.input<typeof CreateEmailSequenceStepSchema>;
export type UpdateEmailSequenceStepInput = z.input<typeof UpdateEmailSequenceStepSchema>;

export const CampaignRunStatusSchema = z.enum(["running", "paused", "completed", "cancelled"]);
export type CampaignRunStatus = z.infer<typeof CampaignRunStatusSchema>;

export const EnrollmentStatusSchema = z.enum(["active", "completed", "exited", "paused"]);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

export const StepSendStatusSchema = z.enum([
  "pending",
  "sent",
  "delivered",
  "failed",
  "skipped",
]);
export type StepSendStatus = z.infer<typeof StepSendStatusSchema>;

export const EmailPreferenceStatusSchema = z.enum(["subscribed", "unsubscribed"]);
export type EmailPreferenceStatus = z.infer<typeof EmailPreferenceStatusSchema>;

export const ExitReasonSchema = z.enum([
  "unsubscribed_all",
  "unsubscribed_sequence",
  "bounced",
  "complained",
  "manual",
  "missing_email",
]);
export type ExitReason = z.infer<typeof ExitReasonSchema>;

/** Human-friendly delay presets stored as minutes in the database. */
export const DELAY_PRESET_MINUTES = {
  immediate: 0,
  "1_day": 1440,
  "3_days": 4320,
  "1_week": 10080,
} as const;

export type DelayPresetKey = keyof typeof DELAY_PRESET_MINUTES;

export function delayMinutesToPreset(minutes: number): DelayPresetKey | "custom" {
  const entry = Object.entries(DELAY_PRESET_MINUTES).find(([, value]) => value === minutes);
  return (entry?.[0] as DelayPresetKey | undefined) ?? "custom";
}

export function delayPresetToMinutes(preset: DelayPresetKey | "custom", customMinutes: number) {
  if (preset === "custom") return customMinutes;
  return DELAY_PRESET_MINUTES[preset];
}
