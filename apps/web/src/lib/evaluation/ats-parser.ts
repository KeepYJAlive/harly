/**
 * Deterministic Resume Fact Parser for Harly ATS.
 *
 * Extracts structured facts from candidate resumes (sections, work history,
 * non-overlapping date math, education credentials, skills, and certifications)
 * along with provenance tracking for every extracted fact.
 */

export interface TextProvenance {
  sourceType: "resume" | "application_qa" | "candidate_profile";
  section?: "experience" | "education" | "skills" | "summary" | "certifications" | "languages" | "header" | "other";
  rawText: string;
  charStart?: number;
  charEnd?: number;
  lineIndex?: number;
}

export interface ParsedWorkPosition {
  id: string;
  title: string;
  company: string;
  location?: string;
  startYear?: number;
  startMonth?: number;
  endYear?: number;
  endMonth?: number;
  isCurrent: boolean;
  durationMonths: number | null;
  achievements: Array<{
    text: string;
    provenance: TextProvenance;
  }>;
  provenance: TextProvenance;
}

export interface ParsedEducationEntry {
  id: string;
  degreeName: string;
  normalizedLevel: "secondary" | "vocational" | "bachelor" | "master" | "doctorate" | "unknown";
  levelRank: number; // 1 to 5
  fieldOfStudy?: string;
  institution?: string;
  graduationYear?: number;
  provenance: TextProvenance;
}

export interface ParsedDeclaredSkill {
  name: string;
  category?: string;
  provenance: TextProvenance;
}

export interface CandidateFactDocument {
  contact: {
    fullName?: string;
    headline?: string;
    email?: string;
    location?: string;
    provenance?: TextProvenance;
  };
  workHistory: ParsedWorkPosition[];
  totalWorkDurationMonths: number;
  totalExperienceYears: number;
  workTimelineConfidence: "high" | "medium" | "low";
  education: ParsedEducationEntry[];
  highestEducation: ParsedEducationEntry | null;
  declaredSkills: ParsedDeclaredSkill[];
  certifications: Array<{ name: string; issuer?: string; year?: number; provenance: TextProvenance }>;
  languages: Array<{ language: string; proficiency?: string; provenance: TextProvenance }>;
  parsingDiagnostics: {
    unparsedSections: string[];
    lowConfidenceBlocks: string[];
  };
  rawText: string;
}

const SECTION_PATTERNS = {
  experience:
    /^(?:(?:work|professional|employment|career)\s+)?(?:experience|history|positions|employment)\b|^(?:experiencia(?:\s+laboral|\s+profesional)?|historial\s+laboral|trayectoria(?:\s+laboral)?)\b/i,
  education:
    /^(?:education|academic\s+(?:background|history)|qualifications|studies)\b|^(?:educaci[oó]n|formaci[oó]n(?:\s+acad[eé]mica)?|estudios(?:\s+universitarios)?)\b/i,
  skills:
    /^(?:(?:technical\s+|core\s+|key\s+)?skills|technologies|competencies|tools\s+&\s+technologies)\b|^(?:habilidades(?:\s+t[eé]cnicas)?|competencias|conocimientos(?:\s+t[eé]cnicos)?|herramientas|tecnolog[ií]as)\b/i,
  summary:
    /^(?:professional\s+summary|summary|profile|about\s+me|overview|executive\s+summary)\b|^(?:resumen(?:\s+profesional)?|perfil(?:\s+profesional)?|sobre\s+m[ií])\b/i,
  certifications:
    /^(?:certifications?|licenses?|certificates?|credentials?)\b|^(?:certificaciones|cursos|diplomados)\b/i,
  languages:
    /^(?:languages?|idiomas)\b/i,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};

