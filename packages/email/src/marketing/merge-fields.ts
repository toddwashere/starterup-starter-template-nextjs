const MERGE_FIELD_PATTERN =
  /\{\{(displayName|firstName|lastName|companyName|primaryEmail|organizationName)\}\}/g;

export type MergeFieldData = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  primaryEmail?: string | null;
  organizationName?: string | null;
};

export function applyMergeFields(template: string, data: MergeFieldData): string {
  return template.replace(MERGE_FIELD_PATTERN, (_match, key: keyof MergeFieldData) => {
    return data[key] ?? "";
  });
}
