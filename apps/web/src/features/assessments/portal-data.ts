import "server-only";

import { and, eq } from "drizzle-orm";

import {
  applications,
  assessmentAssignments,
  assessmentDefinitions,
  db,
} from "@harly/db";

export async function getPortalAssessmentAssignment(input: {
  assignmentId: string;
  organizationId: string;
  candidateId: string;
}) {
  const [row] = await db
    .select({
      id: assessmentAssignments.id,
      applicationId: assessmentAssignments.applicationId,
      assessmentName: assessmentDefinitions.name,
      status: assessmentAssignments.status,
      definitionActive: assessmentDefinitions.active,
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
        eq(assessmentAssignments.id, input.assignmentId),
        eq(assessmentAssignments.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}