const DEGREE_LEVEL_HIERARCHY: Array<{
  level: ParsedEducationEntry["normalizedLevel"];
  rank: number;
  pattern: RegExp;
}> = [
  {
    level: "doctorate",
    rank: 5,
    pattern: /\b(ph\.?\s?d|doctor(?:ate|al)?|doctorado|d\.phil)\b/i,
  },
  {
    level: "master",
    rank: 4,
    pattern: /\b(master'?s?|m\.?\s?sc|m\.?\s?a|m\.?\s?b\.?\s?a|mag[ií]ster|maestr[ií]a|postgrad(?:uate)?|posgrado)\b/i,
  },
  {
    level: "bachelor",
    rank: 3,
    pattern: /\b(bachelor'?s?|b\.?\s?sc|b\.?\s?a|b\.?\s?eng|b\.?\s?tech|undergraduate|licenciatura|licenciad[oa]|ingenier[ií]a|ingenier[oa]|t[ií]tulo\s+profesional|grado\s+universitario)\b/i,
  },
  {
    level: "vocational",
    rank: 2,
    pattern: /\b(associate'?s?\s+degree|t[eé]cnico(?:\s+superior|\s+profesional)?|technician|formaci[oó]n\s+profesional|fp|diploma)\b/i,
  },
  {
    level: "secondary",
    rank: 1,
    pattern: /\b(high\s+school|secondary\s+school|bachillerato|secundaria|educaci[oó]n\s+media)\b/i,
  },
];

export function cleanLine(line: string): string {
  return line
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ")
    .trim();
}

export function isBulletLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^[\s•\-\*–—·\u2022\u25E6\u2023\u2043\u2219]+/.test(line) ||
    /^\s*\d+[\.\)]\s+/.test(trimmed) ||
    (line.startsWith("  ") && trimmed.length > 20)
  );
}

export function cleanBullet(line: string): string {
  return cleanLine(line)
    .replace(/^[\s•\-\*–—·\u2022\u25E6\u2023\u2043\u2219]+\s*/, "")
    .replace(/^\d+[\.\)]\s*/, "")
    .trim();
}

export function parseDateInterval(
  text: string,
  referenceYear: number,
): {
  startYear?: number;
  startMonth?: number;
  endYear?: number;
  endMonth?: number;
  isCurrent: boolean;
  durationMonths: number;
} | null {
  const cleaned = cleanLine(text);
  const presentRegex = /\b(present|current|now|actualidad|presente|hoy)\b/i;

  const rangeMatch = cleaned.match(
    /(?:([a-z]{3,9})\s+)?\b(19\d{2}|20\d{2})\b\s*(?:-|–|—|to|al?|\/)\s*(?:(?:([a-z]{3,9})\s+)?\b(19\d{2}|20\d{2})\b|(present|current|now|actualidad|presente|hoy))/i,
  );

  if (rangeMatch) {
    const startMonth = rangeMatch[1] ? MONTHS[rangeMatch[1].toLowerCase().slice(0, 3)] : undefined;
    const startYear = Number(rangeMatch[2]);
    const isNow = Boolean(rangeMatch[5]) || presentRegex.test(rangeMatch[0]);
    const endMonth = isNow
      ? startMonth ? new Date().getMonth() + 1 : undefined
      : rangeMatch[3]
      ? MONTHS[rangeMatch[3].toLowerCase().slice(0, 3)]
      : undefined;
    const endYear = isNow ? referenceYear : Number(rangeMatch[4]);

    if (!Number.isNaN(startYear) && !Number.isNaN(endYear) && endYear >= startYear) {
      let months: number;
      if (startMonth && endMonth) {
        months = (endYear - startYear) * 12 + (endMonth - startMonth);
      } else {
        months = (endYear - startYear) * 12;
      }
      return {
        startYear,
        startMonth,
        endYear,
        endMonth,
        isCurrent: isNow,
        durationMonths: Math.max(1, months),
      };
    }
  }

  // Single year in parentheses or standalone
  const singleYear = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  if (singleYear) {
    const year = Number(singleYear[1]);
    return {
      startYear: year,
      endYear: year,
      isCurrent: false,
      durationMonths: 12,
    };
  }

  return null;
}

