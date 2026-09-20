/**
 * Skill Concept Layer & Normalization Taxonomy for Harly ATS.
 *
 * Implements Phase 1 of the ATS Evolution Roadmap:
 * - Canonical concept IDs and names (e.g. React, PostgreSQL, TypeScript)
 * - Built-in canonical alias maps (e.g. React.js -> React, Postgres -> PostgreSQL, TS -> TypeScript)
 * - Support for recruiter-defined aliases
 * - Clear separation between equivalent concepts and related (non-equivalent) concepts
 * - Strict preservation of technical symbols (+, #, .)
 */

export type SkillCategory =
  | "frontend"
  | "backend"
  | "mobile"
  | "data"
  | "devops_cloud"
  | "security"
  | "product"
  | "design"
  | "marketing"
  | "sales"
  | "management"
  | "general";

export interface SkillConcept {
  id: string;
  canonicalName: string;
  aliases: string[];
  category?: SkillCategory;
  /** Related skills that must NOT be treated as interchangeable equivalents */
  relatedSkills?: string[];
}

export interface SkillResolutionResult {
  conceptId?: string;
  canonicalName: string;
  searchTokens: string[];
  method: "deterministic_exact" | "built_in_alias" | "recruiter_alias";
  category?: SkillCategory;
}

/**
 * Built-in standard taxonomy of ATS skill concepts across Engineering, Data, Cloud,
 * Marketing, Product, and Sales.
 */
