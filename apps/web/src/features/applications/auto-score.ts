import "server-only";

import { and, eq } from "drizzle-orm";

import {
  activityEvents,
  applicationAnswers,
  applicationQuestions,
  applications,
  candidates,
  db,
  jobs,
  workspaceSettings,
} from "@harly/db";

import { loadResumeDocument } from "@/lib/resume/load-resume-text";
import { getWorkspaceAiConfig } from "@/lib/ai/config";
import { logAiCandidateDecision } from "@/lib/ai/governance";
import { scoreCandidateWithAI } from "@/lib/ai/surfaces/score-candidate";
import {
  evaluateCandidateWithRulesAsync,
  RULES_EVALUATION_VERSION,
} from "@/lib/evaluation/rules";
import type { EvaluationMode } from "@/lib/evaluation/mode";
import {
  enqueueCandidateEvaluationJob,
  findReusableCandidateFacts,
  getPublishedRulesRubric,
  markEvaluationJobCompleted,
  markEvaluationJobFailed,
  markEvaluationJobRunning,
  persistCandidateEvaluation,
} from "@/features/evaluations/service";

/**
 * Fire-and-forget: score a new application if auto-score is enabled for the
 * workspace. Never throws , failures are logged only.
 */
export async function scheduleAutoScore(
  applicationId: string,
  workspaceId: string,
  options?: { jobId?: string; workerId?: string },
): Promise<void> {
  let evaluationJobId: string | null = options?.jobId ?? null;
  try {
    // Check auto-score setting first , cheap query, skip early if disabled.
    const [settings] = await db
      .select({ aiAutoScore: workspaceSettings.aiAutoScore })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.organizationId, workspaceId))
      .limit(1);

    if (!settings?.aiAutoScore) {
      if (evaluationJobId) await markEvaluationJobCompleted(evaluationJobId);
      return;
    }

    const aiConfig = await getWorkspaceAiConfig(workspaceId);

    const [row] = await db
      .select({
        applicationId: applications.id,
        candidateId: candidates.id,
        jobId: jobs.id,
        firstName: candidates.firstName,
        lastName: candidates.lastName,
        headline: candidates.headline,
        location: candidates.location,
        skills: candidates.skills,
        experienceYears: candidates.experienceYears,
        jobTitle: jobs.title,
        jobDescription: jobs.description,
        jobRequirements: jobs.requirements,
        jobSector: jobs.sector,
        jobExperienceLevel: jobs.experienceLevel,
        jobEducation: jobs.education,
        jobKeywords: jobs.keywords,
        evaluationMode: jobs.evaluationMode,
        appliedAt: applications.appliedAt,
        applicationCreatedAt: applications.createdAt,
      })
      .from(applications)
      .innerJoin(
        candidates,
        and(
          eq(candidates.workspaceId, workspaceId),
          eq(candidates.id, applications.candidateId),
        ),
      )
      .innerJoin(
        jobs,
        and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, applications.jobId)),
      )
      .where(
        and(
          eq(applications.workspaceId, workspaceId),
          eq(applications.id, applicationId),
        ),
      )
      .limit(1);

    if (!row) return;

    const queueJob = evaluationJobId
      ? { id: evaluationJobId }
      : await enqueueCandidateEvaluationJob({
          workspaceId,
          applicationId: row.applicationId,
          candidateId: row.candidateId,
          jobId: row.jobId,
        });
    evaluationJobId = queueJob.id;
    if (!options?.jobId) {
      await markEvaluationJobRunning(queueJob.id, `inline:${workspaceId}`);
    }

    // Load resume text + layout document (Phase 4 §6). Unreadable sources
    // resolve to text: null -> profile-only evaluation with human review.
    const resume = await loadResumeDocument({ workspaceId, candidateId: row.candidateId });
    const resumeText = resume.text;
    const referenceDateValue = row.appliedAt ?? row.applicationCreatedAt;
    const parsedReferenceDate = referenceDateValue ? new Date(referenceDateValue) : null;
    const pinnedReferenceDate = parsedReferenceDate && !Number.isNaN(parsedReferenceDate.getTime())
      ? parsedReferenceDate.toISOString()
      : "1970-01-01T00:00:00.000Z";

    // Load question answers.
    const answerRows = await db
      .select({
        question: applicationQuestions.label,
        answer: applicationAnswers.answer,
      })
      .from(applicationAnswers)
      .innerJoin(
        applicationQuestions,
        and(
          eq(applicationQuestions.workspaceId, workspaceId),
          eq(applicationQuestions.id, applicationAnswers.questionId),
        ),
      )
      .where(
        and(
          eq(applicationAnswers.workspaceId, workspaceId),
          eq(applicationAnswers.applicationId, row.applicationId),
        ),
      )
      .orderBy(applicationQuestions.order);

    const evaluationMode: EvaluationMode =
      row.evaluationMode === "relaxed" || row.evaluationMode === "strict"
        ? row.evaluationMode
        : "balanced";
    const scoreInput = {
      job: {
        title: row.jobTitle,
        description: row.jobDescription,
        requirements: row.jobRequirements,
        sector: row.jobSector,
        experienceLevel: row.jobExperienceLevel,
        education: row.jobEducation,
        keywords: Array.isArray(row.jobKeywords) ? (row.jobKeywords as string[]) : [],
        evaluationMode,
      },
      candidate: {
        fullName: `${row.firstName} ${row.lastName}`,
        headline: row.headline,
        location: row.location,
        resumeText,
        answers: answerRows,
        skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
        experienceYears: row.experienceYears,
      },
      // Pin current-role math to an immutable application event. A missing
      // appliedAt must not silently fall through to wall-clock time.
      referenceDate: pinnedReferenceDate,
      sourceDocument: resume.document ?? undefined,
    };
    // Rules-first + AI overlay with rules fallback (see ai-actions.ts).
    // Never fail the entire auto-score solely because the AI provider failed.
    const publishedRubric = await getPublishedRulesRubric(workspaceId, row.jobId);
    const reusableFacts = await findReusableCandidateFacts({
      workspaceId,
      applicationId,
      resumeText,
    });
    const rulesEvaluation = await evaluateCandidateWithRulesAsync({
      ...scoreInput,
      rubric: publishedRubric ?? undefined,
      candidateFacts: reusableFacts ?? undefined,
    });

    let source: "ai" | "rules" = "rules";
    let result = rulesEvaluation.result;
    if (aiConfig) {
      try {
        result = await scoreCandidateWithAI(aiConfig, scoreInput);
        source = "ai";
      } catch (aiError) {
        console.warn(
          "Auto-score AI unavailable; falling back to deterministic rules",
          aiError,
        );
        source = "rules";
        result = rulesEvaluation.result;
      }
    }

    const persisted = await persistCandidateEvaluation({
      workspaceId,
      candidateId: row.candidateId,
      applicationId: row.applicationId,
      jobId: row.jobId,
      source,
      provider: source === "ai" && aiConfig ? aiConfig.provider : "harly",
      modelId: source === "ai" && aiConfig ? aiConfig.modelId : RULES_EVALUATION_VERSION,
      engine: source === "ai" ? "provider-ai" : "harly-rules",
      engineVersion: source === "ai" && aiConfig ? aiConfig.modelId : RULES_EVALUATION_VERSION,
      rubricVersion: rulesEvaluation.rubric.version,
      rubricSnapshot: rulesEvaluation.rubric,
      result,
      criterionResults: rulesEvaluation.criterionResults,
      candidateFactsSnapshot: rulesEvaluation.candidateFacts,
      skillProfilesSnapshot: rulesEvaluation.skillProfiles,
      evaluationMetadataSnapshot: rulesEvaluation.metadata,
      criterionDetailsSnapshot: rulesEvaluation.criterionAssessments,
      impactHighlightsSnapshot: rulesEvaluation.impactHighlights,
      evidenceCoverage: rulesEvaluation.evidenceCoverage,
      confidence: rulesEvaluation.confidence,
      requiresHumanReview: rulesEvaluation.requiresHumanReview || source === "ai",
      usedResume: resumeText !== null,
      generatedById: null,
      inputFingerprintSource: scoreInput,
    });

    await db.insert(activityEvents).values({
      workspaceId,
      actorId: null,
      entityType: "application",
      entityId: row.applicationId,
      type: source === "ai" ? "evaluation.ai_generated" : "evaluation.rules_generated",
      metadata: {
        score: result.score,
        recommendation: result.recommendation,
        jobTitle: row.jobTitle,
        source,
        auto: true,
        inputHash: persisted.inputHash,
      },
    });

    if (source === "ai" && aiConfig) {
      await logAiCandidateDecision({
        workspaceId,
        candidateId: row.candidateId,
        applicationId: row.applicationId,
        jobId: row.jobId,
        provider: aiConfig.provider,
        modelId: aiConfig.modelId,
        inputFingerprintSource: scoreInput,
        outputFingerprintSource: result,
        inputSummary: {
          usedResume: resumeText !== null,
          answerCount: answerRows.length,
          skillsCount: Array.isArray(row.skills) ? row.skills.length : 0,
        },
        outputSummary: {
          score: result.score,
          recommendation: result.recommendation,
          criteriaCount: result.criteria.length,
        },
      });
    }
    await markEvaluationJobCompleted(queueJob.id);
  } catch (error) {
    if (evaluationJobId) {
      await markEvaluationJobFailed(
        evaluationJobId,
        error instanceof Error ? error.message : "Automatic evaluation failed.",
      );
    }
    console.error("Auto-score failed for application", applicationId, error);
    if (options?.jobId) throw error;
  }
}
