import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");

test("DigitalOcean assets keep the database secret app-wide and run all runtime roles", async () => {
  const [template, source, manifestContents] = await Promise.all([
    readFile(
      path.join(repositoryRoot, "deploy/digitalocean/app.template.yaml"),
      "utf8",
    ),
    readFile(path.join(packageRoot, "src/index.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "release-manifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestContents);

  assert.match(template, /key: DATABASE_URL\s+scope: RUN_TIME\s+type: SECRET/s);
  assert.match(template, /name: web/);
  assert.match(template, /name: scheduler/);
  assert.match(template, /kind: PRE_DEPLOY/);
  assert.match(template, /path: \/api\/health\/ready/);
  assert.doesNotMatch(template, /tag:\s*(latest|edge)/);
  assert.match(template, new RegExp(`tag: ${manifest.version}`));

  assert.match(
    source,
    /message: "DigitalOcean Managed PostgreSQL connection URL"/,
  );
  assert.match(source, /validate: validateDatabaseUrl/);
  assert.match(source, /secretEnv\("DATABASE_URL", databaseUrl!\)/);
  assert.match(source, /DATABASE_URL=\$\{envLine\(databaseUrl\)\}/);
  assert.match(source, /releaseTagImage/);
  assert.match(source, /from "\.\/release\.js"/);
  assert.match(
    source,
    /https:\/\/raw\.githubusercontent\.com\/Vytral\/harly\/main\/release-manifest\.json/,
  );
  assert.doesNotMatch(source, /ghcr\.io\/vytral\/harly:0\.1\./);
});

test("release manifest is the single source of truth for deployment assets", async () => {
  const [manifestContents, fly, render, railway, digitalOceanButton, releaseModule, ci] =
    await Promise.all([
      readFile(path.join(repositoryRoot, "release-manifest.json"), "utf8"),
      readFile(path.join(repositoryRoot, "fly.toml"), "utf8"),
      readFile(path.join(repositoryRoot, "render.yaml"), "utf8"),
      readFile(path.join(repositoryRoot, "railway.toml"), "utf8"),
      readFile(path.join(repositoryRoot, ".do/app.yaml"), "utf8"),
      readFile(path.join(packageRoot, "src/release.ts"), "utf8"),
      readFile(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
    ]);
  const manifest = JSON.parse(manifestContents);
  const digestImage = `${manifest.image}@${manifest.digest}`;
  const tagImage = `${manifest.image}:${manifest.version}`;

  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(manifest.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(
    fly,
    new RegExp(digestImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    render,
    new RegExp(tagImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(digitalOceanButton, new RegExp(`tag: ${manifest.version}`));
  assert.match(railway, /builder = "DOCKERFILE"/);
  assert.match(railway, /startCommand = "node \/app\/runtime\.mjs serve"/);
  assert.match(railway, /healthcheckPath = "\/api\/health\/ready"/);
  assert.match(releaseModule, new RegExp(`version: "${manifest.version}"`));
  assert.match(releaseModule, new RegExp(`digest: "${manifest.digest}"`));
  assert.match(ci, /release-manifest\.json/);
});

test("version tags are the only published images", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/release-image.yml"),
    "utf8",
  );
  assert.match(workflow, /tags:\n\s+- "v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
  assert.doesNotMatch(workflow, /branches:\s*\[main\]/);
  assert.doesNotMatch(workflow, /value=edge/);
  assert.doesNotMatch(workflow, /prefix=sha-/);
  assert.match(
    workflow,
    /flavor: latest=\$\{\{ steps\.version\.outputs\.latest \}\}/,
  );
  assert.doesNotMatch(workflow, /flavor: latest=true/);
  // A prerelease never moves latest, and neither does a stable tag that is not
  // the highest one published, so latest cannot move backwards.
  assert.match(workflow, /echo "latest=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /sort -V/);
  // The image is scanned before it is pushed, so a blocking finding keeps it
  // out of the registry instead of only skipping the release.
  assert.match(workflow, /image-ref: harly:candidate/);
  assert.match(workflow, /Block fixed CRITICAL vulnerabilities before publishing/);
  // gh has no checkout in the release job, so it needs GH_REPO to find the repo.
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  // The tagged commit is validated before anything is published.
  assert.match(workflow, /uses: \.\/\.github\/workflows\/ci\.yml/);
  // The notes are published only once the manifest they point at is live.
  assert.match(workflow, /needs: \[image, release-manifest\]/);
  // The manifest moves only for the release that owns the stable channel. A
  // stable patch on an older line must not rewrite it, or `harly update` would
  // hand every stable installation an older version than it already runs.
  assert.match(
    workflow,
    /if: needs\.image\.outputs\.latest == 'true'/,
  );
  assert.doesNotMatch(
    workflow,
    /if: needs\.image\.outputs\.prerelease == 'false'/,
  );
  for (const file of [
    "release-manifest.json",
    "fly.toml",
    "render.yaml",
    ".do/app.yaml",
    "deploy/digitalocean/app.template.yaml",
    "tooling/harly/src/release.ts",
  ]) {
    assert.match(workflow, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(workflow, /deploy\/railway\/README\.md/);
});

test("cloud documentation links and provider instructions resolve", async () => {
  const [guide, readme, selfHosting, source] = await Promise.all([
    readFile(path.join(repositoryRoot, "docs/cloud-deployments.md"), "utf8"),
    readFile(path.join(repositoryRoot, "README.md"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/self-hosting.md"), "utf8"),
    readFile(path.join(packageRoot, "src/index.ts"), "utf8"),
  ]);

  for (const provider of ["Railway", "Fly.io", "DigitalOcean", "Render"])
    assert.match(guide, new RegExp(provider.replace(".", "\\.")));
  assert.match(guide, /\.do\/app\.yaml/);
  assert.match(guide, /render\.yaml/);
  assert.doesNotMatch(guide, /Railway template editor/);
  assert.match(readme, /Deploy on DigitalOcean/);
  assert.match(readme, /Deploy to Render/);
  assert.doesNotMatch(readme, /Deploy to Vercel/);
  assert.match(readme, /https:\/\/cloud\.digitalocean\.com\/apps\/new\?repo=/);
  assert.match(readme, /https:\/\/render\.com\/deploy\?repo=/);
  assert.match(guide, /\[\`fly\.toml\`\]\(\.\.\/fly\.toml\)/);
  assert.match(selfHosting, /cloud-deployments\.md/);
  assert.match(source, /railwayApi/);
  assert.match(source, /serviceCreate/);

  for (const relativePath of [
    "deploy/digitalocean/app.template.yaml",
    ".do/app.yaml",
    "render.yaml",
    "fly.toml",
    "railway.toml",
    "docs/cloud-deployments.md",
  ])
    await access(path.join(repositoryRoot, relativePath));
});
