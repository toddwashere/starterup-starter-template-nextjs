"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { formatDate } from "@workspace/common";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { StageView, TaskStatusView } from "@workspace/ui/components/entity-label-views";
import { Textarea } from "@workspace/ui/components/textarea";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  IconForEmail,
  IconForPhone,
  IconForWebsite,
  IconForContacts,
} from "@workspace/ui/components/icon-for";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { getContactAction } from "../data/contact-actions";
import {
  archiveContactInteractionAction,
  createContactNoteAction,
  listContactInteractionsAction,
} from "../../contact-interaction/data/contact-interaction-actions";
import {
  archiveContactTaskAction,
  listContactTasksAction,
  listContactTaskStatusesAction,
} from "../../contact-task/data/contact-task-actions";
import { EditContactButtonModal } from "./edit-contact-button-modal";
import { ContactTaskButtonModal } from "../../contact-task/ui/contact-task-button-modal";
import { EditNoteButtonModal } from "../../contact-interaction/ui/edit-note-button-modal";
import { ContactTagsEditor } from "../../contact-tag/ui/contact-tags-editor";

type Contact = Extract<
  Awaited<ReturnType<typeof getContactAction>>,
  { success: true }
>["data"];

type Interaction = Extract<
  Awaited<ReturnType<typeof listContactInteractionsAction>>,
  { success: true }
>["data"][number];

type Task = Extract<
  Awaited<ReturnType<typeof listContactTasksAction>>,
  { success: true }
>["data"][number];

type TaskStatus = Extract<
  Awaited<ReturnType<typeof listContactTaskStatusesAction>>,
  { success: true }
>["data"][number];

function ContactAvatar({ name }: { name: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      aria-label={`${name} avatar`}
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-semibold select-none"
    >
      {initials}
    </div>
  );
}

