import "server-only";

import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

import { ApiError, type Cursor } from "@harly/api";
import {
  db,
  jobApprovalRequests,
  jobHiringTeam,
  jobs,
  jobStages,
  type Job,
} from "@harly/db";

import { emitWebhookEvent } from "@/server/webhooks/emit";
import { getHarlyPublicOrigin } from "@/lib/public-origin";
import {
  persistDomainEvent,
  publishPersistedDomainEvents,
} from "@/server/events/emit";

import { generateUniqueJobSlug } from "./data";
import type { JobStatus } from "./validation";

/**
 * Workspace-scoped job service consumed by the REST API. Session-free: every
 * function takes an explicit `workspaceId` (resolved from the API key) so the
 * same logic is reusable outside a user session.
 */

const DEFAULT_EMPLOYMENT_STAGES = [
  { name: "Applied", color: "#E0F2FE" },
  { name: "Screening", color: "#F5F3FF" },
  { name: "Interview", color: "#FEF3C7" },
  { name: "Offer", color: "#DCFCE7" },
  { name: "Hired", color: "#CCFBF1" },
  { name: "Rejected", color: "#FEE2E2" },
];

const DEFAULT_VOLUNTEER_STAGES = [
  { name: "Applied", color: "#E0F2FE" },
  { name: "Screening", color: "#F5F3FF" },
  { name: "Interview", color: "#FEF3C7" },
  { name: "Accepted", color: "#CCFBF1" },
  { name: "Not Selected", color: "#FEE2E2" },
];

export type JobApiInput = {
  title: string;
  description: string;
  slug?: string;
  department?: string | null;
  location?: string | null;
  opportunityType?: Job["opportunityType"];
  employmentType?: Job["employmentType"];
  workplaceType: Job["workplaceType"];
  experienceLevel?: string | null;
  status?: JobStatus;
  requirements?: string | null;
  benefits?: string | null;
  keywords?: string[];
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  salaryPeriod?: string | null;
  minimumHours?: number | null;
  commitmentPeriod?: Job["commitmentPeriod"];
  scheduleNotes?: string | null;
};

export function serializeJob(job: Job) {
  return {
    id: job.id,
    title: job.title,
    slug: job.slug,
    status: job.status,
    department: job.department,
    location: job.location,
    opportunityType: job.opportunityType,
    employmentType: job.employmentType,
    workplaceType: job.workplaceType,
    description: job.description,
    requirements: job.requirements,
    benefits: job.benefits,
    keywords: job.keywords,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
    salaryPeriod: job.salaryPeriod,
    minimumHours: job.minimumHours,
    commitmentPeriod: job.commitmentPeriod,
    scheduleNotes: job.scheduleNotes,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function appBaseUrl(): string {
  return getHarlyPublicOrigin();
}

/** Public (unauthenticated) job shape for the embed widget / board API. */
export function serializePublicJob(job: Job, workspaceSlug: string) {
  const base = appBaseUrl();
  return {
    id: job.id,
    slug: job.slug,
    title: job.title,
    department: job.department,
    location: job.location,
    opportunityType: job.opportunityType,
    employmentType: job.employmentType,
    workplaceType: job.workplaceType,
    description: job.description,
    requirements: job.requirements,
    benefits: job.benefits,
    keywords: job.keywords,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
    salaryPeriod: job.salaryPeriod,
    minimumHours: job.minimumHours,
    commitmentPeriod: job.commitmentPeriod,
    scheduleNotes: job.scheduleNotes,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    // Where the company's careers page can deep-link for the hosted apply flow.
    hostedApplyUrl: `${base}/board/${workspaceSlug}/apply/${job.slug}`,
    boardUrl: `${base}/board/${workspaceSlug}`,
  };
}

/** Cursor predicate for (createdAt desc, id desc) keyset pagination. */
function cursorWhere(cursor: Cursor | null) {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return or(
    lt(jobs.createdAt, createdAt),
    and(eq(jobs.createdAt, createdAt), lt(jobs.id, cursor.id)),
  );
}

export async function listJobsForApi(input: {
  workspaceId: string;
  status?: JobStatus;
  opportunityType?: Job["opportunityType"];
  cursor: Cursor | null;
  limit: number;
}): Promise<Job[]> {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, input.workspaceId),
        isNull(jobs.deletedAt),
        input.status ? eq(jobs.status, input.status) : undefined,
        input.opportunityType
          ? eq(jobs.opportunityType, input.opportunityType)
          : undefined,
        cursorWhere(input.cursor),
      ),
    )
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(input.limit + 1);
}

