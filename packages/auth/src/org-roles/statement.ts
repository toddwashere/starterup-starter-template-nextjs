import { createAccessControl } from "better-auth/plugins/access";

export const statement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  billing: ["manage"],
  apiKey: ["create", "read", "update", "delete"],
  contact: ["read", "create", "update", "delete", "import", "export"],
  contactSettings: ["read", "create", "update", "delete"],
  contactInteraction: ["read", "create", "update", "delete"],
  contactTask: ["read", "create", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);
