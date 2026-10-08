import "dotenv/config";

import { getHarlyDatabaseUrl } from "./packages/config/src/database";

import { defineConfig } from "drizzle-kit";

const databaseUrl = getHarlyDatabaseUrl(process.env, {
  allowDevelopmentFallback: true,
});

export default defineConfig({
  out: "./packages/db/migrations",
  schema: "./packages/db/src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
