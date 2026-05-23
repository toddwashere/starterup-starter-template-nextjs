import { z } from "zod";

export const SetMessageFeedbackSchema = z.object({
  messageId: z.string(),
  feedback: z.enum(["helpful", "not_helpful"]),
  comment: z.string().optional(),
});

export type SetMessageFeedbackInput = z.infer<typeof SetMessageFeedbackSchema>;

export const AppendUserMessageSchema = z.object({
  threadId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  content: z.string().min(1),
});

export type AppendUserMessageInput = z.infer<typeof AppendUserMessageSchema>;

export const AppendAssistantMessageSchema = z.object({
  threadId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  content: z.string(),
  toolPayload: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

export type AppendAssistantMessageInput = z.infer<typeof AppendAssistantMessageSchema>;
