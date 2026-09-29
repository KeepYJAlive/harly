"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ClipboardCheck, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { TaoAssessmentDefinitionItem } from "@/features/assessments/types";
import { saveStageAssessmentConfigurationAction } from "@/features/assessments/stage-actions";
import { toast } from "@/lib/notification-island/toast";

type StageOption = {
  id: string;
  name: string;
  assignAssessmentsOnEntry: boolean;
};

export function filterTaoAssessmentOptions(
  assessments: TaoAssessmentDefinitionItem[],
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return assessments;
  return assessments.filter(
    (assessment) =>
      assessment.name.toLocaleLowerCase().includes(query) ||
      assessment.externalId.toLocaleLowerCase().includes(query),
  );
}

export function toggleAssessmentSelection(
  selected: string[],
  id: string,
  checked: boolean,
) {
  return checked
    ? selected.includes(id)
      ? selected
      : [...selected, id]
    : selected.filter((candidate) => candidate !== id);
}

export function PipelineStageAssessmentsDialog({
  jobId,
  stages,
  assessments,
  configuredDefinitionIdsByStage,
  taoEnabled,
  canEdit,
}: {
  jobId: string;
  stages: StageOption[];
  assessments: TaoAssessmentDefinitionItem[];
  configuredDefinitionIdsByStage: Record<string, string[]>;
  taoEnabled: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [enabled, setEnabled] = useState(
    stages[0]?.assignAssessmentsOnEntry ?? false,
  );
  const [selected, setSelected] = useState<string[]>(
    configuredDefinitionIdsByStage[stages[0]?.id ?? ""] ?? [],
  );
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();

  const filteredAssessments = useMemo(() => {
    return filterTaoAssessmentOptions(assessments, search);
  }, [assessments, search]);

  function selectStage(nextStageId: string) {
    const stage = stages.find((item) => item.id === nextStageId);
    setStageId(nextStageId);
    setEnabled(stage?.assignAssessmentsOnEntry ?? false);
    setSelected(configuredDefinitionIdsByStage[nextStageId] ?? []);
    setSearch("");
  }

  function toggleAssessment(id: string, checked: boolean) {
    setSelected((current) => toggleAssessmentSelection(current, id, checked));
  }

  function save() {
    startTransition(async () => {
      const result = await saveStageAssessmentConfigurationAction({
        jobId,
        stageId,
        enabled,
        assessmentDefinitionIds: enabled ? selected : [],
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save stage assessments.");
        return;
      }
      toast.success("Stage assessments updated");
      setOpen(false);
      router.refresh();
    });
  }

  const controlsDisabled = !taoEnabled || !canEdit || pending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={stages.length === 0}>
          <ClipboardCheck className="size-4" /> Stage assessments
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pipeline stage assessments</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Pipeline stage</Label>
            <Select value={stageId} onValueChange={selectStage}>
              <SelectTrigger>
                <SelectValue placeholder="Select a stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!taoEnabled ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              Enable the TAO integration before changing this configuration.
              Existing selections are preserved.
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3">
            <div>
              <Label htmlFor="assign-stage-assessments">
                Assign assessments on entry
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Creates local Harly assignments when an applicant enters this
                stage.
              </p>
            </div>
            <Switch
              id="assign-stage-assessments"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={controlsDisabled}
            />
          </div>

          {enabled ? (
            <div className="space-y-2">
              <Label>Assessments</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  aria-label="Search assessments"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search assessments or delivery IDs"
                  className="pl-9"
                />
              </div>
              <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                {filteredAssessments.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No assessments match your search.
                  </p>
                ) : (
                  filteredAssessments.map((assessment) => {
                    const checked = selected.includes(assessment.id);
                    return (
                      <label
                        key={assessment.id}
                        className="flex cursor-pointer items-start gap-3 px-3 py-3"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            toggleAssessment(assessment.id, value === true)
                          }
                          disabled={
                            controlsDisabled || (!assessment.active && !checked)
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {assessment.name}
                            {!assessment.active ? (
                              <span className="text-xs font-normal text-muted-foreground">
                                Inactive
                              </span>
                            ) : checked ? (
                              <Check className="size-3.5 text-primary" />
                            ) : null}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {assessment.externalId}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              controlsDisabled || !stageId || (enabled && selected.length === 0)
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