export function parseRoleHeader(
  line: string,
  referenceYear: number,
): {
  title: string;
  company: string;
  interval: ReturnType<typeof parseDateInterval>;
} | null {
  const cleaned = cleanLine(line);
  if (!cleaned || isBulletLine(line)) return null;

  const interval = parseDateInterval(cleaned, referenceYear);

  const textWithoutDate = cleaned
    .replace(/\s*\([^)]*(?:19\d{2}|20\d{2}|present|actualidad)[^)]*\)/gi, "")
    .replace(/\s*\|?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|[A-Z]{3,9})?\s*\b(19\d{2}|20\d{2})\b\s*(?:-|–|—|to|al?)\s*(?:(?:[A-Z]{3,9}\s*)?\b(19\d{2}|20\d{2})\b|present|actualidad|current).*/gi, "")
    .trim();

  const separatorMatch = textWithoutDate.match(/\s*(?:—|–|-|\||\bat\b|@|,)\s*/i);
  if (separatorMatch && separatorMatch.index !== undefined) {
    const part1 = textWithoutDate.slice(0, separatorMatch.index).trim();
    const part2 = textWithoutDate.slice(separatorMatch.index + separatorMatch[0].length).trim();
    if (part1.length >= 2 && part2.length >= 2) {
      return { title: part1, company: part2, interval };
    }
  }

  if (interval && textWithoutDate.length >= 3) {
    return { title: textWithoutDate, company: "Experience", interval };
  }

  return null;
}