export const BUILT_IN_SKILL_CONCEPTS: SkillConcept[] = [
  // --- FRONTEND ---
  {
    id: "skill:react",
    canonicalName: "React",
    aliases: ["React.js", "ReactJS", "React.JS"],
    category: "frontend",
    relatedSkills: ["Next.js", "React Native"],
  },
  {
    id: "skill:nextjs",
    canonicalName: "Next.js",
    aliases: ["NextJS", "Next", "Next.JS"],
    category: "frontend",
    relatedSkills: ["React"],
  },
  {
    id: "skill:vue",
    canonicalName: "Vue",
    aliases: ["Vue.js", "VueJS", "Vue.JS"],
    category: "frontend",
    relatedSkills: ["Nuxt"],
  },
  {
    id: "skill:nuxt",
    canonicalName: "Nuxt",
    aliases: ["Nuxt.js", "NuxtJS", "Nuxt.JS"],
    category: "frontend",
    relatedSkills: ["Vue"],
  },
  {
    id: "skill:angular",
    canonicalName: "Angular",
    aliases: ["AngularJS", "Angular.js", "Angular 2+"],
    category: "frontend",
  },
  {
    id: "skill:svelte",
    canonicalName: "Svelte",
    aliases: ["SvelteKit", "Svelte.js"],
    category: "frontend",
  },
  {
    id: "skill:typescript",
    canonicalName: "TypeScript",
    aliases: ["TS", "Type Script"],
    category: "frontend",
    relatedSkills: ["JavaScript"],
  },
  {
    id: "skill:javascript",
    canonicalName: "JavaScript",
    aliases: ["JS", "ECMAScript", "ES6", "ES2015", "Vanilla JS"],
    category: "frontend",
    relatedSkills: ["TypeScript"],
  },
  {
    id: "skill:html",
    canonicalName: "HTML",
    aliases: ["HTML5"],
    category: "frontend",
  },
  {
    id: "skill:css",
    canonicalName: "CSS",
    aliases: ["CSS3", "Sass", "SCSS", "Tailwind", "TailwindCSS", "Tailwind CSS"],
    category: "frontend",
  },
  {
    id: "skill:redux",
    canonicalName: "Redux",
    aliases: ["Redux Toolkit", "RTK"],
    category: "frontend",
  },
  {
    id: "skill:graphql",
    canonicalName: "GraphQL",
    aliases: ["Apollo", "Apollo GraphQL"],
    category: "frontend",
  },

  // --- BACKEND ---
  {
    id: "skill:nodejs",
    canonicalName: "Node.js",
    aliases: ["Node", "NodeJS", "Node.JS"],
    category: "backend",
  },
  {
    id: "skill:python",
    canonicalName: "Python",
    aliases: ["Python 3", "Python3", "Py"],
    category: "backend",
  },
  {
    id: "skill:golang",
    canonicalName: "Go",
    aliases: ["Golang"],
    category: "backend",
  },
  {
    id: "skill:rust",
    canonicalName: "Rust",
    aliases: ["RustLang"],
    category: "backend",
  },
  {
    id: "skill:java",
    canonicalName: "Java",
    aliases: ["Java 8", "Java 11", "Java 17", "Java 21"],
    category: "backend",
    relatedSkills: ["Kotlin"],
  },
  {
    id: "skill:cpp",
    canonicalName: "C++",
    aliases: ["Cpp"],
    category: "backend",
    relatedSkills: ["C"],
  },
  {
    id: "skill:csharp",
    canonicalName: "C#",
    aliases: ["CSharp", "C-Sharp"],
    category: "backend",
    relatedSkills: [".NET"],
  },
  {
    id: "skill:dotnet",
    canonicalName: ".NET",
    aliases: [".NET Core", "dotnet", "ASP.NET", "ASP.NET Core"],
    category: "backend",
    relatedSkills: ["C#"],
  },
  {
    id: "skill:ruby",
    canonicalName: "Ruby",
    aliases: ["Ruby on Rails", "Rails"],
    category: "backend",
  },
  {
    id: "skill:php",
    canonicalName: "PHP",
    aliases: ["Laravel", "Symfony"],
    category: "backend",
  },
  {
    id: "skill:django",
    canonicalName: "Django",
    aliases: ["Django REST Framework", "DRF"],
    category: "backend",
  },
  {
    id: "skill:fastapi",
    canonicalName: "FastAPI",
    aliases: ["Fast API"],
    category: "backend",
  },
  {
    id: "skill:spring-boot",
    canonicalName: "Spring Boot",
    aliases: ["Spring", "Spring Framework"],
    category: "backend",
  },

  // --- DATA & DATABASES ---
  {
    id: "skill:postgresql",
    canonicalName: "PostgreSQL",
    aliases: ["Postgres", "PostgreSQL DB", "psql"],
    category: "data",
  },
  {
    id: "skill:mysql",
    canonicalName: "MySQL",
    aliases: ["MariaDB"],
    category: "data",
  },
  {
    id: "skill:mongodb",
    canonicalName: "MongoDB",
    aliases: ["Mongo"],
    category: "data",
  },
  {
    id: "skill:redis",
    canonicalName: "Redis",
    aliases: ["Redis Cache"],
    category: "data",
  },
  {
    id: "skill:sql",
    canonicalName: "SQL",
    aliases: ["Relational Database", "RDBMS", "T-SQL", "PL/SQL"],
    category: "data",
  },
  {
    id: "skill:kafka",
    canonicalName: "Kafka",
    aliases: ["Apache Kafka"],
    category: "data",
  },
  {
    id: "skill:spark",
    canonicalName: "Spark",
    aliases: ["Apache Spark", "PySpark"],
    category: "data",
  },
  {
    id: "skill:snowflake",
    canonicalName: "Snowflake",
    aliases: ["Snowflake DB"],
    category: "data",
  },

  // --- CLOUD & DEVOPS ---
  {
    id: "skill:docker",
    canonicalName: "Docker",
    aliases: ["Containerization", "Containers"],
    category: "devops_cloud",
    relatedSkills: ["Kubernetes"],
  },
  {
    id: "skill:kubernetes",
    canonicalName: "Kubernetes",
    aliases: ["K8s", "EKS", "GKE", "AKS"],
    category: "devops_cloud",
    relatedSkills: ["Docker"],
  },
  {
    id: "skill:aws",
    canonicalName: "AWS",
    aliases: ["Amazon Web Services", "Amazon AWS"],
    category: "devops_cloud",
  },
  {
    id: "skill:gcp",
    canonicalName: "GCP",
    aliases: ["Google Cloud Platform", "Google Cloud"],
    category: "devops_cloud",
  },
  {
    id: "skill:azure",
    canonicalName: "Azure",
    aliases: ["Microsoft Azure"],
    category: "devops_cloud",
  },
  {
    id: "skill:terraform",
    canonicalName: "Terraform",
    aliases: ["IaC", "Infrastructure as Code"],
    category: "devops_cloud",
  },
  {
    id: "skill:ci-cd",
    canonicalName: "CI/CD",
    aliases: ["Continuous Integration", "GitHub Actions", "GitLab CI", "CircleCI", "Jenkins"],
    category: "devops_cloud",
  },
  {
    id: "skill:linux",
    canonicalName: "Linux",
    aliases: ["Ubuntu", "Debian", "CentOS", "RHEL"],
    category: "devops_cloud",
  },

  // --- PRODUCT, DESIGN & BUSINESS ---
  {
    id: "skill:seo",
    canonicalName: "SEO",
    aliases: ["Search Engine Optimization", "Posicionamiento SEO", "Organic Search"],
    category: "marketing",
  },
  {
    id: "skill:sem",
    canonicalName: "SEM",
    aliases: ["Search Engine Marketing", "Google Ads", "Paid Search"],
    category: "marketing",
  },
  {
    id: "skill:paid-acquisition",
    canonicalName: "Paid Acquisition",
    aliases: [
      "Paid Spend",
      "Paid Ads",
      "Performance Marketing",
      "Meta Ads",
      "Facebook Ads",
      "CAC",
    ],
    category: "marketing",
  },
  {
    id: "skill:product-management",
    canonicalName: "Product Management",
    aliases: ["Product Strategy", "Roadmapping", "Product Lifecycle"],
    category: "product",
  },
  {
    id: "skill:ui-ux",
    canonicalName: "UI/UX",
    aliases: ["UI Design", "UX Design", "Figma", "User Experience", "User Interface"],
    category: "design",
  },
  {
    id: "skill:crm",
    canonicalName: "CRM",
    aliases: ["HubSpot", "Salesforce", "Customer Relationship Management"],
    category: "sales",
  },
  {
    id: "skill:agile",
    canonicalName: "Agile",
    aliases: ["Scrum", "Kanban", "Sprint Planning"],
    category: "management",
  },
];

