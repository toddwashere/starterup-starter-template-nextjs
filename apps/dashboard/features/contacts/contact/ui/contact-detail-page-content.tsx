"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { formatDate } from "@workspace/common";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
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
  IconForMore,
  IconForDelete,
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

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
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
  const [taskSearch, setTaskSearch] = useState("");
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

    return () => { isCurrent = false; };
  }, [contactId]);

  useEffect(() => loadContact(), [loadContact]);

  async function handleAddNote() {
    if (!noteBody.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await createContactNoteAction(contactId, noteBody.trim());
      if (!result.success) { setNoteError(result.error); return; }
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
    const updated = await NiceModal.show(ContactTaskButtonModal, { contactId, statuses: taskStatuses });
    if (updated) await refreshTasks();
  }

  async function handleEditTask(task: Task) {
    const updated = await NiceModal.show(ContactTaskButtonModal, { contactId, task, statuses: taskStatuses });
    if (updated) await refreshTasks();
  }

  async function handleArchiveTask(taskId: string) {
    const result = await archiveContactTaskAction(taskId);
    if (result.success) await refreshTasks();
  }

  async function handleEditNote(interaction: Interaction) {
    const updated = await NiceModal.show(EditNoteButtonModal, { interactionId: interaction.id, body: interaction.body });
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
                  <BreadcrumbLink asChild><Link href={`/${orgSlug}/contacts`}>Contacts</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><Skeleton className="h-4 w-32" /></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          actions={<Skeleton className="h-9 w-28" />}
        />
        <PageBody disableScroll className="flex min-h-0">
          <div className="hidden lg:block w-72 shrink-0 border-r p-6 space-y-4">
            <Skeleton className="h-20 w-20 rounded-full mx-auto" />
            <Skeleton className="h-6 w-40 mx-auto" />
            <Skeleton className="h-4 w-24 mx-auto" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
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
                  <BreadcrumbLink asChild><Link href={`/${orgSlug}/contacts`}>Contacts</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>Contact not found</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <PageBody disableScroll className="p-6">
          <p className="text-muted-foreground">This contact may have been removed or you do not have access.</p>
        </PageBody>
      </Page>
    );
  }

  if (!contact) return null;

  const openTasks = tasks.filter((t) => !t.completedAt);
  const filteredTasks = taskSearch.trim()
    ? openTasks.filter((t) => t.title.toLowerCase().includes(taskSearch.toLowerCase()))
    : openTasks;
  const hasContactInfo = !!contact.primaryEmail || !!contact.primaryPhone || !!contact.website || !!contact.parent;
  const initials = getInitials(contact.displayName);

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link href={`/${orgSlug}/contacts`}>Contacts</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>{contact.displayName}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <Button variant="outline" onClick={() => void handleEditContact()}>
            Edit Contact
          </Button>
        }
      />

      <PageBody disableScroll className="flex min-h-0 flex-col lg:flex-row">
        {/* Left sidebar */}
        <aside className="w-full lg:w-72 lg:shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r bg-muted/30 p-6 space-y-5">
          {/* Avatar + name + kind */}
          <div className="flex flex-col items-center gap-2 text-center">
            <Avatar className="size-20 text-2xl">
              <AvatarFallback className="bg-foreground text-background text-2xl font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl font-bold leading-tight">{contact.displayName}</h1>
              <div className="mt-1 flex flex-wrap justify-center gap-1">
                <Badge variant="secondary" className="capitalize">{contact.kind}</Badge>
                {contact.stage && (
                  <StageView name={contact.stage.name} color={contact.stage.color} />
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Contact info */}
          <div className="space-y-1">
            <p className="text-sm font-semibold mb-2">Contact Info</p>
            {contact.primaryEmail && (
              <div className="flex items-center gap-2 text-sm">
                <IconForEmail className="text-muted-foreground shrink-0" />
                <a href={`mailto:${contact.primaryEmail}`} className="hover:underline truncate">
                  {contact.primaryEmail}
                </a>
              </div>
            )}
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
                <a href={contact.website} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline truncate">
                  {contact.website}
                </a>
              </div>
            )}
            {contact.parent && (
              <div className="flex items-center gap-2 text-sm">
                <IconForContacts className="text-muted-foreground shrink-0" />
                <button className="hover:underline" onClick={() => router.push(`/${orgSlug}/contacts/${contact.parent!.id}`)}>
                  {contact.parent.displayName}
                </button>
              </div>
            )}
            {!hasContactInfo && (
              <p className="text-sm text-muted-foreground">No contact info.</p>
            )}
          </div>

          {contact.children.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-semibold mb-2">Related ({contact.children.length})</p>
                <div className="flex flex-wrap gap-1">
                  {contact.children.map((child: { id: string; displayName: string; kind: string }) => (
                    <Badge key={child.id} variant="outline" className="cursor-pointer" onClick={() => router.push(`/${orgSlug}/contacts/${child.id}`)}>
                      {child.displayName}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Tags */}
          <div>
            <p className="text-sm font-semibold mb-2">Tags</p>
            <ContactTagsEditor
              contactId={contact.id}
              assignments={contact.tags}
              onUpdated={loadContact}
            />
          </div>
        </aside>

        {/* Right content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">

          {/* Tasks card */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold flex-1">Tasks</h2>
              <Button size="sm" onClick={() => void handleAddTask()}>Add Task</Button>
              <Input
                placeholder="Search"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                className="w-36 lg:w-48 h-8 text-sm"
              />
            </div>

            {openTasks.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                {/* Column header */}
                <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 border-b text-xs text-muted-foreground font-medium">
                  <div className="size-4 shrink-0" />
                  <span>Task</span>
                </div>

                {filteredTasks.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No tasks match your search.</p>
                ) : (
                  <ul className="divide-y">
                    {filteredTasks.map((task) => (
                      <li key={task.id} className="flex items-start gap-3 px-3 py-3">
                        <div className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-muted-foreground/40 flex items-center justify-center">
                          <div className="size-1.5 rounded-full" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-medium leading-tight">{task.title}</p>
                          {task.dueAt && (
                            <p className="text-xs text-muted-foreground">Due {formatDate(task.dueAt)}</p>
                          )}
                          {task.status && (
                            <TaskStatusView
                              name={task.status.name}
                              color={task.status.color}
                              isTerminal={task.status.isTerminal}
                            />
                          )}
                          {task.description && (
                            <p className="text-xs text-muted-foreground">{task.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void handleEditTask(task)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => void handleArchiveTask(task.id)}>
                            <IconForDelete />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {openTasks.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No open tasks.</p>
            )}
          </div>

          {/* Notes & Activity card */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <h2 className="font-semibold">Notes &amp; Activity</h2>

            <div className="space-y-2">
              <Textarea
                placeholder="Add Note..."
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                rows={3}
              />
              {noteError && <p className="text-sm text-destructive">{noteError}</p>}
              <Button
                size="sm"
                onClick={handleAddNote}
                disabled={!noteBody.trim() || isPending || isSubmitting}
              >
                {isSubmitting ? "Saving…" : "Add Note"}
              </Button>
            </div>

            {interactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {interactions.map((i) => (
                  <div key={i.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-6">
                        <AvatarFallback className="bg-foreground text-background text-xs font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{contact.displayName}</span>
                      <span className="text-xs text-muted-foreground">• {formatDate(i.happenedAt, { relative: true })}</span>
                      <div className="ml-auto">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <IconForMore />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void handleEditNote(i)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void handleArchiveNote(i.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <p className="text-sm">{i.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </PageBody>
    </Page>
  );
}