export async function getJobForApi(input: {
  workspaceId: string;
  jobId: string;
}): Promise<Job> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, input.jobId),
        eq(jobs.workspaceId, input.workspaceId),
        isNull(jobs.deletedAt),
      ),
    )
    .limit(1);
  if (!job) throw ApiError.notFound("Job not found.");
  return job;
}

export async function createJobForApi(input: {
  workspaceId: string;
  actorUserId: string;
  values: JobApiInput;
}): Promise<Job> {
  const { workspaceId, actorUserId, values } = input;
  const slug = await generateUniqueJobSlug(
    workspaceId,
    values.slug ?? values.title,
  );
  const status: JobStatus = values.status ?? "draft";
  const opportunityType = values.opportunityType ?? "employment";
  if (opportunityType === "employment" && !values.employmentType) {
    throw ApiError.unprocessable(
      "employmentType is required for employment opportunities.",
    );
  }
  if (
    opportunityType === "volunteer" &&
    (!values.minimumHours || !values.commitmentPeriod)
  ) {
    throw ApiError.unprocessable(
      "minimumHours and commitmentPeriod are required for volunteer opportunities.",
    );
  }

  const { job, event } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(jobs)
      .values({
        workspaceId,
        title: values.title,
        slug,
        description: values.description,
        department: values.department ?? null,
        location: values.location ?? null,
        opportunityType,
        employmentType:
          opportunityType === "employment" ? values.employmentType : null,
        workplaceType: values.workplaceType,
        experienceLevel: values.experienceLevel ?? null,
        requirements: values.requirements ?? null,
        benefits: values.benefits ?? null,
        keywords: values.keywords ?? [],
        salaryMin:
          opportunityType === "employment" ? (values.salaryMin ?? null) : null,
        salaryMax:
          opportunityType === "employment" ? (values.salaryMax ?? null) : null,
        currency:
          opportunityType === "employment" ? (values.currency ?? null) : null,
        salaryPeriod:
          opportunityType === "employment"
            ? (values.salaryPeriod ?? null)
            : null,
        minimumHours:
          opportunityType === "volunteer" ? values.minimumHours : null,
        commitmentPeriod:
          opportunityType === "volunteer" ? values.commitmentPeriod : null,
        scheduleNotes:
          opportunityType === "volunteer"
            ? (values.scheduleNotes ?? null)
            : null,
        status,
        publishedAt: status === "open" ? new Date() : null,
        createdById: actorUserId,
      })
      .returning();

    await tx.insert(jobStages).values(
      (opportunityType === "volunteer"
        ? DEFAULT_VOLUNTEER_STAGES
        : DEFAULT_EMPLOYMENT_STAGES
      ).map((stage, index) => ({
        workspaceId,
        jobId: created.id,
        name: stage.name,
        color: stage.color,
        order: index + 1,
      })),
    );

    // API-created jobs should behave exactly like dashboard-created jobs:
    // the caller is the initial, accountable recruiter for the role.
    await tx.insert(jobHiringTeam).values({
      workspaceId,
      jobId: created.id,
      userId: actorUserId,
      role: "recruiter",
    });

    if (status !== "open") return { job: created, event: null };
    return {
      job: created,
      event: await persistDomainEvent(tx, {
        name: "job.published",
        workspaceId,
        actorId: actorUserId,
        aggregateType: "job",
        aggregateId: created.id,
        payload: { job: serializeJob(created) },
      }),
    };
  });

  if (event) {
    await publishPersistedDomainEvents([event]);
    await emitWebhookEvent(
      workspaceId,
      "job.published",
      {
        job: serializeJob(job),
      },
      { actorId: actorUserId, skipDomainEvent: true },
    );
  }
  return job;
}

