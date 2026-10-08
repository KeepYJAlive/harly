// Creates and destroys its own local test database. Never migrates an existing DB.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const postgres = require("postgres");
const root = fileURLToPath(new URL("../../", import.meta.url));
if (!process.env.HARLY_REMOTE_LIST_TEST_ADMIN_URL)
  throw new Error(
    "Set HARLY_REMOTE_LIST_TEST_ADMIN_URL to Harly's local test PostgreSQL connection.",
  );
const adminUrl = new URL(process.env.HARLY_REMOTE_LIST_TEST_ADMIN_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname))
  throw new Error("Tests require a local PostgreSQL admin URL.");
const admin = postgres(adminUrl.toString(), { max: 1 });
const database = `harly_remote_lists_check_${Date.now()}`;
let created = false;
const temporary = await mkdtemp(path.join(tmpdir(), "harly-migrate-check-"));
try {
  await admin.unsafe(`CREATE DATABASE ${database}`);
  created = true;
  adminUrl.pathname = `/${database}`;
  const env = {
    ...process.env,
    DATABASE_URL: adminUrl.toString(),
    HARLY_REMOTE_LIST_DB_TESTS: "true",
  };
  // Exercise the exact bundled `harly migrate` entrypoint with only Harly DB
  // configuration. Deliberately invalid unrelated URLs must never be parsed.
  const runtime = path.join(temporary, "runtime.mjs");
  const build = spawnSync(
    "pnpm",
    [
      "exec",
      "esbuild",
      "tooling/runtime/src/entrypoint.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node22",
      `--outfile=${runtime}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0)
    throw new Error("Could not build the Harly migration runtime.");
  const migrated = spawnSync(process.execPath, [runtime, "migrate"], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      DATABASE_URL: adminUrl.toString(),
      HARLY_MIGRATIONS_DIR: path.join(root, "packages/db/migrations"),
      HARLY_URL: "not-a-url",
      TAO_URL: "not-a-url",
      TAO_DATABASE_URL: "not-a-url",
    },
  });
  if (migrated.status !== 0) {
    console.error(migrated.stdout, migrated.stderr);
    throw new Error("Harly database-only migration runtime failed.");
  }
  console.log("Bundled harly migrate with only Harly DB settings: PASS");
  for (const args of [
    ["db:verify-migrations"],
    [
      "--filter",
      "web",
      "test",
      "--",
      "src/features/workspaces/remote-list-actions.integration.test.ts",
    ],
  ]) {
    const result = spawnSync("pnpm", args, {
      cwd: root,
      env,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
      throw new Error(`Failed: pnpm ${args.join(" ")}`);
    }
    console.log(result.stdout);
  }
} finally {
  if (created) await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
  await admin.end();
  await rm(temporary, { recursive: true, force: true });
}
