import { describe, expect, it } from "vitest";
import { getHarlyDatabaseUrl, loadMigrationConfig } from "./database";
const database = "postgresql://harly:password@localhost:5432/harly";
describe("Harly database-only migration configuration", () => {
  it("requires only Harly DATABASE_URL, including in production", () => {
    expect(
      loadMigrationConfig({ NODE_ENV: "production", DATABASE_URL: database }),
    ).toEqual({ DATABASE_URL: database, HARLY_VERSION: "0.1.0-dev" });
  });
  it("does not read TAO or unrelated application configuration", () => {
    const source: Record<string, string | undefined> = {
      DATABASE_URL: database,
    };
    for (const name of [
      "TAO_URL",
      "TAO_PG_PASSWORD",
      "TAO_DATABASE_URL",
      "HARLY_REMOTE_LIST_URL",
      "HARLY_URL",
      "AI_ENCRYPTION_KEY",
      "STORAGE_PROVIDER",
    ]) {
      Object.defineProperty(source, name, {
        get() {
          throw new Error(`Must not read ${name}`);
        },
      });
    }
    expect(loadMigrationConfig(source).DATABASE_URL).toBe(database);
  });
  it("explains the unexpanded Compose/dotenv failure without exposing credentials", () => {
    expect(() =>
      loadMigrationConfig({
        DATABASE_URL:
          "postgresql://${POSTGRES_USER}:sensitive@${POSTGRES_HOST}:5432/harly",
      }),
    ).toThrow("unexpanded environment placeholders");
    try {
      loadMigrationConfig({
        DATABASE_URL:
          "postgresql://${POSTGRES_USER}:sensitive@${POSTGRES_HOST}:5432/harly",
      });
    } catch (error) {
      expect(String(error)).not.toContain("sensitive");
    }
  });
  it.each([
    "invalid-url-sensitive",
    "https://sensitive@example.test/harly",
    "postgresql://u:sensitive@localhost:not-a-port/harly",
  ])(
    "rejects malformed/wrong-protocol URLs without echoing input",
    (DATABASE_URL) => {
      try {
        loadMigrationConfig({ DATABASE_URL });
        throw new Error("Expected validation failure");
      } catch (error) {
        expect(String(error)).toContain("DATABASE_URL must be");
        expect(String(error)).not.toContain("sensitive");
      }
    },
  );
  it("never silently uses a different database for migrations", () => {
    expect(() => loadMigrationConfig({})).toThrow("DATABASE_URL is required");
    expect(() =>
      getHarlyDatabaseUrl(
        { NODE_ENV: "production" },
        { allowDevelopmentFallback: true },
      ),
    ).toThrow("DATABASE_URL is required");
  });
  it("preserves encoded credentials and connection options", () => {
    const url =
      "postgres://user:p%40ss%24word@localhost:5432/harly?sslmode=require";
    expect(getHarlyDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });
});
