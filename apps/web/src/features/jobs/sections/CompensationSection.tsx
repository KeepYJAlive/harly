import type { Job } from "@harly/db";

import {
  FieldBox,
  fieldBoxControlClassName,
  fieldBoxSelectTriggerClassName,
} from "@/components/ui/field-box";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const currencies = ["USD", "EUR", "GBP", "CLP", "MXN", "ARS", "BRL", "COP"];

export function CompensationSection({
  job,
  opportunityType,
}: {
  job?: Job;
  opportunityType: "employment" | "volunteer";
}) {
  if (opportunityType === "volunteer") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Volunteer opportunities use a time commitment instead of salary or
          compensation fields.
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label="Minimum hours"
            htmlFor="minimumHours"
            hint="Structured minimum time commitment."
            required
          >
            <Input
              id="minimumHours"
              name="minimumHours"
              type="number"
              min="1"
              step="1"
              defaultValue={job?.minimumHours ?? ""}
              placeholder="5"
              className={fieldBoxControlClassName}
            />
          </FieldBox>
          <FieldBox
            label="Commitment period"
            htmlFor="commitmentPeriod"
            required
          >
            <Select
              name="commitmentPeriod"
              defaultValue={job?.commitmentPeriod ?? "month"}
            >
              <SelectTrigger
                id="commitmentPeriod"
                className={fieldBoxSelectTriggerClassName}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Per week</SelectItem>
                <SelectItem value="month">Per month</SelectItem>
              </SelectContent>
            </Select>
          </FieldBox>
        </div>
        <FieldBox
          label="Schedule / availability notes"
          htmlFor="scheduleNotes"
          hint="Optional details such as preferred days, time zones, or flexible scheduling."
        >
          <Textarea
            id="scheduleNotes"
            name="scheduleNotes"
            defaultValue={job?.scheduleNotes ?? ""}
            placeholder="Flexible schedule; availability during Pacific Time overlap is helpful."
            rows={4}
          />
        </FieldBox>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <FieldBox label="Salary min" htmlFor="salaryMin">
          <Input
            id="salaryMin"
            name="salaryMin"
            type="number"
            min="0"
            defaultValue={job?.salaryMin ?? ""}
            className={fieldBoxControlClassName}
          />
        </FieldBox>
        <FieldBox label="Salary max" htmlFor="salaryMax">
          <Input
            id="salaryMax"
            name="salaryMax"
            type="number"
            min="0"
            defaultValue={job?.salaryMax ?? ""}
            className={fieldBoxControlClassName}
          />
        </FieldBox>
        <FieldBox label="Currency" htmlFor="currency">
          <Select name="currency" defaultValue={job?.currency ?? "USD"}>
            <SelectTrigger
              id="currency"
              className={fieldBoxSelectTriggerClassName}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldBox>
        <FieldBox label="Period" htmlFor="salaryPeriod">
          <Select
            name="salaryPeriod"
            defaultValue={job?.salaryPeriod ?? "annual"}
          >
            <SelectTrigger
              id="salaryPeriod"
              className={fieldBoxSelectTriggerClassName}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="annual">Per year</SelectItem>
              <SelectItem value="monthly">Per month</SelectItem>
            </SelectContent>
          </Select>
        </FieldBox>
      </div>
    </div>
  );
}
