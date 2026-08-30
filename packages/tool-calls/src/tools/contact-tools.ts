import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { ToolCallContext } from "../context";
import {
  listContactsForOrg,
  getContactById,
  createContactWithValidation,
  updateContactWithValidation,
  addTagToContact,
  removeTagFromContact,
  createContactInteraction,
  listContactTasksForOrg,
  createContactTask,
  updateContactTask,
} from "@workspace/contacts";

// ─── Shared schemas for mutating tools ────────────────────────────────────────

const ContactCreateSchema = z.object({
  kind: z.enum(["person", "company"]),
  displayName: z.string().min(1).max(255),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  companyName: z.string().max(255).optional(),
  primaryEmail: z.string().email().optional(),
  primaryPhone: z.string().max(50).optional(),
  website: z.string().url().optional(),
  parentContactId: z.string().optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
  source: z.string().max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const ContactUpdateSchema = z.object({
  contactId: z.string(),
  kind: z.enum(["person", "company"]).optional(),
  displayName: z.string().min(1).max(255).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  companyName: z.string().max(255).optional(),
  primaryEmail: z.string().email().optional(),
  primaryPhone: z.string().max(50).optional(),
  website: z.string().url().optional(),
  parentContactId: z.string().optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
  source: z.string().max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const TagOperationSchema = z.object({
  contactId: z.string(),
  tagId: z.string(),
});

const CreateNoteSchema = z.object({
  contactId: z.string(),
  body: z.string().min(1),
  type: z.enum(["note", "call", "email", "meeting", "sms", "other"]).optional(),
  happenedAt: z.string().optional(),
});

const CreateTaskSchema = z.object({
  contactId: z.string(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  statusId: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueAt: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const UpdateTaskSchema = z.object({
  taskId: z.string(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  statusId: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// ─── contacts-list ────────────────────────────────────────────────────────────

export const contactsListTool: ToolDefinition = {
  name: "contacts-list",
  description:
    "List contacts in the organization. Supports filtering by kind, stageId, tagIds, search, and pagination via page/pageSize.",
  requiredScopes: ["contact:read"],
  requiredPermissions: { contact: ["read"] },
  creditPolicy: {
    chargeToOrg: false,
    usageArea: "mcp_tool",
    cost: { mode: "fixed", credits: 5 },
  },
  inputShape: {
    search: z.string().optional(),
    kind: z.enum(["person", "company"]).optional(),
    stageId: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
    includeArchived: z.boolean().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
  },
  run: async (ctx: ToolCallContext, input: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const filters = {
      search: input.search as string | undefined,
      kind: input.kind as "person" | "company" | undefined,
      stageId: input.stageId as string | undefined,
      tagIds: input.tagIds as string[] | undefined,
      includeArchived: input.includeArchived as boolean | undefined,
      page: input.page as number | undefined,
      pageSize: input.pageSize as number | undefined,
    };
    return listContactsForOrg(ctx.orgId, filters);
  },
};

// ─── contacts-get ─────────────────────────────────────────────────────────────

export const contactsGetTool: ToolDefinition = {
  name: "contacts-get",
  description: "Retrieve a single contact by ID.",
  requiredScopes: ["contact:read"],
  requiredPermissions: { contact: ["read"] },
  creditPolicy: {
    chargeToOrg: false,
    usageArea: "mcp_tool",
    cost: { mode: "fixed", credits: 2 },
  },
  inputShape: {
    contactId: z.string(),
  },
  run: async (ctx: ToolCallContext, input: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const contactId = input.contactId as string;
    const contact = await getContactById(contactId, ctx.orgId);
    if (!contact) return { error: `Contact not found: ${contactId}` };
    return contact;
  },
};

// ─── contacts-create ──────────────────────────────────────────────────────────

export const contactsCreateTool: ToolDefinition = {
  name: "contacts-create",
  description: "Create a new contact in the organization.",
  requiredScopes: ["contact:create"],
  requiredPermissions: { contact: ["create"] },
  inputShape: {
    kind: z.enum(["person", "company"]),
    displayName: z.string().min(1).max(255),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    companyName: z.string().max(255).optional(),
    primaryEmail: z.string().email().optional(),
    primaryPhone: z.string().max(50).optional(),
    website: z.string().url().optional(),
    parentContactId: z.string().optional(),
    stageId: z.string().optional(),
    ownerId: z.string().optional(),
    source: z.string().max(100).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const result = ContactCreateSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    try {
      return await createContactWithValidation(ctx.orgId, result.data);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create contact" };
    }
  },
};

// ─── contacts-update ──────────────────────────────────────────────────────────

export const contactsUpdateTool: ToolDefinition = {
  name: "contacts-update",
  description: "Update an existing contact.",
  requiredScopes: ["contact:update"],
  requiredPermissions: { contact: ["update"] },
  inputShape: {
    contactId: z.string(),
    kind: z.enum(["person", "company"]).optional(),
    displayName: z.string().min(1).max(255).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    companyName: z.string().max(255).optional(),
    primaryEmail: z.string().email().optional(),
    primaryPhone: z.string().max(50).optional(),
    website: z.string().url().optional(),
    parentContactId: z.string().optional(),
    stageId: z.string().optional(),
    ownerId: z.string().optional(),
    source: z.string().max(100).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const result = ContactUpdateSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    const { contactId, ...data } = result.data;
    try {
      return await updateContactWithValidation(
        contactId,
        ctx.orgId,
        data as Parameters<typeof updateContactWithValidation>[2],
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to update contact" };
    }
  },
};

// ─── contacts-add-tag ─────────────────────────────────────────────────────────

export const contactsAddTagTool: ToolDefinition = {
  name: "contacts-add-tag",
  description: "Add a tag to a contact.",
  requiredScopes: ["contact:update"],
  requiredPermissions: { contact: ["update"] },
  inputShape: {
    contactId: z.string(),
    tagId: z.string(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const result = TagOperationSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    const { contactId, tagId } = result.data;
    try {
      return await addTagToContact(contactId, tagId, ctx.orgId);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to add tag" };
    }
  },
};

// ─── contacts-remove-tag ──────────────────────────────────────────────────────

export const contactsRemoveTagTool: ToolDefinition = {
  name: "contacts-remove-tag",
  description: "Remove a tag from a contact.",
  requiredScopes: ["contact:update"],
  requiredPermissions: { contact: ["update"] },
  inputShape: {
    contactId: z.string(),
    tagId: z.string(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const result = TagOperationSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    const { contactId, tagId } = result.data;
    try {
      return await removeTagFromContact(contactId, tagId, ctx.orgId);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to remove tag" };
    }
  },
};

// ─── contacts-create-note ─────────────────────────────────────────────────────

export const contactsCreateNoteTool: ToolDefinition = {
  name: "contacts-create-note",
  description: "Create an interaction (note, call, email, meeting, sms, or other) on a contact.",
  requiredScopes: ["contactInteraction:create"],
  requiredPermissions: { contactInteraction: ["create"] },
  inputShape: {
    contactId: z.string(),
    body: z.string().min(1),
    type: z.enum(["note", "call", "email", "meeting", "sms", "other"]).optional(),
    happenedAt: z.string().optional(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const userId = ctx.userId;
    if (!userId) {
      return {
        error:
          "User context required to create notes/tasks. This tool cannot be called with an org-only API key.",
      };
    }
    const result = CreateNoteSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    const { contactId, body, type = "note", happenedAt } = result.data;
    try {
      return await createContactInteraction(contactId, ctx.orgId, userId, {
        contactId,
        body,
        type,
        happenedAt: happenedAt ? new Date(happenedAt) : undefined,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create interaction" };
    }
  },
};

// ─── contacts-tasks-list ──────────────────────────────────────────────────────

export const contactsTasksListTool: ToolDefinition = {
  name: "contacts-tasks-list",
  description:
    "List contact tasks for the organization, optionally filtered by statusId or assigneeId.",
  requiredScopes: ["contactTask:read"],
  requiredPermissions: { contactTask: ["read"] },
  inputShape: {
    statusId: z.string().optional(),
    assigneeId: z.string().optional(),
    limit: z.number().int().positive().optional(),
  },
  run: async (ctx: ToolCallContext, input: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const filters = {
      statusId: input.statusId as string | undefined,
      assigneeId: input.assigneeId as string | undefined,
    };
    const limit = input.limit as number | undefined;
    return listContactTasksForOrg(ctx.orgId, filters, limit);
  },
};

// ─── contacts-create-task ─────────────────────────────────────────────────────

export const contactsCreateTaskTool: ToolDefinition = {
  name: "contacts-create-task",
  description: "Create a task associated with a contact.",
  requiredScopes: ["contactTask:create"],
  requiredPermissions: { contactTask: ["create"] },
  inputShape: {
    contactId: z.string(),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    statusId: z.string().optional(),
    assigneeId: z.string().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    dueAt: z.string().optional(),
    sortOrder: z.number().int().optional(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const userId = ctx.userId;
    if (!userId) {
      return {
        error:
          "User context required to create notes/tasks. This tool cannot be called with an org-only API key.",
      };
    }
    const result = CreateTaskSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    const { dueAt, sortOrder, ...rest } = result.data;
    const data: Parameters<typeof createContactTask>[2] = {
      contactId: rest.contactId,
      title: rest.title,
      description: rest.description,
      statusId: rest.statusId,
      assigneeId: rest.assigneeId,
      priority: rest.priority ?? "normal",
      dueAt: dueAt ? new Date(dueAt) : undefined,
      sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
    };
    try {
      return await createContactTask(ctx.orgId, userId, data);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create task" };
    }
  },
};

// ─── contacts-update-task ─────────────────────────────────────────────────────

export const contactsUpdateTaskTool: ToolDefinition = {
  name: "contacts-update-task",
  description: "Update an existing contact task.",
  requiredScopes: ["contactTask:update"],
  requiredPermissions: { contactTask: ["update"] },
  inputShape: {
    taskId: z.string(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    statusId: z.string().optional(),
    assigneeId: z.string().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    dueAt: z.string().optional(),
    completedAt: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
  },
  run: async (ctx: ToolCallContext, args: Record<string, unknown>) => {
    if (!ctx.orgId) return { error: "Organization context required" };
    const result = UpdateTaskSchema.safeParse(args);
    if (!result.success) return { error: "Invalid input", issues: result.error.issues };
    const { taskId, dueAt, completedAt, ...rest } = result.data;
    const data: Parameters<typeof updateContactTask>[2] = {
      title: rest.title,
      description: rest.description,
      statusId: rest.statusId,
      assigneeId: rest.assigneeId,
      priority: rest.priority,
      dueAt: dueAt ? new Date(dueAt) : undefined,
      completedAt: completedAt === null ? null : completedAt ? new Date(completedAt) : undefined,
      sortOrder: typeof rest.sortOrder === "number" ? rest.sortOrder : undefined,
    };
    try {
      return await updateContactTask(taskId, ctx.orgId, data);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to update task" };
    }
  },
};

// ─── contacts-documentation ───────────────────────────────────────────────────

export const contactsDocumentationTool: ToolDefinition = {
  name: "contacts-documentation",
  description:
    "Returns documentation about the contacts module — available tools, data model fields, and usage guidance.",
  requiredScopes: ["contact:read"],
  requiredPermissions: { contact: ["read"] },
  inputShape: {},
  run: async (_ctx: ToolCallContext, _input: Record<string, unknown>) => {
    return `
# Contacts Module — Documentation

## Overview
The contacts module manages people and companies (contacts), along with their interactions
(notes, calls, emails) and tasks.

## Contact Fields
- **id** — unique identifier (prefixed: \`cont_...\`)
- **kind** — \`"person"\` or \`"company"\`
- **displayName** — required display name (max 255 chars)
- **firstName**, **lastName** — optional for person contacts
- **companyName** — optional for company contacts
- **primaryEmail**, **primaryPhone**, **website** — optional contact details
- **parentContactId** — optional parent contact (supports org hierarchy)
- **stageId** — optional CRM stage
- **ownerId** — optional owner/assignee
- **source** — optional acquisition source (max 100 chars)
- **status** — \`"active"\` (default) or \`"inactive"\`

## Available Tools

### contacts-list
List contacts with optional filters: \`search\`, \`kind\`, \`stageId\`, \`tagIds\` (array),
\`includeArchived\`, \`page\` (default 1), \`pageSize\` (default 20, max 100).

### contacts-get
Retrieve a single contact by \`contactId\`.

### contacts-create
Create a new contact. Required: \`kind\`, \`displayName\`.

### contacts-update
Update a contact by \`contactId\`. All fields optional except \`contactId\`.

### contacts-add-tag / contacts-remove-tag
Add or remove a tag from a contact using \`contactId\` and \`tagId\`.

### contacts-create-note
Log an interaction on a contact. Required: \`contactId\`, \`body\`.
Optional: \`type\` (\`note\`, \`call\`, \`email\`, \`meeting\`, \`sms\`, \`other\`), \`happenedAt\`.

### contacts-tasks-list
List tasks for the organization. Optional filters: \`statusId\`, \`assigneeId\`, \`limit\`.

### contacts-create-task
Create a task linked to a contact. Required: \`contactId\`, \`title\`.
Optional: \`description\`, \`statusId\`, \`assigneeId\`, \`priority\` (\`low\`/\`normal\`/\`high\`/\`urgent\`),
\`dueAt\` (ISO date string), \`sortOrder\`.

### contacts-update-task
Update a task by \`taskId\`. All fields optional except \`taskId\`.
Set \`completedAt\` to null to reopen, or an ISO date string to mark complete.

### contacts-documentation
Returns this documentation string.

## Permissions Required
- contact:read — list and get contacts
- contact:create — create contacts
- contact:update — update contacts, add/remove tags
- contactInteraction:create — create notes/interactions
- contactTask:read — list tasks
- contactTask:create — create tasks
- contactTask:update — update tasks
`.trim();
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const contactTools: ToolDefinition[] = [
  contactsListTool,
  contactsGetTool,
  contactsCreateTool,
  contactsUpdateTool,
  contactsAddTagTool,
  contactsRemoveTagTool,
  contactsCreateNoteTool,
  contactsTasksListTool,
  contactsCreateTaskTool,
  contactsUpdateTaskTool,
  contactsDocumentationTool,
];
