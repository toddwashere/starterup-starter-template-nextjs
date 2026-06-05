import { z } from "zod";

export const SequenceKindSchema = z.enum(["campaign", "follow_up"]);
export type SequenceKind = z.infer<typeof SequenceKindSchema>;

export const SequenceStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export type SequenceStatus = z.infer<typeof SequenceStatusSchema>;

export const CreateEmailSequenceSchema = z.object({
  kind: SequenceKindSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  status: SequenceStatusSchema.optional(),
});

export const UpdateEmailSequenceSchema = CreateEmailSequenceSchema.partial();

export type CreateEmailSequenceInput = z.infer<typeof CreateEmailSequenceSchema>;
export type UpdateEmailSequenceInput = z.infer<typeof UpdateEmailSequenceSchema>;

export const CreateEmailSequenceStepSchema = z.object({
  sortOrder: z.number().int().min(0),
  delayMinutes: z.number().int().min(0).default(0),
  templateKey: z.string().min(1),
  subjectTemplate: z.string().min(1),
  templateProps: z.record(z.unknown()).optional(),
});

export const UpdateEmailSequenceStepSchema = CreateEmailSequenceStepSchema.partial();

export type CreateEmailSequenceStepInput = z.infer<typeof CreateEmailSequenceStepSchema>;
export type UpdateEmailSequenceStepInput = z.infer<typeof UpdateEmailSequenceStepSchema>;

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
