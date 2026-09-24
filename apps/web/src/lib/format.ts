export function formatEmploymentType(value: string) {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatOpportunityType(value: string) {
  return value === "volunteer"
    ? "Volunteer Opportunity"
    : "Career Opportunity";
}

export function formatMinimumTimeCommitment(
  minimumHours: number | null | undefined,
  commitmentPeriod: string | null | undefined,
  options?: { compact?: boolean },
) {
  if (!minimumHours || !commitmentPeriod) return null;
  const period = commitmentPeriod === "week" ? "week" : "month";
  return options?.compact
    ? `${minimumHours} hours/${period}`
    : `${minimumHours} hours per ${period}`;
}

export function formatWorkplaceType(value: string) {
  return value[0]?.toUpperCase() + value.slice(1);
}

export function formatJobStatus(value: string) {
  return value[0]?.toUpperCase() + value.slice(1);
}

/** snake_case / lowercase → Title Case (e.g. "culture_fit" → "Culture Fit"). */
export function formatEnumLabel(value: string) {
  return value
    .split("_")
    .map((part) => (part[0]?.toUpperCase() ?? "") + part.slice(1))
    .join(" ");
}
