import { ac } from "./statement";

export const owner = ac.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  billing: ["manage"],
  apiKey: ["create", "read", "update", "delete"],
  contact: ["read", "create", "update", "delete", "import", "export"],
  contactSettings: ["read", "create", "update", "delete"],
  contactInteraction: ["read", "create", "update", "delete"],
  contactTask: ["read", "create", "update", "delete"],
  campaign: ["read", "create", "update", "delete", "send", "manageSettings"],
});

export const admin = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  billing: ["manage"],
  apiKey: ["create", "read", "update", "delete"],
  contact: ["read", "create", "update", "delete", "import", "export"],
  contactSettings: ["read", "create", "update", "delete"],
  contactInteraction: ["read", "create", "update", "delete"],
  contactTask: ["read", "create", "update", "delete"],
  campaign: ["read", "create", "update", "delete", "send", "manageSettings"],
});

export const member = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  billing: [],
  apiKey: [],
  contact: ["read", "create", "update"],
  contactSettings: ["read"],
  contactInteraction: ["read", "create", "update", "delete"],
  contactTask: ["read", "create", "update", "delete"],
  campaign: ["read"],
});
