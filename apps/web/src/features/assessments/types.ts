export type TaoAssessmentDefinitionItem = {
  id: string;
  name: string;
  description: string | null;
  externalId: string;
  active: boolean;
};

export type AssessmentAssignmentItem = {
  id: string;
  applicationId: string;
  jobTitle: string;
  assessmentName: string;
  status:
    | "assigned"
    | "started"
    | "completed"
    | "expired"
    | "cancelled"
    | "error";
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  score: number | null;
  maxScore: number | null;
  sourceStageName: string | null;
};