function detectSection(line: string): keyof typeof SECTION_PATTERNS | null {
  const cleaned = cleanLine(line).replace(/^#+\s*/, "").replace(/[:\-_]+$/, "").trim();
  if (!cleaned || cleaned.length > 45) return null;
  for (const [key, regex] of Object.entries(SECTION_PATTERNS) as Array<[keyof typeof SECTION_PATTERNS, RegExp]>) {
    if (regex.test(cleaned)) return key;
  }
  return null;
}

/**
 * Parses raw resume plain text into structured candidate facts.
 */
export function parseResumeFacts(
  text: string,
  referenceYear: number = new Date().getFullYear(),
): CandidateFactDocument {
  const rawLines = text.split(/\r?\n/);
  const cleanedLines = rawLines.map(cleanLine);

  let currentSection: keyof typeof SECTION_PATTERNS | "header" = "header";

  let headerName: string | undefined;
  let headline: string | undefined;
  const contactParts: string[] = [];

  const workHistory: ParsedWorkPosition[] = [];
  let currentWork: ParsedWorkPosition | null = null;

  const education: ParsedEducationEntry[] = [];
  const declaredSkills: ParsedDeclaredSkill[] = [];
  const certifications: CandidateFactDocument["certifications"] = [];
  const languages: CandidateFactDocument["languages"] = [];

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i]!;
    if (!line) continue;

    const detected = detectSection(line);
    if (detected) {
      if (currentWork) {
        workHistory.push(currentWork);
        currentWork = null;
      }
      currentSection = detected;
      continue;
    }

    const provenance: TextProvenance = {
      sourceType: "resume",
      section: currentSection === "header" ? "header" : currentSection,
      rawText: line,
      lineIndex: i,
    };

    if (currentSection === "header") {
      if (!headerName && /^[a-zA-ZÀ-ÿ\s.'-]{3,50}$/.test(line)) {
        headerName = line;
      } else if (!headline && !/@|\.com|\d{4}/.test(line)) {
        headline = line;
      } else if (/@|\.com|\+|http|\/|phone|tel/i.test(line)) {
        contactParts.push(line);
      }
      continue;
    }

    if (currentSection === "experience") {
      const isBullet = isBulletLine(rawLines[i] ?? line);
      const parsedHeader = !isBullet ? parseRoleHeader(line, referenceYear) : null;

      if (parsedHeader) {
        if (currentWork) workHistory.push(currentWork);
        currentWork = {
          id: `role:${workHistory.length + 1}`,
          title: parsedHeader.title,
          company: parsedHeader.company,
          startYear: parsedHeader.interval?.startYear,
          startMonth: parsedHeader.interval?.startMonth,
          endYear: parsedHeader.interval?.endYear,
          endMonth: parsedHeader.interval?.endMonth,
          isCurrent: parsedHeader.interval?.isCurrent ?? false,
          durationMonths: parsedHeader.interval?.durationMonths ?? null,
          achievements: [],
          provenance,
        };
      } else if (currentWork) {
        const bulletText = cleanBullet(line);
        if (bulletText.length > 5) {
          currentWork.achievements.push({
            text: bulletText,
            provenance,
          });
        }
      }
      continue;
    }

    if (currentSection === "education") {
      const cleanedEntry = cleanBullet(line);
      if (cleanedEntry.length > 5) {
        let level: ParsedEducationEntry["normalizedLevel"] = "bachelor";
        let levelRank = 3;

        for (const def of DEGREE_LEVEL_HIERARCHY) {
          if (def.pattern.test(cleanedEntry)) {
            level = def.level;
            levelRank = def.rank;
            break;
          }
        }

        const yearMatch = cleanedEntry.match(/\b(19\d{2}|20\d{2})\b/g);
        const gradYear = yearMatch ? Number(yearMatch[yearMatch.length - 1]) : undefined;

        const parts = cleanedEntry
          .replace(/\s*\([^)]*(?:19\d{2}|20\d{2})[^)]*\)/g, "")
          .split(/\s*(?:—|–|-|,)\s*/);

        const degreeName = parts[0]?.trim() || cleanedEntry;
        const institution = parts.slice(1).join(" — ").trim() || undefined;

        education.push({
          id: `edu:${education.length + 1}`,
          degreeName,
          normalizedLevel: level,
          levelRank,
          institution,
          graduationYear: gradYear,
          provenance,
        });
      }
      continue;
    }

    if (currentSection === "skills") {
      const bulletText = cleanBullet(line);
      if (bulletText.length > 1) {
        declaredSkills.push({
          name: bulletText,
          provenance,
        });
      }
      continue;
    }

    if (currentSection === "certifications") {
      const bulletText = cleanBullet(line);
      if (bulletText.length > 2) {
        certifications.push({
          name: bulletText,
          provenance,
        });
      }
      continue;
    }

    if (currentSection === "languages") {
      const bulletText = cleanBullet(line);
      if (bulletText.length > 2) {
        languages.push({
          language: bulletText,
          provenance,
        });
      }
      continue;
    }
  }

  if (currentWork) workHistory.push(currentWork);

  // Union of non-overlapping intervals in months
  let totalWorkDurationMonths = 0;
  let workTimelineConfidence: CandidateFactDocument["workTimelineConfidence"] = "high";

  if (workHistory.length > 0) {
    const validIntervals = workHistory
      .filter((r) => r.startYear && r.endYear)
      .map((r) => ({
        start: r.startYear! * 12 + (r.startMonth ?? 0),
        end: r.endYear! * 12 + (r.endMonth ?? 0),
      }))
      .sort((a, b) => a.start - b.start);

    if (validIntervals.length > 0) {
      let mergedSpan = 0;
      let curStart = validIntervals[0]!.start;
      let curEnd = validIntervals[0]!.end;

      for (let j = 1; j < validIntervals.length; j++) {
        const next = validIntervals[j]!;
        if (next.start <= curEnd) {
          curEnd = Math.max(curEnd, next.end);
        } else {
          mergedSpan += curEnd - curStart;
          curStart = next.start;
          curEnd = next.end;
        }
      }
      mergedSpan += curEnd - curStart;
      totalWorkDurationMonths = mergedSpan;
    } else {
      workTimelineConfidence = "low";
      totalWorkDurationMonths = workHistory.reduce(
        (sum, r) => sum + (r.durationMonths ?? 18),
        0,
      );
    }
  }

  // Fallback explicit tenure text if 0
  if (totalWorkDurationMonths === 0) {
    const explicitMatch = text.match(
      /(\d{1,2})\+?\s*(?:years|yrs|year|años|año)\s*(?:of\s+)?(?:experience|experiencia)\b/i,
    );
    if (explicitMatch) {
      totalWorkDurationMonths = Number(explicitMatch[1]) * 12;
      workTimelineConfidence = "medium";
    }
  }

  const highestEducation = education.length > 0
    ? [...education].sort((a, b) => b.levelRank - a.levelRank)[0] ?? null
    : null;

  return {
    contact: {
      fullName: headerName,
      headline,
      email: contactParts.find((p) => p.includes("@")),
      location: contactParts.find((p) => p.includes(",") && !p.includes("@")),
    },
    workHistory,
    totalWorkDurationMonths,
    totalExperienceYears: Math.round((totalWorkDurationMonths / 12) * 10) / 10,
    workTimelineConfidence,
    education,
    highestEducation,
    declaredSkills,
    certifications,
    languages,
    parsingDiagnostics: {
      unparsedSections: [],
      lowConfidenceBlocks: [],
    },
    rawText: text,
  };
}