export async function updateJobForApi(input: {
  workspaceId: string;
  jobId: string;
  values: Partial<JobApiInput>;
}): Promise<Job> {
  const existing = await getJobForApi({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
  });

  const nextStatus = input.values.status ?? existing.status;
  const nextOpportunityType =
    input.values.opportunityType ?? existing.opportunityType;
  const nextEmploymentType =
    nextOpportunityType === "employment"
      ? (input.values.employmentType ?? existing.employmentType)
      : null;
  const nextMinimumHours =
    nextOpportunityType === "volunteer"
      ? (input.values.minimumHours ?? existing.minimumHours)
      : null;
  const nextCommitmentPeriod =
    nextOpportunityType === "volunteer"
      ? (input.values.commitmentPeriod ?? existing.commitmentPeriod)
      : null;
  if (nextOpportunityType === "employment" && !nextEmploymentType) {
    throw ApiError.unprocessable(
      "employmentType is required for employment opportunities.",
    );
  }
  if (
    nextOpportunityType === "volunteer" &&
    (!nextMinimumHours || !nextCommitmentPeriod)
  ) {
    throw ApiError.unprocessable(
      "minimumHours and commitmentPeriod are required for volunteer opportunities.",
    );
  }
  if (nextStatus === "open") {
    const [pending] = await db
      .select({ id: jobApprovalRequests.id })
      .from(jobApprovalRequests)
      .where(
        and(
          eq(jobApprovalRequests.workspaceId, input.workspaceId),
          eq(jobApprovalRequests.jobId, input.jobId),
          eq(jobApprovalRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) throw ApiError.conflict("Job has a pending approval request.");
  }
  const becomesPublished =
    nextStatus === "open" &&
    (existing.status !== "open" || !existing.publishedAt);

  const { updated, event } = await db.transaction(async (tx) => {
    const [next] = await tx
      .update(jobs)
      .set({
        title: input.values.title ?? existing.title,
        description: input.values.description ?? existing.description,
        department: input.values.department ?? existing.department,
        location: input.values.location ?? existing.location,
        opportunityType: nextOpportunityType,
        employmentType: nextEmploymentType,
        workplaceType: input.values.workplaceType ?? existing.workplaceType,
        requirements: input.values.requirements ?? existing.requirements,
        benefits: input.values.benefits ?? existing.benefits,
        keywords: input.values.keywords ?? (existing.keywords as string[]),
        salaryMin:
          nextOpportunityType === "employment"
            ? (input.values.salaryMin ?? existing.salaryMin)
            : null,
        salaryMax:
          nextOpportunityType === "employment"
            ? (input.values.salaryMax ?? existing.salaryMax)
            : null,
        currency:
          nextOpportunityType === "employment"
            ? (input.values.currency ?? existing.currency)
            : null,
        salaryPeriod:
          nextOpportunityType === "employment"
            ? (input.values.salaryPeriod ?? existing.salaryPeriod)
            : null,
        minimumHours: nextMinimumHours,
        commitmentPeriod: nextCommitmentPeriod,
        scheduleNotes:
          nextOpportunityType === "volunteer"
            ? (input.values.scheduleNotes ?? existing.scheduleNotes)
            : null,
        status: nextStatus,
        publishedAt:
          nextStatus === "open"
            ? becomesPublished
              ? new Date()
              : existing.publishedAt
            : null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(jobs.id, input.jobId), eq(jobs.workspaceId, input.workspaceId)),
      )
      .returning();
    if (!next) throw ApiError.notFound("Job not found.");

    const terminalStageRenames =
      nextOpportunityType === "volunteer"
        ? [
            ["Hired", "Accepted"],
            ["Rejected", "Not Selected"],
          ]
        : [
            ["Accepted", "Hired"],
            ["Not Selected", "Rejected"],
          ];
    for (const [fromName, toName] of terminalStageRenames) {
      await tx
        .update(jobStages)
        .set({ name: toName, updatedAt: new Date() })
        .where(
          and(
            eq(jobStages.workspaceId, input.workspaceId),
            eq(jobStages.jobId, input.jobId),
            eq(jobStages.name, fromName),
          ),
        );
    }
    return {
      updated: next,
      event: becomesPublished
        ? await persistDomainEvent(tx, {
            name: "job.published",
            workspaceId: input.workspaceId,
            aggregateType: "job",
            aggregateId: next.id,
            payload: { job: serializeJob(next) },
          })
        : null,
    };
  });

  if (event) {
    await publishPersistedDomainEvents([event]);
    await emitWebhookEvent(
      input.workspaceId,
      "job.published",
      {
        job: serializeJob(updated),
      },
      { skipDomainEvent: true },
    );
  }
  return updated;
}

export async function setJobStatusForApi(input: {
  workspaceId: string;
  jobId: string;
  status: JobStatus;
}): Promise<Job> {
  return updateJobForApi({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    values: { status: input.status },
  });
}

export async function deleteJobForApi(input: {
  workspaceId: string;
  jobId: string;
}): Promise<void> {
  await getJobForApi({ workspaceId: input.workspaceId, jobId: input.jobId });
  await db
    .update(jobs)
    .set({
      deletedAt: new Date(),
      status: "closed",
      publishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, input.jobId),
        eq(jobs.workspaceId, input.workspaceId),
        isNull(jobs.deletedAt),
      ),
    );
}
