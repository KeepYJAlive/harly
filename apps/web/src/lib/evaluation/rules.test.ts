import { describe, expect, it } from "vitest";

import {
  evaluateCandidateWithRules,
  RULES_EVALUATION_VERSION,
  SCORING_CONSTANTS,
} from "./rules";

describe("Harly ATS Deterministic Engine rules-v4", () => {
  const juniorPhpJob = {
    title: "Junior PHP Engineer",
    description: "Build web applications.",
    requirements: "PHP and Laravel experience.",
    experienceLevel: "junior",
    education: null,
    keywords: ["PHP", "Laravel", "Git"],
  };

  it("returns transparent criteria and the rules-v4 version", () => {
    const result = evaluateCandidateWithRules({
      job: juniorPhpJob,
      candidate: {
        resumeText: `John Doe
Full Stack Developer
john@example.com

EXPERIENCE
PHP Developer - Acme Web (2024 - Present)
• Built web services using PHP and Laravel.
• Used Git for version control.
`,
        answers: [],
      },
    });

    expect(RULES_EVALUATION_VERSION).toBe("rules-v4");
    expect(result.result.score).toBeGreaterThanOrEqual(80);
    expect(result.criterionResults.map((c) => c.label)).toContain("PHP");
    expect(
      result.criterionResults
        .filter((c) => c.status === "met")
        .every((c) => c.evidence !== null),
    ).toBe(true);
    const phpResult = result.criterionResults.find((c) => c.label === "PHP");
    expect(phpResult?.evidence).toContain('Acme Web (PHP Developer): "Built web services using PHP and Laravel."');
  });

  it("evaluates Isabella Rossi demo candidate with exact 8-year tenure, 100% coverage, and Strong Yes", () => {
    const marketingJob = {
      title: "Growth Marketing Manager",
      description: "Own the growth funnel from acquisition to activation.",
      requirements: "Experience across paid and organic channels.",
      experienceLevel: "Senior (5+ years)",
      education: "Bachelor's",
      keywords: ["SEO", "Paid acquisition", "Analytics", "Lifecycle", "Content"],
    };

    const isabellaResume = `Isabella Rossi
Lifecycle & content marketing
Milan, Italy · isabella.rossi@gmail.com

EXPERIENCE

Growth Marketing Manager — Nimbus Labs (2023–Present)
  •  Grew Nimbus Labs's self-serve pipeline 3.2x in 18 months through SEO, lifecycle email and referral loops.
  •  Cut blended CAC 28% by reallocating paid spend based on cohort LTV analysis.
  •  Launched a content engine (2 posts/week) that became the #1 acquisition channel.

Marketing Manager — Mosaic HQ (2020–2023)
  •  Owned activation experiments; 14 of 31 A/B tests shipped with significant lift.
  •  Built the marketing analytics stack from scratch (GA4, Amplitude, dbt).

Content Marketer — Atlas Forge (2018–2020)
  •  Managed social and community programs reaching 80k followers.

SKILLS
  •  Lifecycle marketing: email, in-product, push (Customer.io, Braze)
  •  Paid acquisition: Google Ads, LinkedIn, Meta — $1M+ annual budget
  •  SEO and content strategy; analytics with GA4, Amplitude
  •  Experiment design and statistics fundamentals

EDUCATION
B.A. Business & Marketing — State University of Technology (2014–2018)
`;

    const result = evaluateCandidateWithRules({
      job: marketingJob,
      candidate: {
        resumeText: isabellaResume,
        answers: [],
      },
    });

    // 8.0 years verified across 3 roles (3 yrs + 3 yrs + 2 yrs = 8 yrs exactly)
    const expResult = result.criterionResults.find((c) => c.label === "Experience");
    expect(expResult?.status).toBe("met");
    expect(expResult?.evidence).toContain("8 years of experience verified");

    // Education verified
    const eduResult = result.criterionResults.find((c) => c.label === "Education");
    expect(eduResult?.status).toBe("met");
    expect(eduResult?.evidence).toContain("B.A. Business & Marketing");

    // All skills verified with complete sentences
    const seoResult = result.criterionResults.find((c) => c.label === "SEO");
    expect(seoResult?.status).toBe("met");
    expect(seoResult?.evidence).toContain('Nimbus Labs (Growth Marketing Manager): "Grew Nimbus Labs\'s self-serve pipeline 3.2x in 18 months through SEO, lifecycle email and referral loops."');

    // Score & Tier invariants
    expect(result.demonstratedScore).toBe(100);
    expect(result.evidenceCoverage).toBe(100);
    expect(result.coverageAdjustedScore).toBe(100);
    expect(result.result.score).toBe(100);
    expect(result.result.recommendation).toBe("strong_yes");
    expect(result.requiresHumanReview).toBe(false);
    expect(result.result.gaps.length).toBe(0);
  });

  it("handles multi-skill vacancy with low evidence coverage without inflating the score", () => {
    const broadJob = {
      title: "Senior Full Stack Engineer",
      description: "Comprehensive multi-disciplinary stack.",
      requirements: "Must have broad experience across 10 areas.",
      experienceLevel: "Senior (5+ years)",
      education: null,
      keywords: [
        "React",
        "TypeScript",
        "Python",
        "PostgreSQL",
        "Kubernetes",
        "Docker",
        "AWS",
        "Terraform",
        "GraphQL",
        "Redis",
      ],
    };

    // Candidate only demonstrates React and TypeScript; 8 other skills unmentioned; tenure is ~2.8 yrs vs 5 required
    const lowCoverageResume = `Jane Doe
Frontend Specialist
jane@example.com

EXPERIENCE
Frontend Engineer - Tech Co (2024 - Present)
• Built user interfaces using React and TypeScript.
`;

    const result = evaluateCandidateWithRules({
      job: broadJob,
      candidate: {
        resumeText: lowCoverageResume,
        answers: [],
      },
    });

    // 11 criteria total (10 skills + Experience)
    // 3 scored: React (100 @ wt 25), TypeScript (100 @ wt 25), Experience (40 @ wt 25) -> demonstratedScore = (2500 + 2500 + 1000) / 75 = 80
    expect(result.demonstratedScore).toBe(80);
    // Coverage is low (~27%) because 8 skills are not_demonstrated
    expect(result.evidenceCoverage).toBeLessThan(35);
    // The coverageAdjustedScore shrinks toward the neutral baseline (40)
    expect(result.coverageAdjustedScore).toBeLessThan(60);
    expect(result.result.score).toBeLessThan(60);
    expect(result.result.recommendation).toBe("maybe");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("allows Strong Yes when preferred criteria are not met, provided required criteria and score thresholds hold", () => {
    const jobWithPreferred = {
      title: "Backend Engineer",
      description: "Build robust APIs.",
      requirements: "Go is required. Docker is required. Rust is preferred.",
      experienceLevel: "Mid",
      education: null,
      keywords: ["Go", "Docker", "Rust"],
    };

    const resumeWithOnlyRequired = `Bob Smith
Backend Developer
bob@example.com

EXPERIENCE
Backend Engineer — Cloud Corp (2022 - Present)
• Developed microservices using Go and deployed containers with Docker.
`;

    const result = evaluateCandidateWithRules({
      job: jobWithPreferred,
      candidate: {
        resumeText: resumeWithOnlyRequired,
        answers: [],
      },
    });

    // Go and Docker are met
    expect(result.criterionResults.find((c) => c.label === "Go")?.status).toBe("met");
    expect(result.criterionResults.find((c) => c.label === "Docker")?.status).toBe("met");
    // Rust is not_demonstrated (preferred)
    const rustResult = result.criterionResults.find((c) => c.label === "Rust");
    expect(rustResult?.status).toBe("unknown"); // legacy mapping of not_demonstrated
    expect(rustResult?.extendedStatus).toBe("not_demonstrated");
    expect(rustResult?.score).toBe(null);

    // Score on the 2 demonstrated skills (Go, Docker) + 1 required duration is 100
    expect(result.demonstratedScore).toBe(100);
    expect(result.evidenceCoverage).toBeGreaterThanOrEqual(70);
    expect(result.coverageAdjustedScore).toBeGreaterThanOrEqual(SCORING_CONSTANTS.YES_MIN_SCORE);
    expect(result.result.recommendation).toBe("yes");
  });

  it("merges overlapping date intervals cleanly into a non-overlapping contiguous duration", () => {
    const job = {
      title: "Software Engineer",
      description: "Experienced dev.",
      requirements: null,
      experienceLevel: "Senior (5+ years)",
      education: null,
      keywords: ["Python"],
    };

    // Candidate worked two concurrent jobs over the same 2-year window (2022-2024)
    const overlappingResume = `Alice Johnson
Software Engineer
alice@example.com

EXPERIENCE
Software Engineer — Company A (2022 - 2024)
• Built Python services.

Contract Developer — Company B (2022 - 2024)
• Maintained Python pipelines.
`;

    const result = evaluateCandidateWithRules({
      job,
      candidate: {
        resumeText: overlappingResume,
        answers: [],
      },
    });

    const expResult = result.criterionResults.find((c) => c.label === "Experience");
    // Union should be ~2 years, NOT 4 years!
    expect(expResult?.evidence).toContain("2 years of experience found");
    expect(expResult?.status).toBe("not_met"); // 2 years < 5 years required
  });

  // ── Broader Regression Test Suite ───────────────────────────────────────────

  describe("Broader ATS Regression Scenarios", () => {
    it("distinguishes skill only declared in Skills section vs demonstrated in work", () => {
      const job = {
        title: "Frontend Engineer",
        description: "Web developer",
        requirements: null,
        experienceLevel: null,
        education: null,
        keywords: ["React", "GraphQL"],
      };

      const resume = `Developer
dev@example.com

EXPERIENCE
Web Dev - Agency (2023 - 2024)
• Built customer portals using React.

SKILLS
• GraphQL, REST, Tailwind
`;

      const res = evaluateCandidateWithRules({
        job,
        candidate: { resumeText: resume, answers: [] },
      });

      const react = res.criterionResults.find((c) => c.label === "React");
      const graphql = res.criterionResults.find((c) => c.label === "GraphQL");

      // React is demonstrated in work experience (score: 100, strength: demonstrated)
      expect(react?.status).toBe("met");
      expect(react?.score).toBe(100);
      expect(react?.evidenceStrength).toBe("demonstrated");
      expect(react?.evidence).toContain('Agency (Web Dev): "Built customer portals using React."');

      // GraphQL is declared in skills section (score: 80, strength: declared)
      expect(graphql?.status).toBe("met");
      expect(graphql?.score).toBe(80);
      expect(graphql?.evidenceStrength).toBe("declared");
      expect(graphql?.evidence).toContain('Declared in Skills section: "GraphQL, REST, Tailwind"');
    });

    it("evaluates technical symbols with word boundaries: C++, C#, and .NET correctly", () => {
      const job = {
        title: "Systems Engineer",
        description: "Core systems",
        requirements: null,
        experienceLevel: null,
        education: null,
        keywords: ["C++", "C#", ".NET"],
      };

      const resume = `Programmer
p@example.com

EXPERIENCE
Systems Developer - Tech Labs (2022 - Present)
• Programmed real-time engines in C++ and tools in C#.
• Shipped enterprise microservices using .NET runtime.
`;

      const res = evaluateCandidateWithRules({
        job,
        candidate: { resumeText: resume, answers: [] },
      });

      const cpp = res.criterionResults.find((c) => c.label === "C++");
      const csharp = res.criterionResults.find((c) => c.label === "C#");
      const dotnet = res.criterionResults.find((c) => c.label === ".NET");

      expect(cpp?.status).toBe("met");
      expect(cpp?.score).toBe(100);
      expect(csharp?.status).toBe("met");
      expect(csharp?.score).toBe(100);
      expect(dotnet?.status).toBe("met");
      expect(dotnet?.score).toBe(100);
    });

    it("parses Spanish resume section headers, degrees, and date ranges seamlessly", () => {
      const job = {
        title: "Desarrollador Backend",
        description: "Servicios backend",
        requirements: null,
        experienceLevel: "Mid (3+ years)",
        education: "Bachelor's",
        keywords: ["PostgreSQL", "Docker"],
      };

      const spanishResume = `Mateo González
mateo@ejemplo.com
Buenos Aires, Argentina

EXPERIENCIA LABORAL
Ingeniero Backend — Serviclick (2020 - 2024)
• Diseñó bases de datos relacionales en PostgreSQL con alta disponibilidad.
• Desplegó contenedores utilizando Docker en producción.

EDUCACIÓN
Ingeniería en Informática — Universidad de Buenos Aires (2015 - 2020)

HABILIDADES
• Docker, PostgreSQL, Linux
`;

      const res = evaluateCandidateWithRules({
        job,
        candidate: { resumeText: spanishResume, answers: [] },
      });

      // Experience: 4 years verified (2020 - 2024) meets 3+ years
      const exp = res.criterionResults.find((c) => c.label === "Experience");
      expect(exp?.status).toBe("met");
      expect(exp?.evidence).toContain("4 years of experience verified");

      // Education: Ingeniería en Informática rank 3 meets Bachelor's rank 3
      const edu = res.criterionResults.find((c) => c.label === "Education");
      expect(edu?.status).toBe("met");
      expect(edu?.evidence).toContain("Ingeniería en Informática");

      // Skills: PostgreSQL and Docker demonstrated in work experience
      const pg = res.criterionResults.find((c) => c.label === "PostgreSQL");
      const docker = res.criterionResults.find((c) => c.label === "Docker");
      expect(pg?.status).toBe("met");
      expect(docker?.status).toBe("met");
      expect(pg?.evidence).toContain('Serviclick (Ingeniero Backend): "Diseñó bases de datos relacionales en PostgreSQL con alta disponibilidad."');
    });

    it("handles month/year date intervals accurately (e.g. Mar 2021 - Nov 2023)", () => {
      const job = {
        title: "Developer",
        description: "Dev",
        requirements: null,
        experienceLevel: "Junior (2+ years)",
        education: null,
        keywords: ["Node.js"],
      };

      const resume = `Jane
jane@example.com

EXPERIENCE
Developer — Alpha Inc (Mar 2021 - Nov 2023)
• Built APIs with Node.js.
`;

      const res = evaluateCandidateWithRules({
        job,
        candidate: { resumeText: resume, answers: [] },
      });

      const exp = res.criterionResults.find((c) => c.label === "Experience");
      // Mar 2021 to Nov 2023 = 32 months = 2.7 years
      expect(exp?.status).toBe("met");
      expect(exp?.evidence).toContain("2.7 years of experience verified");
    });

    it("enforces explicit recruiter knockout failure immediately yielding No tier", () => {
      const job = {
        title: "Driver",
        description: "Delivery driver",
        requirements: "Valid driver license is mandatory.",
        experienceLevel: null,
        education: null,
        keywords: ["Driver License"],
      };

      const rubricWithKnockout = {
        version: "custom-rubric-v1",
        criteria: [
          {
            id: "crit:license",
            key: "license",
            label: "Driver License",
            type: "skill" as const,
            importance: "required" as const,
            weight: 50,
            aliases: [],
            isKnockout: true,
          },
        ],
      };

      // Candidate has clean resume but does not mention Driver License
      const resume = `Carlos
carlos@example.com

EXPERIENCE
Warehouse Worker — Logistics Co (2022 - 2024)
• Handled warehouse inventory and package dispatch.
`;

      const res = evaluateCandidateWithRules({
        job,
        candidate: { resumeText: resume, answers: [] },
        rubric: rubricWithKnockout,
      });

      const licenseCrit = res.criterionResults.find((c) => c.label === "Driver License");
      expect(licenseCrit?.status).toBe("unknown"); // legacy mapping
      expect(licenseCrit?.extendedStatus).toBe("not_demonstrated");
      expect(licenseCrit?.isKnockout).toBe(true);
      // Because an explicit knockout was not demonstrated, it fails the gate and results in 'no'
      expect(res.result.recommendation).toBe("no");
      expect(res.requiresHumanReview).toBe(true);
    });

    it("gracefully handles unparseable or missing dates without crashing or claiming phantom years", () => {
      const job = {
        title: "Sales Rep",
        description: "Sales",
        requirements: null,
        experienceLevel: "Mid (3+ years)",
        education: null,
        keywords: ["Sales"],
      };

      const resumeWithoutDates = `Ethan
ethan@example.com

EXPERIENCE
Sales Rep — FastSales
• Sold enterprise software products.
`;

      const res = evaluateCandidateWithRules({
        job,
        candidate: { resumeText: resumeWithoutDates, answers: [] },
      });

      const exp = res.criterionResults.find((c) => c.label === "Experience");
      // Low confidence timeline
      expect(res.requiresHumanReview).toBe(true);
      // Sales skill is still identified in the role
      const sales = res.criterionResults.find((c) => c.label === "Sales");
      expect(sales?.status).toBe("met");
    });
  });
});
