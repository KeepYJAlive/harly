import "dotenv/config";

import { getHarlyDatabaseUrl } from "../config/src/database";

import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";
import path from "node:path";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
if (process.cwd() !== configDirectory) process.chdir(configDirectory);

const databaseUrl = getHarlyDatabaseUrl(process.env, {
  allowDevelopmentFallback: true,
});

export default defineConfig({
  out: "./migrations",
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
