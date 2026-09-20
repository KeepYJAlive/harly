import {
  type CandidateFactDocument,
  type TextProvenance,
  unionWorkIntervals,
} from "./ats-parser";
import type { StructuredCriterion } from "./criteria-builder";
import type {
  CriterionMatchEvidence,
  CriterionStatus,
  MatchMethod,
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
    ].sort((a, b) => b.length - a.length);

    // Priority A: Search work experience achievements and titles
    const matchingRoles: Array<{
      role: (typeof facts.workHistory)[number];
      snippet: string;
      provenance: TextProvenance;
      method: MatchMethod;
    }> = [];

    for (const role of facts.workHistory) {
      let matchedInRole = false;
      for (const ach of role.achievements) {
        for (const token of searchTokens) {
          if (textMatchesToken(ach.text, token)) {
            const method: MatchMethod =
              token.toLowerCase() === criterion.label.toLowerCase()
                ? "deterministic_exact"
                : criterion.recruiterAliases.some((a) => a.toLowerCase() === token.toLowerCase())
                ? "recruiter_alias"
                : "built_in_alias";
            matchingRoles.push({
              role,
              snippet: ach.text,
              provenance: ach.provenance,
              method,
            });
            matchedInRole = true;
            break;
          }
        }
        if (matchedInRole) break;
      }

      if (!matchedInRole) {
        for (const token of searchTokens) {
          if (textMatchesToken(role.title, token)) {
            matchingRoles.push({
              role,
              snippet: `Held role: ${role.title}`,
              provenance: role.provenance,
              method:
                token.toLowerCase() === criterion.label.toLowerCase()
                  ? "deterministic_exact"
                  : "built_in_alias",
            });
            matchedInRole = true;
            break;
          }
        }
      }
    }

    // A1. Skill with specific duration requirement (e.g. "3+ years Python")
    if (criterion.minimumMonths && criterion.minimumMonths > 0) {
      const requiredMonths = criterion.minimumMonths;
      const requiredYears = Math.round((requiredMonths / 12) * 10) / 10;

      if (matchingRoles.length > 0) {
        const relevantDurationMonths = unionWorkIntervals(matchingRoles.map((m) => m.role));
        const actualYears = Math.round((relevantDurationMonths / 12) * 10) / 10;
        const roleSummary = matchingRoles.map((m) => m.role.company).slice(0, 3).join(", ");
        const first = matchingRoles[0]!;

        if (relevantDurationMonths >= requiredMonths) {
          const snippet = `${actualYears} years of ${criterion.label} experience verified across ${matchingRoles.length} role(s) (${roleSummary}) (meets ${requiredYears}+ yrs requirement).`;
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
              method: first.method,
              confidence: 95,
              provenance: first.provenance,
              canonicalSkillName: criterion.canonicalName,
              relevantDurationMonths,
            },
            missingReason: null,
          };
        }

        // Less duration than required for this specific skill
        const ratio = requiredMonths > 0 ? relevantDurationMonths / requiredMonths : 0;
        const status: CriterionStatus = ratio >= 0.75 ? "partially_met" : (criterion.isKnockout ? "not_met" : "partially_met");
        const rawScore = Math.max(25, Math.round(ratio * 90));
        const snippet = `${actualYears} years of ${criterion.label} verified across ${matchingRoles.length} role(s) (${roleSummary}) (${requiredYears}+ yrs required).`;

        return {
          criterionId: criterion.id,
          label: criterion.label,
          type: criterion.type,
          status,
          rawScore,
          weight: criterion.weight,
          importance: criterion.importance,
          isKnockout: criterion.isKnockout,
          knockoutFailed: criterion.isKnockout && status === "not_met",
          evidence: {
            verbatimSnippet: snippet,
            strength: "demonstrated",
            method: first.method,
            confidence: 85,
            provenance: first.provenance,
            canonicalSkillName: criterion.canonicalName,
            relevantDurationMonths,
          },
          missingReason: `${requiredYears}+ years of ${criterion.label} required, but only ${actualYears} years verified in relevant roles.`,
        };
      }

      // Check if skill was declared in skills section without work tenure
      for (const skill of facts.declaredSkills) {
        for (const token of searchTokens) {
          if (textMatchesToken(skill.name, token)) {
            return {
              criterionId: criterion.id,
              label: criterion.label,
              type: criterion.type,
              status: "partially_met",
              rawScore: 40,
              weight: criterion.weight,
              importance: criterion.importance,
              isKnockout: criterion.isKnockout,
              knockoutFailed: criterion.isKnockout,
              evidence: {
                verbatimSnippet: `Declared in Skills section: "${skill.name}" (requires ${requiredYears}+ yrs of verified experience).`,
                strength: "declared",
                method:
                  token.toLowerCase() === criterion.label.toLowerCase()
                    ? "deterministic_exact"
                    : "built_in_alias",
                confidence: 75,
                provenance: skill.provenance,
                canonicalSkillName: criterion.canonicalName,
                relevantDurationMonths: 0,
              },
              missingReason: `${requiredYears}+ years of ${criterion.label} required, but only declared as a skill without verified work tenure.`,
            };
          }
        }
      }
    }

    // A2. Standard skill matching (no minimum duration constraint)
    if (matchingRoles.length > 0) {
      const first = matchingRoles[0]!;
      const relevantDurationMonths = unionWorkIntervals(matchingRoles.map((m) => m.role));
      const snippet = `${first.role.company} (${first.role.title}): "${first.snippet}"`;

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
          verbatimSnippet: snippet,
          strength: "demonstrated",
          method: first.method,
          confidence: 95,
          provenance: first.provenance,
          canonicalSkillName: criterion.canonicalName,
          relevantDurationMonths,
        },
        missingReason: null,
      };
    }

    // Priority B: Declared in Skills section
    for (const skill of facts.declaredSkills) {
      for (const token of searchTokens) {
        if (textMatchesToken(skill.name, token)) {
          const method: MatchMethod =
            token.toLowerCase() === criterion.label.toLowerCase()
              ? "deterministic_exact"
              : criterion.recruiterAliases.some((a) => a.toLowerCase() === token.toLowerCase())
              ? "recruiter_alias"
              : "built_in_alias";

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
              method,
              confidence: 85,
              provenance: skill.provenance,
              canonicalSkillName: criterion.canonicalName,
            },
            missingReason: null,
          };
        }
      }
    }

    // Priority C: Application Answers or Profile Skills
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
                canonicalSkillName: criterion.canonicalName,
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
