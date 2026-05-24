import { z } from "zod";

export const CURRENT_FILTER_VERSION = 2;

export const ContactSegmentFilterSchemaV1 = z
  .object({
    search: z.string().optional(),
    kind: z.enum(["person", "company"]).optional(),
    stageId: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
    includeArchived: z.boolean().optional(),
  })
  .strict();

export type ContactSegmentFilterV1 = z.infer<typeof ContactSegmentFilterSchemaV1>;

// v2 = all v1 dynamic fields + explicit membership IDs.
export const ContactSegmentFilterSchemaV2 = z
  .object({
    search: z.string().optional(),
    kind: z.enum(["person", "company"]).optional(),
    stageId: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
    includeArchived: z.boolean().optional(),
    contactIds: z.array(z.string()).optional(),
  })
  .strict();

export type ContactSegmentFilterV2 = z.infer<typeof ContactSegmentFilterSchemaV2>;

export const CreateContactSegmentSchema = z.object({
  name: z.string().min(1).max(255),
  filters: ContactSegmentFilterSchemaV2,
  filterVersion: z.literal(CURRENT_FILTER_VERSION),
  sortKey: z.string().default("displayName"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

export const UpdateContactSegmentSchema = CreateContactSegmentSchema.partial();

export type CreateContactSegmentInput = z.infer<typeof CreateContactSegmentSchema>;
export type UpdateContactSegmentInput = z.infer<typeof UpdateContactSegmentSchema>;
