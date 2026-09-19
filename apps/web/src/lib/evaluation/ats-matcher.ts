import type {
  CandidateFactDocument,
  TextProvenance,
} from "./ats-parser";
import type { StructuredCriterion } from "./criteria-builder";
import type {
  CriterionMatchEvidence,
  CriterionStatus,
  StructuredCriterionResult,
} from "./types";

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check if text includes a skill/keyword token honoring word boundaries and tech symbols (+, #) */
function textMatchesToken(text: string, token: string): boolean {
  const cleanToken = token.trim();
  if (!cleanToken) return false;
  // Match with word boundaries, taking care of trailing punctuation
  const pattern = new RegExp(
    `(?<![a-z0-9+#])${escapeRegExp(cleanToken)}(?![a-z0-9+#])`,
    "i",
  );
  return pattern.test(text);
}

/**
 * Matches structured criteria against candidate facts deterministically.
 * Returns criterion results with explicit status, evidence strength, full snippet, and provenance.
 */
export function matchCriteriaAgainstFacts(
  criteria: StructuredCriterion[],
  facts: CandidateFactDocument,
  additionalContext?: {
    answers?: Array<{ question: string; answer: string }>;
    profileSkills?: string[];
  },
): StructuredCriterionResult[] {
  return criteria.map((criterion) => {
    // 1. EXPERIENCE DURATION CRITERION
    if (criterion.type === "experience_duration" || criterion.type === "experience_years") {
      const requiredMonths = criterion.minimumMonths ?? 0;
      const actualMonths = facts.totalWorkDurationMonths;
      const actualYears = facts.totalExperienceYears;
      const requiredYears = Math.round((requiredMonths / 12) * 10) / 10;

      if (actualMonths === 0 && facts.workHistory.length === 0) {
        return {
          criterionId: criterion.id,
          label: criterion.label,
          type: criterion.type,
          status: "unknown",
          rawScore: null,
          weight: criterion.weight,
          importance: criterion.importance,
          isKnockout: criterion.isKnockout,
          knockoutFailed: false,
          evidence: null,
          missingReason: "No work experience timeline could be determined from the resume.",
        };
      }

      const roleSummary = facts.workHistory
        .map((r) => `${r.company}${r.durationMonths ? ` (${Math.round(r.durationMonths / 12)} yrs)` : ""}`)
        .slice(0, 4)
        .join(", ");

      if (actualMonths >= requiredMonths) {
        const snippet = `${actualYears} years of experience verified across ${facts.workHistory.length} positions (meets ${requiredYears}+ yrs requirement): ${roleSummary}.`;
        const firstRoleProvenance = facts.workHistory[0]?.provenance ?? {
          sourceType: "resume",
          section: "experience",
          rawText: snippet,
        };

        return {
          criterionId: criterion.id,
          label: criterion.label,
          type: criterion.type,
          status: "met",
          rawScore: 100,
          weight: criterion.weight,
          importance: criterion.importance,
          isKnockout: criterion.isKnockout,
          knockoutFailed: false,
          evidence: {
            verbatimSnippet: snippet,
            strength: "demonstrated",
            method: "structural_date_calc",
            confidence: facts.workTimelineConfidence === "high" ? 95 : 80,
            provenance: firstRoleProvenance,
          },
          missingReason: null,
        };
      }

      // Less experience than required
      const ratio = requiredMonths > 0 ? actualMonths / requiredMonths : 0;
      const rawScore = Math.max(10, Math.round(ratio * 100));
      const snippet = `${actualYears} years of experience found across ${facts.workHistory.length} roles (${requiredYears}+ yrs required): ${roleSummary}.`;

      return {
        criterionId: criterion.id,
        label: criterion.label,
        type: criterion.type,
        status: ratio >= 0.75 ? "partially_met" : "not_met",
        rawScore,
        weight: criterion.weight,
        importance: criterion.importance,
        isKnockout: criterion.isKnockout,
        knockoutFailed: criterion.isKnockout,
        evidence: {
          verbatimSnippet: snippet,
          strength: "demonstrated",
          method: "structural_date_calc",
          confidence: 85,
          provenance: facts.workHistory[0]?.provenance ?? {
            sourceType: "resume",
            section: "experience",
            rawText: snippet,
          },
        },
        missingReason: `${requiredYears}+ years required, but only ${actualYears} years verified.`,
      };
    }

    // 2. EDUCATION CRITERION
    if (criterion.type === "education") {
      const highest = facts.highestEducation;
      const minRank = criterion.minimumEducationLevelRank ?? 3;

      if (!highest) {
        return {
          criterionId: criterion.id,
          label: criterion.label,
          type: criterion.type,
          status: "unknown",
          rawScore: null,
          weight: criterion.weight,
          importance: criterion.importance,
          isKnockout: criterion.isKnockout,
          knockoutFailed: false,
          evidence: null,
          missingReason: "No formal education history detected in the resume.",
        };
      }

      const eduSnippet = highest.institution
        ? `${highest.degreeName} — ${highest.institution}`
        : highest.degreeName;

      if (highest.levelRank >= minRank) {
        return {
          criterionId: criterion.id,
          label: criterion.label,
          type: criterion.type,
          status: "met",
          rawScore: 100,
          weight: criterion.weight,
          importance: criterion.importance,
          isKnockout: criterion.isKnockout,
          knockoutFailed: false,
          evidence: {
            verbatimSnippet: `Education detected: ${eduSnippet} (meets requirement).`,
            strength: "credentialed",
            method: "deterministic_exact",
            confidence: 95,
            provenance: highest.provenance,
          },
          missingReason: null,
        };
      }

      return {
        criterionId: criterion.id,
        label: criterion.label,
        type: criterion.type,
        status: "not_met",
        rawScore: 50,
        weight: criterion.weight,
        importance: criterion.importance,
        isKnockout: criterion.isKnockout,
        knockoutFailed: criterion.isKnockout,
        evidence: {
          verbatimSnippet: `Education detected: ${eduSnippet} (below required level).`,
          strength: "credentialed",
          method: "deterministic_exact",
          confidence: 90,
          provenance: highest.provenance,
        },
        missingReason: "Highest detected education does not meet required degree rank.",
      };
    }

    // 3. SKILL / EXTENSIBLE CRITERIA MATCHING
    const searchTokens = [
      ...criterion.targetTokens,
      ...criterion.recruiterAliases,
    ];

    // Priority A: Demonstrated in work experience achievements (Gold standard)
    for (const role of facts.workHistory) {
      for (const ach of role.achievements) {
        for (const token of searchTokens) {
          if (textMatchesToken(ach.text, token)) {
            return {
              criterionId: criterion.id,
              label: criterion.label,
              type: criterion.type,
              status: "met",
              rawScore: 100, // Demonstrated in work
              weight: criterion.weight,
              importance: criterion.importance,
              isKnockout: criterion.isKnockout,
              knockoutFailed: false,
              evidence: {
                verbatimSnippet: `${role.company} (${role.title}): "${ach.text}"`,
                strength: "demonstrated",
                method: "deterministic_exact",
                confidence: 95,
                provenance: ach.provenance,
              },
              missingReason: null,
            };
          }
        }
      }
    }

    // Priority B: Declared in Skills section
    for (const skill of facts.declaredSkills) {
      for (const token of searchTokens) {
        if (textMatchesToken(skill.name, token)) {
          return {
            criterionId: criterion.id,
            label: criterion.label,
            type: criterion.type,
            status: "met",
            rawScore: 80, // Declared presence, meets requirement honestly
            weight: criterion.weight,
            importance: criterion.importance,
            isKnockout: criterion.isKnockout,
            knockoutFailed: false,
            evidence: {
              verbatimSnippet: `Declared in Skills section: "${skill.name}"`,
              strength: "declared",
              method: "deterministic_exact",
              confidence: 85,
              provenance: skill.provenance,
            },
            missingReason: null,
          };
        }
      }
    }

    // Priority C: Job Title / Headline match
    for (const role of facts.workHistory) {
      for (const token of searchTokens) {
        if (textMatchesToken(role.title, token)) {
          return {
            criterionId: criterion.id,
            label: criterion.label,
            type: criterion.type,
            status: "met",
            rawScore: 85,
            weight: criterion.weight,
            importance: criterion.importance,
            isKnockout: criterion.isKnockout,
            knockoutFailed: false,
            evidence: {
              verbatimSnippet: `Held role: ${role.title} at ${role.company}`,
              strength: "demonstrated",
              method: "deterministic_exact",
              confidence: 90,
              provenance: role.provenance,
            },
            missingReason: null,
          };
        }
      }
    }

    // Priority D: Application Answers or Profile Skills
    if (additionalContext?.answers) {
      for (const qa of additionalContext.answers) {
        for (const token of searchTokens) {
          if (textMatchesToken(qa.answer, token)) {
            return {
              criterionId: criterion.id,
              label: criterion.label,
              type: criterion.type,
              status: "met",
              rawScore: 75,
              weight: criterion.weight,
              importance: criterion.importance,
              isKnockout: criterion.isKnockout,
              knockoutFailed: false,
              evidence: {
                verbatimSnippet: `Application response to "${qa.question}": "${qa.answer}"`,
                strength: "declared",
                method: "deterministic_exact",
                confidence: 80,
                provenance: {
                  sourceType: "application_qa",
                  rawText: qa.answer,
                },
              },
              missingReason: null,
            };
          }
        }
      }
    }

    // Not found in any section: Absence of evidence != failure
    return {
      criterionId: criterion.id,
      label: criterion.label,
      type: criterion.type,
      status: "not_demonstrated",
      rawScore: null, // Neutral: excluded from score denominator
      weight: criterion.weight,
      importance: criterion.importance,
      isKnockout: criterion.isKnockout,
      knockoutFailed: criterion.isKnockout, // If explicit knockout was unmentioned, it fails gate
      evidence: null,
      missingReason: `No explicit evidence found for ${criterion.label} in work experience or skills.`,
    };
  });
}