export function ContactDetailPageContent({
  orgSlug,
  contactId,
}: {
  orgSlug: string;
  contactId: string;
}) {
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<TaskStatus[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshInteractions = useCallback(async () => {
    const result = await listContactInteractionsAction(contactId);
    if (result.success) setInteractions(result.data);
  }, [contactId]);

  const refreshTasks = useCallback(async () => {
    const result = await listContactTasksAction(contactId);
    if (result.success) setTasks(result.data);
  }, [contactId]);

  const loadContact = useCallback(() => {
    let isCurrent = true;
    setContact(null);
    setInteractions([]);
    setTasks([]);
    setTaskStatuses([]);
    setIsLoaded(false);

    startTransition(async () => {
      const [cResult, iResult, tResult, sResult] = await Promise.all([
        getContactAction(contactId),
        listContactInteractionsAction(contactId),
        listContactTasksAction(contactId),
        listContactTaskStatusesAction(),
      ]);
      if (!isCurrent) return;
      if (cResult.success) setContact(cResult.data);
      if (iResult.success) setInteractions(iResult.data);
      if (tResult.success) setTasks(tResult.data);
      if (sResult.success) setTaskStatuses(sResult.data);
      setIsLoaded(true);
    });

    return () => {
      isCurrent = false;
    };
  }, [contactId]);

  useEffect(() => loadContact(), [loadContact]);

  async function handleAddNote() {
    if (!noteBody.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await createContactNoteAction(contactId, noteBody.trim());
      if (!result.success) {
        setNoteError(result.error);
        return;
      }
      setNoteBody("");
      setNoteError(null);
      await refreshInteractions();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditContact() {
    if (!contact) return;
    const updated = await NiceModal.show(EditContactButtonModal, { contact });
    if (updated) loadContact();
  }

  async function handleAddTask() {
    const updated = await NiceModal.show(ContactTaskButtonModal, {
      contactId,
      statuses: taskStatuses,
    });
    if (updated) await refreshTasks();
  }

  async function handleEditTask(task: Task) {
    const updated = await NiceModal.show(ContactTaskButtonModal, {
      contactId,
      task,
      statuses: taskStatuses,
    });
    if (updated) await refreshTasks();
  }

  async function handleArchiveTask(taskId: string) {
    const result = await archiveContactTaskAction(taskId);
    if (result.success) await refreshTasks();
  }

  async function handleEditNote(interaction: Interaction) {
    const updated = await NiceModal.show(EditNoteButtonModal, {
      interactionId: interaction.id,
      body: interaction.body,
    });
    if (updated) await refreshInteractions();
  }

  async function handleArchiveNote(interactionId: string) {
    const result = await archiveContactInteractionAction(interactionId);
    if (result.success) await refreshInteractions();
  }

  if (!isLoaded && isPending) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg
          breadcrumb={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/${orgSlug}/contacts`}>Contacts</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <Skeleton className="h-4 w-32" />
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          actions={<Skeleton className="h-9 w-28" />}
        />
        <PageBody disableScroll className="max-w-3xl space-y-6 p-6">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </PageBody>
      </Page>
    );
  }

  if (isLoaded && !contact) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg
          title="Contact not found"
          breadcrumb={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/${orgSlug}/contacts`}>Contacts</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Contact not found</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <PageBody disableScroll className="p-6">
          <p className="text-muted-foreground">
            This contact may have been removed or you do not have access.
          </p>
        </PageBody>
      </Page>
    );
  }

  if (!contact) return null;

  const openTasks = tasks.filter((t) => !t.completedAt);
  const hasContactInfo =
    !!contact.primaryEmail ||
    !!contact.primaryPhone ||
    !!contact.website ||
    !!contact.parent;

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/${orgSlug}/contacts`}>Contacts</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{contact.displayName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <Button variant="outline" onClick={() => void handleEditContact()}>
            Edit Contact
          </Button>
        }
      />
      <PageBody disableScroll className="max-w-3xl space-y-6 p-6">

        {/* Hero header */}
        <div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-4">
          <ContactAvatar name={contact.displayName} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight truncate">
              {contact.displayName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{contact.kind}</Badge>
              {contact.stage && (
                <StageView name={contact.stage.name} color={contact.stage.color} />
              )}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Tags</h2>
          <ContactTagsEditor
            contactId={contact.id}
            assignments={contact.tags}
            onUpdated={loadContact}
          />
        </div>

        {/* Contact info */}
        <div className="space-y-2">
          {contact.primaryEmail ? (
            <div className="flex items-center gap-2 text-sm">
              <IconForEmail className="text-muted-foreground shrink-0" />
              <a
                href={`mailto:${contact.primaryEmail}`}
                className="hover:underline"
              >
                {contact.primaryEmail}
              </a>
            </div>
          ) : null}
          {contact.primaryPhone && (
            <div className="flex items-center gap-2 text-sm">
              <IconForPhone className="text-muted-foreground shrink-0" />
              <a href={`tel:${contact.primaryPhone}`} className="hover:underline">
                {contact.primaryPhone}
              </a>
            </div>
          )}
          {contact.website && (
            <div className="flex items-center gap-2 text-sm">
              <IconForWebsite className="text-muted-foreground shrink-0" />
              <a
                href={contact.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {contact.website}
              </a>
            </div>
          )}
          {contact.parent && (
            <div className="flex items-center gap-2 text-sm">
              <IconForContacts className="text-muted-foreground shrink-0" />
              <button
                className="hover:underline"
                onClick={() =>
                  router.push(`/${orgSlug}/contacts/${contact.parent!.id}`)
                }
              >
                {contact.parent.displayName}
              </button>
            </div>
          )}
          {!hasContactInfo && (
            <p className="text-sm text-muted-foreground">No contact info.</p>
          )}
        </div>

        {/* Related contacts */}
        {contact.children.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-1">
              Related ({contact.children.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {contact.children.map(
                (child: { id: string; displayName: string; kind: string }) => (
                  <Badge
                    key={child.id}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/${orgSlug}/contacts/${child.id}`)
                    }
                  >
                    {child.displayName}
                  </Badge>
                ),
              )}
            </div>
          </div>
        )}

        <Separator />

        {/* Open Tasks */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Open Tasks ({openTasks.length})</h2>
            <Button size="sm" onClick={() => void handleAddTask()}>
              Add Task
            </Button>
          </div>
          {openTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {task.status ? (
                        <TaskStatusView
                          name={task.status.name}
                          color={task.status.color}
                          isTerminal={task.status.isTerminal}
                        />
                      ) : (
                        <Badge variant="outline">No status</Badge>
                      )}
                      <span className="font-medium">{task.title}</span>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                    {task.dueAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Due {formatDate(task.dueAt)}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleEditTask(task)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleArchiveTask(task.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        {/* Notes & Activity */}
        <div>
          <h2 className="font-semibold mb-3">Notes &amp; Activity</h2>
          <div className="space-y-2 mb-4">
            <Textarea
              placeholder="Add a note…"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={3}
            />
            {noteError && (
              <p className="text-sm text-destructive">{noteError}</p>
            )}
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!noteBody.trim() || isPending || isSubmitting}
            >
              {isSubmitting ? "Saving…" : "Add Note"}
            </Button>
          </div>

          <div className="space-y-3">
            {interactions.map((i) => (
              <div key={i.id} className="text-sm border rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{i.type}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(i.happenedAt, { relative: true })}
                  </span>
                </div>
                <p>{i.body}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleEditNote(i)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleArchiveNote(i.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            {interactions.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
