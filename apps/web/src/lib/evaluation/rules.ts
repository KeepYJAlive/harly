import type { CandidateScore } from "@/lib/ai/schemas";
import { parseResumeFacts } from "./ats-parser";
import { buildStructuredCriteria } from "./criteria-builder";
import { matchCriteriaAgainstFacts } from "./ats-matcher";
import type { EvaluationMode } from "./mode";
import type {
  CriterionImportance,
  CriterionOrigin,
  CriterionStatus,
  CriterionType,
  EvidenceStrength,
  MatchMethod,
  StructuredCriterionResult,
} from "./types";

export * from "./types";

/** Immutable engine identifier persisted with every evaluation. */
export const RULES_EVALUATION_VERSION = "rules-v4";

/** Centralized, calibratable scoring and tier constants */
export const SCORING_CONSTANTS = {
  /** Neutral baseline score for unverified/not_demonstrated criteria */
  UNVERIFIED_EVIDENCE_BASELINE: 40,
  /** Multiplier for preferred criteria weight */
  PREFERRED_WEIGHT_FACTOR: 0.5,
  /** Multiplier for required criteria weight */
  REQUIRED_WEIGHT_FACTOR: 1.0,
  /** Strong Yes tier thresholds */
  STRONG_YES_MIN_SCORE: 85,
  STRONG_YES_MIN_COVERAGE: 80,
  STRONG_YES_MIN_CONFIDENCE: 75,
  /** Yes tier thresholds */
  YES_MIN_SCORE: 70,
  YES_MIN_COVERAGE: 65,
  /** Maybe tier minimum threshold */
  MAYBE_MIN_SCORE: 45,
} as const;

export type RulesCriterion = {
  key: string;
  label: string;
  type: CriterionType;
  importance: CriterionImportance;
  weight: number;
  aliases: string[];
  minimumValue?: number;
  isKnockout?: boolean;
};

export type RulesRubric = {
  version: string;
  criteria: RulesCriterion[];
};

export type RuleCriterionResult = {
  key: string;
  label: string;
  status: "met" | "not_met" | "unknown";
  score: number | null;
  weight: number;
  evidence: string | null;
  evidenceSource: "resume" | "profile" | "evaluation" | null;
  confidence: number;
  missingReason: string | null;
  // Extended v4 fields:
  extendedStatus?: CriterionStatus;
  evidenceStrength?: EvidenceStrength;
  matchMethod?: MatchMethod;
  isKnockout?: boolean;
};

export type RulesEvaluation = {
  result: CandidateScore;
  rubric: RulesRubric;
  criterionResults: RuleCriterionResult[];
  evidenceCoverage: number;
  confidence: number;
  requiresHumanReview: boolean;
  // Extended v4 metrics:
  demonstratedScore: number;
  coverageAdjustedScore: number;
};

