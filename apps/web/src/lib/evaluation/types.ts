import type { TextProvenance } from "./ats-parser";

export type CriterionType =
  | "skill"
  | "experience_duration"
  | "experience_years"
  | "education"
  | "domain_title"
  | "certification"
  | "license_authorization"
  | "language"
  | "location_availability"
  | "custom";

export type CriterionImportance = "required" | "preferred";

export type CriterionOrigin =
  | "structured_job_field"
  | "recruiter_rubric"
  | "job_description"
  | "application_question"
  | "ai_suggested";

export type CriterionStatus =
  | "met"
  | "partially_met"
  | "not_met"
  | "not_demonstrated"
  | "unknown";

export type EvidenceStrength =
  | "demonstrated"
  | "declared"
  | "credentialed"
  | "inferred_assist"
  | "unsubstantiated";

export type MatchMethod =
  | "deterministic_exact"
  | "deterministic_stem"
  | "built_in_alias"
  | "recruiter_alias"
  | "structural_date_calc"
  | "ai_resolved";

export interface CriterionMatchEvidence {
  verbatimSnippet: string;
  strength: EvidenceStrength;
  method: MatchMethod;
  confidence: number;
  aiResolutionDetails?: {
    modelId: string;
    rationale: string;
    rawEquivalenceConfidence: number;
  };
  provenance: TextProvenance;
  canonicalSkillName?: string;
  relevantDurationMonths?: number;
}

export interface StructuredCriterionResult {
  criterionId: string;
  label: string;
  type: CriterionType;
  status: CriterionStatus;
  rawScore: number | null;
  weight: number;
  importance: CriterionImportance;
  isKnockout: boolean;
  knockoutFailed: boolean;
  evidence: CriterionMatchEvidence | null;
  missingReason: string | null;
}
