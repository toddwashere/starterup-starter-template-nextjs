"use client";

import { useState, useEffect, useTransition } from "react";
import { Badge } from "@workspace/ui/components/badge";
import { TaskStatusView } from "@workspace/ui/components/entity-label-views";
import { Button } from "@workspace/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  listContactTasksForOrgAction,
  updateContactTaskAction,
  listContactTaskStatusesAction,
} from "../data/contact-task-actions";

type Task = Extract<
  Awaited<ReturnType<typeof listContactTasksForOrgAction>>,
  { success: true }
>["data"][number];

type Status = Extract<
  Awaited<ReturnType<typeof listContactTaskStatusesAction>>,
  { success: true }
>["data"][number];

export function ContactsTasksPageContent({ orgSlug: _orgSlug }: { orgSlug: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("__all__");

  function loadTasks(statusId?: string) {
    startTransition(async () => {
      const [tResult, sResult] = await Promise.all([
        listContactTasksForOrgAction(
          statusId ? { statusId } : {},
        ),
        listContactTaskStatusesAction(),
      ]);
      if (tResult.success) setTasks(tResult.data);
      if (sResult.success) setStatuses(sResult.data);
    });
  }

  useEffect(() => {
    loadTasks();
  }, []);

  async function handleComplete(taskId: string) {
    if (completingId) return; // already completing one
    const terminal = statuses.find((s) => s.isTerminal);
    if (!terminal) {
      setError("No terminal status configured. Please add one in Contacts Settings.");
      return;
    }
    setCompletingId(taskId);
    try {
      const result = await updateContactTaskAction(taskId, {
        statusId: terminal.id,
        completedAt: new Date(),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setError(null);
      loadTasks(statusFilter === "__all__" ? undefined : statusFilter);
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Contact Tasks"
        description="View and complete tasks across all contacts."
        toolbarInline
        toolbar={
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              loadTasks(value === "__all__" ? undefined : value);
            }}
          >
            <SelectTrigger className="h-9 w-full sm:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  <TaskStatusView
                    name={status.name}
                    color={status.color}
                    isTerminal={status.isTerminal}
                    size="sm"
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <PageBody className="space-y-4 p-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No tasks yet.
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.contact?.displayName ?? "—"}
                  </TableCell>
                  <TableCell>
                    {task.status ? (
                      <TaskStatusView
                        name={task.status.name}
                        color={task.status.color}
                        isTerminal={task.status.isTerminal}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        task.priority === "urgent" || task.priority === "high"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    {!task.completedAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={completingId === task.id}
                        onClick={() => handleComplete(task.id)}
                      >
                        {completingId === task.id ? "Completing…" : "Complete"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </PageBody>
    </Page>
  );
}