export type RulesInput = {
  job: {
    title: string;
    description: string;
    requirements: string | null;
    sector?: string | null;
    experienceLevel: string | null;
    education: string | null;
    keywords: string[];
    evaluationMode?: EvaluationMode;
  };
  candidate: {
    fullName?: string;
    headline?: string | null;
    location?: string | null;
    resumeText: string | null;
    answers: Array<{ question: string; answer: string }>;
    skills?: string[];
    experienceYears?: number | null;
  };
  rubric?: RulesRubric;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Deterministic candidate evaluation with coverage-adjusted score shrinkage.
 */
export function evaluateCandidateWithRules(input: RulesInput): RulesEvaluation {
  const resumeText = input.candidate.resumeText ?? "";
  const facts = parseResumeFacts(resumeText);

  // If candidate had explicit experience years in DB that exceed parsed, use maximum
  if (input.candidate.experienceYears && input.candidate.experienceYears > facts.totalExperienceYears) {
    facts.totalExperienceYears = input.candidate.experienceYears;
    facts.totalWorkDurationMonths = Math.round(input.candidate.experienceYears * 12);
  }

  const structuredCriteria = buildStructuredCriteria(input);
  const matchedResults = matchCriteriaAgainstFacts(structuredCriteria, facts, {
    answers: input.candidate.answers,
    profileSkills: input.candidate.skills,
  });

  // Calculate weighted demonstrated score and evidence coverage
  let totalRubricWeight = 0;
  let scoredRubricWeight = 0;
  let weightedDemonstratedSum = 0;
  let confidenceSum = 0;

  for (const cr of matchedResults) {
    const importanceFactor =
      cr.importance === "required"
        ? SCORING_CONSTANTS.REQUIRED_WEIGHT_FACTOR
        : SCORING_CONSTANTS.PREFERRED_WEIGHT_FACTOR;
    const effectiveWeight = cr.weight * importanceFactor;
    totalRubricWeight += effectiveWeight;

    if (cr.rawScore !== null) {
      scoredRubricWeight += effectiveWeight;
      weightedDemonstratedSum += effectiveWeight * cr.rawScore;
      confidenceSum += cr.evidence?.confidence ?? 80;
    }
  }

  const scoredCount = matchedResults.filter((r) => r.rawScore !== null).length;
  const demonstratedScore = scoredRubricWeight > 0
    ? clamp(weightedDemonstratedSum / scoredRubricWeight)
    : 0;

  const rawCoverage = totalRubricWeight > 0 ? (scoredRubricWeight / totalRubricWeight) * 100 : 0;
  const evidenceCoverage = clamp(rawCoverage);

  // Coverage-adjusted score with shrinkage toward neutral baseline (40)
  const coverageRatio = evidenceCoverage / 100;
  const coverageAdjustedScore = clamp(
    coverageRatio * demonstratedScore + (1 - coverageRatio) * SCORING_CONSTANTS.UNVERIFIED_EVIDENCE_BASELINE,
  );

  const confidence = scoredCount > 0
    ? clamp(confidenceSum / scoredCount)
    : 0;

  // Determine Knockout Failures
  const anyKnockoutFailed = matchedResults.some((r) => r.knockoutFailed);

  // Required criteria inspection
  const requiredCriteria = matchedResults.filter((r) => r.importance === "required");
  const requiredNotMetCount = requiredCriteria.filter((r) => r.status === "not_met").length;
  const requiredUnverifiedCount = requiredCriteria.filter(
    (r) => r.status === "not_demonstrated" || r.status === "unknown",
  ).length;

  // Recommendation Tiers (Deterministic)
  let recommendation: CandidateScore["recommendation"] = "maybe";

  if (anyKnockoutFailed || requiredNotMetCount >= 2 || coverageAdjustedScore < SCORING_CONSTANTS.MAYBE_MIN_SCORE) {
    recommendation = "no";
  } else if (
    coverageAdjustedScore >= SCORING_CONSTANTS.STRONG_YES_MIN_SCORE &&
    evidenceCoverage >= SCORING_CONSTANTS.STRONG_YES_MIN_COVERAGE &&
    confidence >= SCORING_CONSTANTS.STRONG_YES_MIN_CONFIDENCE &&
    requiredNotMetCount === 0 &&
    requiredUnverifiedCount === 0
  ) {
    // Note: Preferred criteria do not block Strong Yes!
    recommendation = "strong_yes";
  } else if (
    coverageAdjustedScore >= SCORING_CONSTANTS.YES_MIN_SCORE &&
    evidenceCoverage >= SCORING_CONSTANTS.YES_MIN_COVERAGE &&
    requiredNotMetCount === 0 &&
    requiredUnverifiedCount <= 1
  ) {
    recommendation = "yes";
  } else {
    recommendation = "maybe";
  }

  // Human Review Required Trigger
  const requiresHumanReview =
    anyKnockoutFailed ||
    requiredUnverifiedCount > 0 ||
    evidenceCoverage < SCORING_CONSTANTS.STRONG_YES_MIN_COVERAGE ||
    confidence < 70 ||
    facts.workTimelineConfidence === "low";

  // Map to backwards-compatible RuleCriterionResult
  const criterionResults: RuleCriterionResult[] = matchedResults.map((m) => {
    let legacyStatus: "met" | "not_met" | "unknown" = "unknown";
    if (m.status === "met") legacyStatus = "met";
    else if (m.status === "not_met") legacyStatus = "not_met";
    else legacyStatus = "unknown";

    return {
      key: m.criterionId,
      label: m.label,
      status: legacyStatus,
      score: m.rawScore,
      weight: m.weight,
      evidence: m.evidence?.verbatimSnippet ?? null,
      evidenceSource: m.evidence ? (m.evidence.provenance.sourceType === "resume" ? "resume" : "profile") : null,
      confidence: m.evidence?.confidence ?? 0,
      missingReason: m.missingReason,
      extendedStatus: m.status,
      evidenceStrength: m.evidence?.strength,
      matchMethod: m.evidence?.method,
      isKnockout: m.isKnockout,
    };
  });

  // Strengths & Gaps Synthesis
  const strengths: string[] = [];
  if (facts.workHistory.length > 0 && facts.totalExperienceYears >= 2) {
    strengths.push(
      `Experience: ${facts.totalExperienceYears} years of verified background across ${facts.workHistory.length} roles (${facts.workHistory.map((w) => w.company).slice(0, 3).join(", ")}).`,
    );
  }
  for (const m of matchedResults) {
    if (m.status === "met" && m.evidence && m.type !== "experience_duration") {
      strengths.push(`${m.label}: ${m.evidence.verbatimSnippet}`);
    }
  }

  const gaps: string[] = [];
  for (const m of matchedResults) {
    if (m.status === "not_met") {
      gaps.push(`${m.label}: ${m.missingReason ?? "Did not meet stated requirement."}`);
    } else if (m.status === "not_demonstrated" && m.importance === "required") {
      gaps.push(`${m.label}: Unverified — ${m.missingReason ?? "No mention in resume."}`);
    }
  }

  const criteriaResult = criterionResults.map((c) => ({
    label: c.label,
    score: c.score ?? 0,
    evidence: c.evidence,
  }));

  const summary = requiresHumanReview
    ? `Automatic evaluation verified ${scoredCount}/${matchedResults.length} criteria (${evidenceCoverage}% coverage). Human review is recommended because some required information is unverified or incomplete.`
    : `Automatic evaluation verified ${scoredCount}/${matchedResults.length} criteria with high confidence (${evidenceCoverage}% coverage, ${confidence}% confidence).`;

  const rubric: RulesRubric = input.rubric ?? {
    version: RULES_EVALUATION_VERSION,
    criteria: structuredCriteria.map((c) => ({
      key: c.id,
      label: c.label,
      type: c.type,
      importance: c.importance,
      weight: c.weight,
      aliases: c.recruiterAliases,
      minimumValue: c.minimumMonths ? Math.round(c.minimumMonths / 12) : undefined,
    })),
  };

  return {
    rubric,
    criterionResults,
    evidenceCoverage,
    confidence,
    requiresHumanReview,
    demonstratedScore,
    coverageAdjustedScore,
    result: {
      score: coverageAdjustedScore,
      recommendation,
      summary,
      strengths: strengths.slice(0, 8),
      gaps: gaps.slice(0, 8),
      criteria: criteriaResult.slice(0, 8),
    },
  };
}

export function scoreCandidateWithRules(input: RulesInput): CandidateScore {
  return evaluateCandidateWithRules(input).result;
}

export function defaultRulesRubric(input: RulesInput): RulesRubric {
  return evaluateCandidateWithRules(input).rubric;
}
