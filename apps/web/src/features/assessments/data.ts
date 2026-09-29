import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  applications,
  assessmentAssignments,
  assessmentDefinitions,
  db,
  jobs,
  jobStages,
} from "@harly/db";

import type {
  AssessmentAssignmentItem,
  TaoAssessmentDefinitionItem,
} from "./types";

export async function listTaoAssessmentDefinitions(
  organizationId: string,
  options: { activeOnly?: boolean } = {},
): Promise<TaoAssessmentDefinitionItem[]> {
  const predicates = [
    eq(assessmentDefinitions.organizationId, organizationId),
    eq(assessmentDefinitions.provider, "tao"),
  ];
  if (options.activeOnly)
    predicates.push(eq(assessmentDefinitions.active, true));

  return db
    .select({
      id: assessmentDefinitions.id,
      name: assessmentDefinitions.name,
      description: assessmentDefinitions.description,
      externalId: assessmentDefinitions.externalId,
      active: assessmentDefinitions.active,
    })
    .from(assessmentDefinitions)
    .where(and(...predicates))
    .orderBy(asc(assessmentDefinitions.name));
}

export async function listAssessmentAssignmentsForCandidate(
  organizationId: string,
  candidateId: string,
): Promise<AssessmentAssignmentItem[]> {
  const rows = await db
    .select({
      id: assessmentAssignments.id,
      applicationId: assessmentAssignments.applicationId,
      jobTitle: jobs.title,
      assessmentName: assessmentDefinitions.name,
      status: assessmentAssignments.status,
      assignedAt: assessmentAssignments.assignedAt,
      startedAt: assessmentAssignments.startedAt,
      completedAt: assessmentAssignments.completedAt,
      expiresAt: assessmentAssignments.expiresAt,
      score: assessmentAssignments.score,
      maxScore: assessmentAssignments.maxScore,
      sourceStageName: jobStages.name,
    })
    .from(assessmentAssignments)
    .innerJoin(
      applications,
      and(
        eq(applications.id, assessmentAssignments.applicationId),
        eq(applications.workspaceId, organizationId),
        eq(applications.candidateId, candidateId),
      ),
    )
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(
          assessmentDefinitions.id,
          assessmentAssignments.assessmentDefinitionId,
        ),
        eq(assessmentDefinitions.organizationId, organizationId),
      ),
    )
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(
      jobStages,
      and(
        eq(jobStages.id, assessmentAssignments.sourceStageId),
        eq(jobStages.workspaceId, organizationId),
      ),
    )
    .where(eq(assessmentAssignments.organizationId, organizationId))
    .orderBy(desc(assessmentAssignments.assignedAt));

  return rows.map((row) => ({
    ...row,
    assignedAt: row.assignedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  }));
}

export async function listAssignmentsForApplications(
  organizationId: string,
  applicationIds: string[],
) {
  if (applicationIds.length === 0) return [];
  return db
    .select({ id: assessmentAssignments.id })
    .from(assessmentAssignments)
    .where(
      and(
        eq(assessmentAssignments.organizationId, organizationId),
        inArray(assessmentAssignments.applicationId, applicationIds),
      ),
    );
}

export async function listPortalAssessmentAssignments(input: {
  organizationId: string;
  candidateId: string;
  applicationId: string;
}) {
  return db
    .select({
      id: assessmentAssignments.id,
      assessmentName: assessmentDefinitions.name,
      description: assessmentDefinitions.description,
      definitionActive: assessmentDefinitions.active,
      status: assessmentAssignments.status,
      assignedAt: assessmentAssignments.assignedAt,
      startedAt: assessmentAssignments.startedAt,
      completedAt: assessmentAssignments.completedAt,
      expiresAt: assessmentAssignments.expiresAt,
    })
    .from(assessmentAssignments)
    .innerJoin(
      applications,
      and(
        eq(applications.id, assessmentAssignments.applicationId),
        eq(applications.workspaceId, assessmentAssignments.organizationId),
        eq(applications.candidateId, input.candidateId),
      ),
    )
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(
          assessmentDefinitions.id,
          assessmentAssignments.assessmentDefinitionId,
        ),
        eq(
          assessmentDefinitions.organizationId,
          assessmentAssignments.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(assessmentAssignments.organizationId, input.organizationId),
        eq(assessmentAssignments.applicationId, input.applicationId),
      ),
    )
    .orderBy(desc(assessmentAssignments.assignedAt));
}