// Normalize text for dictionary lookup
function normalizeLookupKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\-_.]+/g, "")
    .trim();
}

// Build pre-indexed lookup maps for O(1) matching
const CANONICAL_MAP = new Map<string, SkillConcept>();
const ALIAS_MAP = new Map<string, SkillConcept>();

for (const concept of BUILT_IN_SKILL_CONCEPTS) {
  CANONICAL_MAP.set(normalizeLookupKey(concept.canonicalName), concept);
  for (const alias of concept.aliases) {
    ALIAS_MAP.set(normalizeLookupKey(alias), concept);
  }
}

/**
 * Normalizes a raw skill or requirement term against canonical concepts and recruiter aliases.
 */
export function resolveSkillConcept(
  rawTerm: string,
  recruiterAliases?: string[],
): SkillResolutionResult {
  const trimmed = rawTerm.trim();
  const lookupKey = normalizeLookupKey(trimmed);

  // 1. Direct Canonical Match
  const canonicalConcept = CANONICAL_MAP.get(lookupKey);
  if (canonicalConcept) {
    const tokens = [
      canonicalConcept.canonicalName,
      ...canonicalConcept.aliases,
      ...(recruiterAliases ?? []),
    ];
    return {
      conceptId: canonicalConcept.id,
      canonicalName: canonicalConcept.canonicalName,
      searchTokens: [...new Set(tokens)],
      method: "deterministic_exact",
      category: canonicalConcept.category,
    };
  }

  // 2. Built-in Alias Match
  const aliasConcept = ALIAS_MAP.get(lookupKey);
  if (aliasConcept) {
    const tokens = [
      aliasConcept.canonicalName,
      ...aliasConcept.aliases,
      ...(recruiterAliases ?? []),
    ];
    return {
      conceptId: aliasConcept.id,
      canonicalName: aliasConcept.canonicalName,
      searchTokens: [...new Set(tokens)],
      method: "built_in_alias",
      category: aliasConcept.category,
    };
  }

  // 3. Recruiter Alias or Unresolved custom skill
  const tokens = [trimmed, ...(recruiterAliases ?? [])];
  return {
    canonicalName: trimmed,
    searchTokens: [...new Set(tokens)],
    method: recruiterAliases && recruiterAliases.length > 0 ? "recruiter_alias" : "deterministic_exact",
  };
}

/**
 * Checks if candidateSkill is merely related to targetSkill rather than equivalent.
 */
export function isRelatedButNotEquivalent(targetSkill: string, candidateSkill: string): boolean {
  const targetConcept = CANONICAL_MAP.get(normalizeLookupKey(targetSkill));
  if (!targetConcept || !targetConcept.relatedSkills) return false;

  const candidateKey = normalizeLookupKey(candidateSkill);
  return targetConcept.relatedSkills.some(
    (related) => normalizeLookupKey(related) === candidateKey,
  );
}
