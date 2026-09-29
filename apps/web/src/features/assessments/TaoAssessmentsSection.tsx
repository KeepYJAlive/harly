"use client";

import { useState, useTransition } from "react";
import { ClipboardList, Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/notification-island/toast";
import {
  saveTaoAssessmentDefinitionAction,
  setTaoAssessmentActiveAction,
} from "./definition-actions";
import type { TaoAssessmentDefinitionItem } from "./types";

const EMPTY = {
  id: undefined as string | undefined,
  name: "",
  description: "",
  externalId: "",
  active: true,
};

export function TaoAssessmentsSection({
  assessments,
  canEdit,
}: {
  assessments: TaoAssessmentDefinitionItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pending, startTransition] = useTransition();

  function add() {
    setForm(EMPTY);
    setOpen(true);
  }

  function edit(item: TaoAssessmentDefinitionItem) {
    setForm({
      id: item.id,
      name: item.name,
      description: item.description ?? "",
      externalId: item.externalId,
      active: item.active,
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const result = await saveTaoAssessmentDefinitionAction(form);
      if (!result.ok) {
        toast.error(result.error ?? "Could not save assessment.");
        return;
      }
      toast.success(form.id ? "Assessment updated" : "Assessment added");
      setOpen(false);
      router.refresh();
    });
  }

  function toggle(item: TaoAssessmentDefinitionItem) {
    startTransition(async () => {
      const result = await setTaoAssessmentActiveAction({
        id: item.id,
        active: !item.active,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not update assessment.");
        return;
      }
      toast.success(item.active ? "Assessment disabled" : "Assessment enabled");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">
            TAO assessments
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            TAO provides a delivery catalog REST API for REST Publisher
            accounts. Harly discovery is not configured with a TAO service
            credential, so register published delivery IDs manually for now.
          </p>
        </div>
        <Button size="sm" onClick={add} disabled={!canEdit}>
          <Plus className="size-4" /> Add assessment
        </Button>
      </div>

      {assessments.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-8 text-center">
          <ClipboardList className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">
            No TAO assessments registered
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the exact delivery ID from your TAO deployment.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border">
          {assessments.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <span
                    className={
                      item.active
                        ? "text-xs text-sage-ink"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {item.active ? "Active" : "Disabled"}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  TAO delivery: {item.externalId}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => edit(item)}
                  disabled={!canEdit || pending}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggle(item)}
                  disabled={!canEdit || pending}
                >
                  {item.active ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Edit TAO assessment" : "Add TAO assessment"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="Display name">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </FormField>
            <FormField label="Description">
              <Input
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </FormField>
            <FormField label="TAO delivery ID">
              <Input
                className="font-mono text-xs"
                value={form.externalId}
                onChange={(event) =>
                  setForm({ ...form, externalId: event.target.value })
                }
              />
            </FormField>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <Label htmlFor="tao-assessment-active">Active</Label>
              <Switch
                id="tao-assessment-active"
                checked={form.active}
                onCheckedChange={(active) => setForm({ ...form, active })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={pending || !form.name.trim() || !form.externalId.trim()}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
