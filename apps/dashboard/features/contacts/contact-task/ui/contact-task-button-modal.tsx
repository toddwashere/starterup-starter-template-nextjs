"use client";

import { useEffect, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { TaskStatusView } from "@workspace/ui/components/entity-label-views";
import { resolveAndHideModal } from "@/common/ui/nice-modal-helpers";
import { createContactTaskAction, updateContactTaskAction } from "../data/contact-task-actions";

type TaskStatus = {
  id: string;
  name: string;
  color?: string | null;
  isTerminal?: boolean;
};
type EditableTask = {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
  statusId?: string | null;
  dueAt?: Date | string | null;
};

type TaskFormState = {
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent";
  statusId: string;
  dueAt: string;
};

function formatDateInput(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalizePriority(value?: string): TaskFormState["priority"] {
  if (value === "low" || value === "high" || value === "urgent") return value;
  return "normal";
}

function createTaskState(task?: EditableTask): TaskFormState {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: normalizePriority(task?.priority),
    statusId: task?.statusId ?? "none",
    dueAt: formatDateInput(task?.dueAt),
  };
}

export const ContactTaskButtonModal = NiceModal.create(
  ({
    contactId,
    task,
    statuses,
  }: {
    contactId: string;
    task?: EditableTask;
    statuses: TaskStatus[];
  }) => {
    const modal = useModal();
    const [form, setForm] = useState<TaskFormState>(() => createTaskState(task));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isEditing = !!task;

    function resetForm() {
      setForm(createTaskState(task));
      setError(null);
      setIsSubmitting(false);
    }

    useEffect(() => {
      if (!modal.visible) return;
      setForm(createTaskState(task));
      setError(null);
      setIsSubmitting(false);
    }, [modal.visible, task]);

    async function handleSave() {
      if (!form.title.trim() || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const payload = {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority,
          statusId: form.statusId === "none" ? undefined : form.statusId,
          dueAt: form.dueAt ? new Date(form.dueAt) : undefined,
        };
        const result = isEditing
          ? await updateContactTaskAction(task.id, payload)
          : await createContactTaskAction({
              contactId,
              sortOrder: 0,
              ...payload,
            });
        if (!result.success) {
          setError(result.error);
          return;
        }
        resolveAndHideModal(modal, true);
      } finally {
        setIsSubmitting(false);
      }
    }

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) {
            resetForm();
            modal.hide();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Task" : "Add Task"}</DialogTitle>
            <DialogDescription>
              Manage follow-up work for this contact.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.statusId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, statusId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No status</SelectItem>
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
              </div>

              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      priority: value as TaskFormState["priority"],
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due Date</Label>
              <Input
                id="task-due"
                type="date"
                value={form.dueAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dueAt: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => modal.hide()}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.title.trim() || isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
