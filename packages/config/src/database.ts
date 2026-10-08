/** Resolve only Harly's database configuration. Never read integration settings. */
export function getHarlyDatabaseUrl(
  source: Record<string, string | undefined> = process.env,
  options: { allowDevelopmentFallback?: boolean } = {},
): string {
  const value = source.DATABASE_URL?.trim();
  if (!value) {
    if (options.allowDevelopmentFallback && source.NODE_ENV !== "production") {
      return "postgresql://harly:harly@localhost:5432/harly";
    }
    throw new Error("DATABASE_URL is required for Harly's database.");
  }
  if (/\$\{[^}]+\}/.test(value)) {
    throw new Error(
      "DATABASE_URL contains unexpanded environment placeholders. Set a complete PostgreSQL URL; dotenv and single-quoted Compose values do not expand ${...} references.",
    );
  }
  try {
    const parsed = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      (!parsed.hostname && !parsed.searchParams.get("host")) ||
      parsed.hash
    )
      throw new Error("invalid database URL");
  } catch {
    // Never echo the URL or retain an exception cause containing credentials.
    throw new Error(
      "DATABASE_URL must be a valid PostgreSQL URL for Harly. URL-encode credentials containing reserved characters.",
    );
  }
  return value;
}

/** The migrator does not require the web origin, storage, auth or TAO settings. */
export function loadMigrationConfig(
  source: Record<string, string | undefined> = process.env,
) {
  return {
    DATABASE_URL: getHarlyDatabaseUrl(source),
    HARLY_VERSION: source.HARLY_VERSION?.trim() || "0.1.0-dev",
  };
}
