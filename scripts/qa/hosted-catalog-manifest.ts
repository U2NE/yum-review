import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { buildCatalogPreservationManifest, assertCatalogPreserved, type CatalogSnapshot } from "./catalog-preservation-manifest.js";

const EXPECTED = { restaurants: 3, menus: 72, menuPhotos: 40 };
const EXPECTED_MENU_PHOTO_BYTES = 11_576_811;
const EXPECTED_PROJECT_REF = "zeyrmufaprctdbhfvjic";
const EXPECTED_PROJECT_HOST = `${EXPECTED_PROJECT_REF}.supabase.co`;
const EXPECTED_DB_USER = `postgres.${EXPECTED_PROJECT_REF}`;
const AUTH_REQUIRED_CHARACTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";
const EXPECTED_MIGRATIONS = ["20260928115000", "20260928120000", "20260928130000", "20260928140000"];
const BUCKET = "yum-review-media";
const DB_HOST = "aws-0-ap-south-1.pooler.supabase.com";
let verificationStage = "runtime-configuration";
let failedStage = "none";
let reconciliationStage = "not-run";
let applyCliInvoked = false;
let postCatalogMatch: "not-run" | "matched" | "failed" = "not-run";
let latestAppliedVersion = "unknown";
let failureCategory = "unknown";
const EXPECTED_MIGRATION_FILES = EXPECTED_MIGRATIONS.map(version => `${version}_${({
  "20260928115000": "personal_data_write_freeze",
  "20260928120000": "purge_journal_and_menu_media_attribution",
  "20260928130000": "auth_email_lookup_limits",
  "20260928140000": "restaurant_location_consent",
} as Record<string, string>)[version]}.sql`);

interface RuntimeConfig {
  databaseHost: string;
  databaseUser: string;
  databasePassword: string;
  supabaseUrl: string;
  serviceKey: string;
  caPath: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in the process environment.`);
  return value;
}

function runtimeConfig(): RuntimeConfig {
  const config = {
    databaseHost: DB_HOST,
    databaseUser: required("SUPABASE_DB_USER"),
    databasePassword: required("PGPASSWORD"),
    supabaseUrl: required("SUPABASE_URL"),
    serviceKey: required("SUPABASE_SERVICE_KEY"),
    caPath: required("SUPABASE_CA_PATH"),
  };
  assertHostedProjectBinding(config);
  return config;
}

export function assertHostedProjectBinding(config: Pick<RuntimeConfig, "databaseHost" | "databaseUser" | "supabaseUrl">): void {
  let url: URL;
  try { url = new URL(config.supabaseUrl); } catch { throw new Error("Hosted Supabase project binding is invalid."); }
  if (url.protocol !== "https:" || url.hostname !== EXPECTED_PROJECT_HOST || url.port || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || config.databaseHost !== DB_HOST || config.databaseUser !== EXPECTED_DB_USER) {
    throw new Error("Hosted Supabase project binding does not match the approved production project.");
  }
}

export function assertReleaseWorktreeClean(status: string): void {
  if (status.length > 0) throw new Error("Release requires a clean tracked and untracked worktree.");
}

export function assertOriginMainIsAncestor(isAncestorExitCode: number): void {
  if (isAncestorExitCode !== 0) throw new Error("Local HEAD is not a fast-forward update of origin/main.");
}

const APPROVED_GITHUB_REMOTE = /^(?:https:\/\/github\.com\/U2NE\/yum-review(?:\.git)?|git@github\.com:U2NE\/yum-review(?:\.git)?|ssh:\/\/git@github\.com\/U2NE\/yum-review(?:\.git)?)$/i;

export function assertApprovedGitHubRemote(fetchUrls: readonly string[], pushUrls: readonly string[]): void {
  const approved = (url: string) => APPROVED_GITHUB_REMOTE.test(url);
  if (fetchUrls.length === 0 || pushUrls.length === 0 || fetchUrls.some(url => !approved(url)) || pushUrls.some(url => !approved(url))) {
    throw new Error("Origin fetch and push remotes must resolve to the approved GitHub repository.");
  }
}

export function assertExactRedirectAllowlist(actual: readonly string[], requested: readonly string[]): void {
  const actualSet = new Set(actual);
  const requestedSet = new Set(requested);
  if (actualSet.size !== requestedSet.size || [...requestedSet].some(entry => !actualSet.has(entry))) {
    throw new Error("Hosted Auth redirect allowlist did not preserve the requested entries.");
  }
}

export function gitChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "SSH_AUTH_SOCK"];
  return Object.fromEntries(allowed.flatMap(name => source[name] === undefined ? [] : [[name, source[name]]])) as NodeJS.ProcessEnv;
}

export function buildHostedAuthSettingsPayload(allowlist: readonly string[]): Record<string, unknown> {
  return {
    site_url: "https://yum-review.vercel.app",
    uri_allow_list: allowlist.join(","),
    password_min_length: 8,
    password_required_characters: AUTH_REQUIRED_CHARACTERS,
  };
}

function runGit(args: string[]) {
  return spawnSync("git", args, { encoding: "utf8", timeout: 120_000, env: gitChildEnvironment(process.env) });
}

function assertReleaseCheckout(expectedCommit: string): void {
  const status = runGit(["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0) throw new Error("Could not verify a clean release worktree.");
  assertReleaseWorktreeClean(status.stdout);
  const head = runGit(["rev-parse", "HEAD"]);
  if (head.status !== 0 || head.stdout.trim().toLowerCase() !== expectedCommit.toLowerCase()) {
    throw new Error("Local HEAD changed after the release commit was pinned.");
  }
  const fetchUrls = runGit(["remote", "get-url", "--all", "origin"]);
  const pushUrls = runGit(["remote", "get-url", "--push", "--all", "origin"]);
  if (fetchUrls.status !== 0 || pushUrls.status !== 0) throw new Error("Could not verify origin fetch and push remotes.");
  assertApprovedGitHubRemote(fetchUrls.stdout.trim().split(/\r?\n/).filter(Boolean), pushUrls.stdout.trim().split(/\r?\n/).filter(Boolean));
  const fetch = runGit(["fetch", "origin", "main"]);
  if (fetch.status !== 0) throw new Error("Could not refresh origin/main before release.");
  const ancestor = runGit(["merge-base", "--is-ancestor", "origin/main", expectedCommit]);
  assertOriginMainIsAncestor(ancestor.status ?? 1);
}

function safeAuthPolicy(auth: Record<string, unknown>) {
  const allowlist = auth.redirectAllowlist as string[];
  const callbackAllowed = allowlist.some(pattern => {
    const target = "https://yum-review.vercel.app/auth/callback";
    if (!pattern.startsWith("https://yum-review.vercel.app/")) return false;
    let offset = 0;
    for (const part of pattern.split("*")) {
      const index = target.indexOf(part, offset);
      if (index < 0 || (offset === 0 && index !== 0)) return false;
      offset = index + part.length;
    }
    return pattern.endsWith("*") || offset === target.length;
  });
  return {
    productionCallbackExplicitlyAllowlisted: callbackAllowed,
    localhostRedirectPresent: allowlist.some(value => /localhost|127\.0\.0\.1/i.test(value)),
    minimumPasswordLength: auth.minimumPasswordLength,
    passwordRequiredCharacters: auth.passwordRequiredCharacters,
  };
}

export async function readHostedAuthConfiguration(config = runtimeConfig()): Promise<Record<string, unknown>> {
  assertHostedProjectBinding(config);
  const managementToken = required("SUPABASE_MANAGEMENT_TOKEN");
  const projectRef = new URL(config.supabaseUrl).hostname.split(".")[0];
  if (projectRef !== EXPECTED_PROJECT_REF) throw new Error("Management API project ref does not match the approved production project.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`, {
    headers: { authorization: `Bearer ${managementToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Hosted Auth configuration read failed.");
  const value = await response.json() as Record<string, unknown>;
  // Return only non-secret release-relevant settings to callers.
  const allowlist = typeof value.uri_allow_list === "string"
    ? value.uri_allow_list.split(",").map(entry => entry.trim()).filter(Boolean)
    : Array.isArray(value.uri_allow_list) ? value.uri_allow_list.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    siteUrl: typeof value.site_url === "string" ? value.site_url : null,
    redirectAllowlist: allowlist,
    minimumPasswordLength: typeof value.password_min_length === "number" ? value.password_min_length : null,
    passwordRequiredCharacters: typeof value.password_required_characters === "string" ? value.password_required_characters : null,
  };
}

export async function findHostedProjectRef(): Promise<string> {
  const managementToken = required("SUPABASE_MANAGEMENT_TOKEN");
  const response = await fetch("https://api.supabase.com/v1/projects", {
    headers: { authorization: `Bearer ${managementToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Supabase project lookup failed.");
  const projects = await response.json() as Array<{ name?: unknown; ref?: unknown }>;
  const matches = projects.filter(project => project.name === "yum-review" && typeof project.ref === "string");
  if (matches.length !== 1) throw new Error("Supabase project identity is missing or ambiguous.");
  return matches[0].ref as string;
}

/** Read Vercel production's Git SHA without returning or logging the token. */
export async function readVercelProductionCommit(): Promise<string> {
  const token = required("VERCEL_TOKEN");
  const projectResponse = await fetch("https://api.vercel.com/v9/projects/yum-review", {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!projectResponse.ok) throw new Error("Vercel project lookup failed.");
  const project = await projectResponse.json() as { id?: unknown };
  if (typeof project.id !== "string") throw new Error("Vercel project lookup returned no project identity.");
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", project.id);
  url.searchParams.set("target", "production");
  url.searchParams.set("limit", "1");
  const deploymentResponse = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!deploymentResponse.ok) throw new Error("Vercel production deployment lookup failed.");
  const data = await deploymentResponse.json() as { deployments?: Array<{ uid?: unknown; meta?: Record<string, unknown>; readyState?: unknown }> };
  const deployment = data.deployments?.[0];
  if (!deployment || deployment.readyState !== "READY") throw new Error("Vercel production deployment is not ready.");
  const sha = deployment.meta?.githubCommitSha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Vercel production deployment has no verified Git commit SHA.");
  if (deployment.meta?.githubCommitOrg !== "U2NE" || deployment.meta?.githubCommitRepo !== "yum-review" || typeof deployment.uid !== "string") {
    throw new Error("Vercel deployment Git repository identity is unavailable or mismatched.");
  }
  const aliasesResponse = await fetch(`https://api.vercel.com/v2/deployments/${encodeURIComponent(deployment.uid)}/aliases`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!aliasesResponse.ok) throw new Error("Vercel production deployment alias lookup failed.");
  const aliasData = await aliasesResponse.json() as { aliases?: unknown[] };
  const aliases = (aliasData.aliases ?? []).map(alias => typeof alias === "string" ? alias :
    alias && typeof alias === "object" && "alias" in alias && typeof alias.alias === "string" ? alias.alias : "");
  if (!aliases.includes("yum-review.vercel.app")) throw new Error("Vercel production deployment is not bound to the approved domain.");
  return sha;
}

function storageObjectUrl(base: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${encodedPath}`;
}

export function assertExactPendingMigrations(actual: readonly string[]): void {
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_MIGRATION_FILES)) {
    throw new Error("Pending hosted migration set differs from the four approved additive migrations.");
  }
}

export function assertExactStoragePaths(storagePaths: readonly string[], assetPaths: readonly string[]): void {
  const storage = [...storagePaths].sort();
  const assets = [...assetPaths].sort();
  if (storage.length !== EXPECTED.menuPhotos || assets.length !== EXPECTED.menuPhotos ||
      new Set(storage).size !== storage.length || new Set(assets).size !== assets.length ||
      JSON.stringify(storage) !== JSON.stringify(assets)) {
    throw new Error("MENU Storage object path-set check failed.");
  }
}

/** Legacy helper for explicit comparisons across the G9 schema boundary.
 * Fresh G10 release snapshots deliberately keep both current-schema columns.
 */
export function normalizeHostedRestaurantRow(row: Record<string, unknown>): Record<string, unknown> {
  const catalogRow = { ...row };
  delete catalogRow.location_consent_version;
  delete catalogRow.location_consent_at;
  return catalogRow;
}

/** Runs the complete prospective release operation under one process-only key.
 * The caller must perform the main push and deployed HTTP health check inside
 * operation; the post-check re-reads every row and MENU object before success.
 */
async function withHostedCatalogRelease<T>(
  expectedCommit: string,
  operation: () => Promise<T>,
  config = runtimeConfig(),
): Promise<{ result: T; manifest: ReturnType<typeof buildCatalogPreservationManifest> }> {
  if (!/^[a-f0-9]{40}$/i.test(expectedCommit)) throw new Error("Expected release commit must be a full Git SHA.");
  await verifyHostedReleasePreconditions(config);
  return withHostedCatalogPreservation(async () => {
    const result = await operation();
    const deployedCommit = await readVercelProductionCommit();
    if (deployedCommit.toLowerCase() !== expectedCommit.toLowerCase()) throw new Error("Vercel production commit does not match the released Git commit.");
    const health = await fetch("https://yum-review.vercel.app/", { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!health.ok || health.status !== 200) throw new Error("Deployed production HTTP health check failed.");
    return result;
  }, config);
}

/** Pushes only the already checked-out full HEAD and waits for the verified production alias. */
export async function pushAndWaitForHostedRelease(config = runtimeConfig()): Promise<{ commit: string; counts: unknown }> {
  assertHostedProjectBinding(config);
  const headResult = runGit(["rev-parse", "HEAD"]);
  const expectedCommit = headResult.status === 0 ? headResult.stdout.trim() : "";
  if (!/^[a-f0-9]{40}$/i.test(expectedCommit)) throw new Error("Local HEAD is not a verified full Git SHA.");
  assertReleaseCheckout(expectedCommit);
  return withHostedCatalogRelease(expectedCommit, async () => {
    assertReleaseCheckout(expectedCommit);
    const push = runGit(["push", "origin", `${expectedCommit}:refs/heads/main`]);
    if (push.status !== 0) throw new Error("Git push to origin main failed.");
    const deadline = Date.now() + 10 * 60_000;
    let deployedCommit = "";
    while (Date.now() < deadline) {
      try { deployedCommit = await readVercelProductionCommit(); } catch { /* deployment may still be building */ }
      if (deployedCommit.toLowerCase() === expectedCommit.toLowerCase()) return { commit: deployedCommit };
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }
    throw new Error("Expected Vercel production deployment did not become READY on the approved domain.");
  }, config).then(({ result, manifest }) => ({ commit: result.commit, counts: manifest.counts }));
}

/** Updates only the approved production Auth fields and verifies their persisted values. */
export async function updateHostedAuthReleaseSettings(config = runtimeConfig()): Promise<Record<string, unknown>> {
  assertHostedProjectBinding(config);
  const token = required("SUPABASE_MANAGEMENT_TOKEN");
  const projectRef = new URL(config.supabaseUrl).hostname.split(".")[0];
  if (projectRef !== EXPECTED_PROJECT_REF) throw new Error("Management API project ref does not match the approved production project.");
  const endpoint = "https://api.supabase.com/v1/projects/" + encodeURIComponent(projectRef) + "/config/auth";
  const current = await readHostedAuthConfiguration(config);
  const prior = current.redirectAllowlist as string[];
  const allowlist = Array.from(new Set(prior.concat("https://yum-review.vercel.app/auth/callback")));
  const response = await fetch(endpoint, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(buildHostedAuthSettingsPayload(allowlist)),
    signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Hosted Auth production settings update failed.");
  const verified = await readHostedAuthConfiguration(config);
  const verifiedAllowlist = verified.redirectAllowlist as string[];
  assertExactRedirectAllowlist(verifiedAllowlist, allowlist);
  if (verified.siteUrl !== "https://yum-review.vercel.app" || !verifiedAllowlist.includes("https://yum-review.vercel.app/auth/callback") ||
      verified.minimumPasswordLength !== 8 || verified.passwordRequiredCharacters !== AUTH_REQUIRED_CHARACTERS) {
    throw new Error("Hosted Auth production settings did not match the requested values after update.");
  }
  return safeAuthPolicy(verified);
}

export function buildDryRunArgs(dbUrl: string): string[] {
  return ["db", "push", "--dry-run", "--db-url", dbUrl];
}

export function buildApplyArgs(dbUrl: string): string[] {
  return ["db", "push", "--yes", "--skip-vault", "--db-url", dbUrl];
}

export interface SafeCliFailure {
  exitCode: string;
  errorCode: string;
  sqlState: string;
  detail: "lock timeout" | "statement timeout" | "permission denied" | "missing relation" | "duplicate object" | "SQL syntax error" | "authentication failure" | "connection failure" | "migration failure" | "database operation failure";
}

export function safeCliFailure(exit: number | null, stderr: string, stdout = ""): SafeCliFailure {
  const lines = [...stderr.split(/\r?\n/), ...stdout.split(/\r?\n/)];
  const jsonLine = [...lines].reverse().find(line => line.trimStart().startsWith("{"));
  let code = "unavailable";
  let message = "";
  if (jsonLine) {
    try {
      const parsed = JSON.parse(jsonLine) as { error?: { code?: unknown; message?: unknown } };
      if (typeof parsed.error?.code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(parsed.error.code)) code = parsed.error.code;
      if (typeof parsed.error?.message === "string") message = parsed.error.message;
    } catch { /* report only a fixed failure category */ }
  }
  if (!message) message = [...stderr.split(/\r?\n/)].map(line => line.trim()).filter(Boolean).at(-1) ?? "";
  const sqlState = /(?:SQLSTATE\s*[:=]?\s*|code\s+)([A-Z0-9]{5})/i.exec(message)?.[1]?.toUpperCase() ?? "unavailable";
  const detail: SafeCliFailure["detail"] = /lock timeout/i.test(message) ? "lock timeout"
    : /statement timeout/i.test(message) ? "statement timeout"
    : /permission denied/i.test(message) ? "permission denied"
    : /relation .* does not exist/i.test(message) ? "missing relation"
    : /already exists/i.test(message) ? "duplicate object"
    : /syntax error/i.test(message) ? "SQL syntax error"
    : /password|scram|authentication/i.test(message) ? "authentication failure"
    : /connect|timeout|hostname|dns|network/i.test(message) ? "connection failure"
    : /migration/i.test(message) ? "migration failure"
    : "database operation failure";
  return { exitCode: exit === null ? "unknown" : String(exit), errorCode: code, sqlState, detail };
}

function cli(env: NodeJS.ProcessEnv, args: string[], mutation: boolean = false): string {
  if (mutation) { applyCliInvoked = true; verificationStage = "cli-apply-invoked"; }
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const result = spawnSync(process.execPath, [npmCli, "exec", "--", "supabase", ...args], {
    env,
    encoding: "utf8",
    timeout: 5 * 60_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const safe = safeCliFailure(result.status, result.stderr ?? "", result.stdout ?? "");
    failureCategory = `exit ${safe.exitCode}, errorCode ${safe.errorCode}, SQLSTATE ${safe.sqlState}, ${safe.detail}`;
    throw new Error("Official Supabase CLI operation failed.");
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function migrationList(output: string): string[] {
  const start = output.lastIndexOf('{"upToDate"');
  if (start < 0) throw new Error("Official Supabase CLI dry-run returned no machine-readable result.");
  const payload = JSON.parse(output.slice(start).split(/\r?\n/, 1)[0]) as { dryRun?: unknown; migrations?: unknown; seeds?: unknown; roles?: unknown };
  if (payload.dryRun !== true || !Array.isArray(payload.migrations) || !Array.isArray(payload.seeds) || !Array.isArray(payload.roles) || payload.seeds.length || payload.roles.length) {
    throw new Error("Official Supabase CLI dry-run returned unexpected work.");
  }
  assertExactPendingMigrations(payload.migrations as string[]);
  return payload.migrations as string[];
}

async function verifyMigrationHistory(config: RuntimeConfig): Promise<void> {
  const ca = await readFile(config.caPath, "utf8");
  const client = new Client({
    host: config.databaseHost, port: 5432, database: "postgres", user: config.databaseUser,
    password: config.databasePassword, ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000, statement_timeout: 30_000, query_timeout: 35_000,
    application_name: "yum-review-g8-migration-history-verification",
  });
  await client.connect();
  try {
    const result = await client.query("SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])", [EXPECTED_MIGRATIONS]);
    const applied = result.rows.map(row => String(row.version)).sort();
    if (JSON.stringify(applied) !== JSON.stringify([...EXPECTED_MIGRATIONS].sort())) throw new Error("Hosted migration history does not contain exactly the four expected versions.");
    const guard = await client.query("SELECT count(*)::integer AS total, count(*) FILTER (WHERE active_run_id IS NULL AND frozen_at IS NULL)::integer AS inactive FROM private.personal_data_write_freeze");
    if (guard.rows[0]?.total !== 1 || guard.rows[0]?.inactive !== 1) throw new Error("Hosted personal-data write freeze did not initialize as a single inactive guard.");
  } finally {
    await client.end();
  }
}

/** Read-only G10 release preflight for migration history, PG17 roles/grants,
 * and the inactive personal-data freeze. It emits no database row values.
 */
export async function verifyHostedReleasePreconditions(config = runtimeConfig()): Promise<void> {
  const ca = await readFile(config.caPath, "utf8");
  const client = new Client({
    host: config.databaseHost, port: 5432, database: "postgres", user: config.databaseUser,
    password: config.databasePassword, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000, query_timeout: 35_000, application_name: "yum-review-g10-release-preflight",
  });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (current_setting('server_version_num')::integer / 10000)::integer AS postgres_major,
        (SELECT count(*) FROM supabase_migrations.schema_migrations)::integer AS migration_count,
        (SELECT max(version)::text FROM supabase_migrations.schema_migrations) AS latest_migration,
        (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('purge_guard_owner','purge_identity'))::integer AS role_count,
        (SELECT count(*) FROM pg_catalog.pg_roles WHERE
          (rolname = 'purge_guard_owner' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls OR rolcanlogin)) OR
          (rolname = 'purge_identity' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls OR NOT rolcanlogin)))::integer AS bad_role_attributes,
        (SELECT count(*) FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member
          WHERE r.rolname IN ('purge_guard_owner','purge_identity') OR u.rolname IN ('purge_guard_owner','purge_identity'))::integer AS membership_count,
        (SELECT count(*) FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member
          WHERE r.rolname = 'purge_guard_owner' AND u.rolname = 'postgres' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)::integer AS admin_edge_count,
        (SELECT count(*) FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member
          WHERE r.rolname = 'purge_guard_owner' AND u.rolname = 'postgres' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)::integer AS set_edge_count,
        (SELECT count(*) FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member
          WHERE r.rolname = 'purge_identity' AND u.rolname = 'postgres' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)::integer AS identity_edge_count,
        (SELECT count(*) FROM unnest(ARRAY['private','public']::name[]) AS s(schema_name)
          WHERE pg_catalog.has_schema_privilege('purge_guard_owner', s.schema_name, 'CREATE'))::integer AS guard_create_grants,
        (SELECT count(*) FROM private.personal_data_write_freeze
          WHERE active_run_id IS NULL AND frozen_at IS NULL)::integer AS inactive_freeze_count,
        (SELECT count(*) FROM private.personal_data_write_freeze)::integer AS freeze_rows
    `);
    const row = result.rows[0] as Record<string, unknown>;
    const versions = await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version");
    const applied = versions.rows.map(value => String(value.version));
    if (Number(row.postgres_major) !== 17 || Number(row.migration_count) !== 18 || row.latest_migration !== "20260928140000" ||
        JSON.stringify(applied.slice(-4)) !== JSON.stringify(EXPECTED_MIGRATIONS) || Number(row.role_count) !== 2 ||
        Number(row.bad_role_attributes) !== 0 || Number(row.membership_count) !== 3 || Number(row.admin_edge_count) !== 1 ||
        Number(row.set_edge_count) !== 1 || Number(row.identity_edge_count) !== 1 || Number(row.guard_create_grants) !== 0 ||
        Number(row.freeze_rows) !== 1 || Number(row.inactive_freeze_count) !== 1) {
      throw new Error("Hosted G10 release preconditions failed.");
    }
  } finally { await client.end(); }
}

async function currentMigrationHistory(config: RuntimeConfig): Promise<string[]> {
  const ca = await readFile(config.caPath, "utf8");
  const client = new Client({ host: config.databaseHost, port: 5432, database: "postgres", user: config.databaseUser,
    password: config.databasePassword, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000, query_timeout: 35_000, application_name: "yum-review-g8-migration-status" });
  await client.connect();
  try {
    const result = await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version");
    return result.rows.map(row => String(row.version));
  } finally { await client.end(); }
}

async function diagnoseMigrationPreconditions(config: RuntimeConfig): Promise<Record<string, number>> {
  const ca = await readFile(config.caPath, "utf8");
  const client = new Client({ host: config.databaseHost, port: 5432, database: "postgres", user: config.databaseUser,
    password: config.databasePassword, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000, query_timeout: 35_000, application_name: "yum-review-g8-migration-precondition-diagnosis" });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (current_setting('server_version_num')::integer / 10000)::integer AS postgres_major_version,
        (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('purge_guard_owner','purge_identity'))::integer AS purge_roles_present,
        (SELECT count(*) FROM pg_catalog.pg_roles WHERE
          (rolname = 'purge_guard_owner' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolcanlogin)) OR
          (rolname = 'purge_identity' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR NOT rolcanlogin)))::integer AS purge_role_attribute_guard,
        (SELECT count(*) FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member
          WHERE r.rolname IN ('purge_guard_owner','purge_identity') OR u.rolname IN ('purge_guard_owner','purge_identity'))::integer AS purge_role_membership_guard,
        (SELECT count(*) FROM public.media_assets a WHERE a.media_kind = 'MENU' AND
          (a.uploaded_by IS NULL OR a.object_path <> ('menu/' || a.uploaded_by::text || '/' || a.id::text ||
            CASE a.content_type WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END)))::integer AS menu_path_guard,
        (SELECT count(*) FROM public.menus m JOIN public.media_assets a ON a.id = m.photo_media_id
          WHERE a.media_kind <> 'MENU' OR a.menu_id IS DISTINCT FROM m.id)::integer AS menu_association_guard
    `);
    const row = result.rows[0] as Record<string, unknown>;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  } finally { await client.end(); }
}

async function applyTrackedMigrations(config: RuntimeConfig): Promise<void> {
  verificationStage = "apply-preflight-dry-run";
  if (!process.env.PGPASSWORD || !process.env.SUPABASE_DB_PASSWORD) throw new Error("Password must be injected into the process environment.");
  const env = { ...process.env, PGSSLROOTCERT: config.caPath, PGOPTIONS: "-c lock_timeout=5s -c statement_timeout=120s" };
  const dbUrl = `postgresql://${encodeURIComponent(config.databaseUser)}@${config.databaseHost}:5432/postgres?sslmode=verify-full`;
  verificationStage = "cli-dry-run";
  const dryRun = cli(env, buildDryRunArgs(dbUrl));
  verificationStage = "apply-preflight-migration-list";
  migrationList(dryRun);
  verificationStage = "cli-apply-invoked";
  try {
    cli(env, buildApplyArgs(dbUrl), true);
  } catch (error) {
    if (failedStage === "none") failedStage = verificationStage;
    reconciliationStage = "post-failure-migration-history-query";
    verificationStage = "post-failure-history-reconciliation";
    let versions: string[];
    try { versions = await currentMigrationHistory(config); }
    catch {
      failureCategory = "migration history reconciliation failed";
      throw new Error("Tracked Supabase apply failed and history could not be reconciled.");
    }
    const lastApplied = versions.at(-1) ?? "none";
    latestAppliedVersion = lastApplied;
    if (!(error instanceof Error && /Official Supabase CLI operation failed/.test(error.message))) failureCategory = "CLI apply operation failed before process result";
    reconciliationStage = "post-failure-migration-history-verified";
    throw new Error("Tracked Supabase apply failed.");
  }
  verificationStage = "post-apply-history-and-inactive-guard-verification";
  await verifyMigrationHistory(config);
}

/** Read-only, byte-complete snapshot. Raw object paths and bytes remain in memory only. */
export async function readHostedCatalog(config: RuntimeConfig): Promise<CatalogSnapshot> {
  assertHostedProjectBinding(config);
  verificationStage = "hosted-catalog-read";
  const ca = await readFile(config.caPath);
  const client = new Client({
    host: config.databaseHost,
    port: 5432,
    database: "postgres",
    user: config.databaseUser,
    password: config.databasePassword,
    ssl: { ca: ca.toString("utf8"), rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "yum-review-g8-catalog-verification",
  });
  let stage = "connect";
  try {
  await client.connect();
  try {
    stage = "catalog-query";
    const restaurantsResult = await client.query("SELECT to_jsonb(r) AS row FROM public.restaurants r ORDER BY r.id");
    const menusResult = await client.query("SELECT to_jsonb(m) AS row FROM public.menus m ORDER BY m.id");
    const objectsResult = await client.query(
      "SELECT a.object_path, a.menu_id, m.restaurant_id FROM public.media_assets a JOIN public.menus m ON m.id = a.menu_id WHERE a.media_kind = 'MENU' ORDER BY a.object_path",
    );
    const storageResult = await client.query("SELECT name FROM storage.objects WHERE bucket_id = $1 AND name LIKE 'menu/%' ORDER BY name", [BUCKET]);
    if (restaurantsResult.rowCount !== EXPECTED.restaurants || menusResult.rowCount !== EXPECTED.menus || objectsResult.rowCount !== EXPECTED.menuPhotos) {
      throw new Error("Hosted catalog counts do not match the approved preservation gate.");
    }
    const items = objectsResult.rows as Array<{ object_path: string; menu_id: string | number; restaurant_id: string | number }>;
    assertExactStoragePaths(storageResult.rows.map(row => String(row.name)), items.map(item => item.object_path));
    const photos = new Array<CatalogSnapshot["menuPhotos"][number]>(items.length);
    stage = "storage-byte-read";
    let next = 0;
    const readWorker = async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        const item = items[index];
        const response = await fetch(storageObjectUrl(config.supabaseUrl, item.object_path), {
          headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error("A hosted MENU object could not be read completely.");
        const bytes = Buffer.from(await response.arrayBuffer());
        const declaredLength = Number(response.headers.get("content-length"));
        if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength !== bytes.byteLength) throw new Error("A hosted MENU object byte read was incomplete.");
        photos[index] = { restaurantId: item.restaurant_id, menuId: item.menu_id, objectPath: item.object_path, bytes };
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, items.length) }, () => readWorker()));
    return {
      restaurants: restaurantsResult.rows.map(row => row.row),
      menus: menusResult.rows.map(row => ({ ...row.row, restaurantId: row.row.restaurant_id })),
      menuPhotos: photos,
    };
  } finally {
    await client.end();
  }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? ` (${error.code})`
      : "";
    throw new Error(`Hosted catalog preflight failed during ${stage}${code}.`);
  }
}

export function assertExpectedManifest(manifest: ReturnType<typeof buildCatalogPreservationManifest>, snapshot: CatalogSnapshot): void {
  if (manifest.counts.restaurants !== EXPECTED.restaurants || manifest.counts.menus !== EXPECTED.menus || manifest.counts.menuPhotos !== EXPECTED.menuPhotos ||
    manifest.counts.menuPhotoBytes !== EXPECTED_MENU_PHOTO_BYTES || manifest.counts.gompocha.restaurants !== 1 ||
    manifest.counts.gompocha.menus !== 40 || manifest.counts.gompocha.menuPhotos !== 40) {
    const names = snapshot.restaurants.map(row => typeof row.name === "string" ? row.name.normalize("NFC") : "");
    const korean = names.filter(name => /곰포차/i.test(name)).length;
    const latin = names.filter(name => /gompocha/i.test(name)).length;
    const bear = names.filter(name => /곰/i.test(name)).length;
    const generic = names.filter(name => /포차/i.test(name)).length;
    throw new Error(`Hosted keyed catalog count gate failed (restaurants=${manifest.counts.restaurants}, menus=${manifest.counts.menus}, MENU objects=${manifest.counts.menuPhotos}, Gompocha menus=${manifest.counts.gompocha.menus}, Gompocha objects=${manifest.counts.gompocha.menuPhotos}; matching restaurant counts Korean=${korean}, Latin=${latin}, bear=${bear}, pub=${generic}).`);
  }
}

/** Captures and compares a fresh keyed in-memory baseline. No key, path, or image bytes are emitted. */
export async function verifyHostedCatalog(config = runtimeConfig()): Promise<ReturnType<typeof buildCatalogPreservationManifest>> {
  verificationStage = "catalog-before-snapshot";
  const key = randomBytes(32);
  const snapshot = await readHostedCatalog(config);
  const before = buildCatalogPreservationManifest(snapshot, key);
  verificationStage = "catalog-count-and-gompocha-gate";
  assertExpectedManifest(before, snapshot);
  const after = buildCatalogPreservationManifest(await readHostedCatalog(config), key);
  verificationStage = "catalog-baseline-self-comparison";
  assertCatalogPreserved(before, after);
  return before;
}

/** Keeps the keyed baseline and its key in this process while a caller performs one bounded operation. */
export async function withHostedCatalogPreservation<T>(operation: () => Promise<T>, config = runtimeConfig()): Promise<{ result: T; manifest: ReturnType<typeof buildCatalogPreservationManifest> }> {
  failedStage = "none";
  reconciliationStage = "not-run";
  applyCliInvoked = false;
  postCatalogMatch = "not-run";
  latestAppliedVersion = "unknown";
  failureCategory = "unknown";
  verificationStage = "catalog-before-snapshot";
  const key = randomBytes(32);
  const snapshot = await readHostedCatalog(config);
  const before = buildCatalogPreservationManifest(snapshot, key);
  verificationStage = "catalog-count-and-gompocha-gate";
  assertExpectedManifest(before, snapshot);
  let result: T | undefined;
  let operationError: unknown;
  verificationStage = "bounded-operation";
  try { result = await operation(); } catch (error) { operationError = error; if (failedStage === "none") failedStage = verificationStage; }
  verificationStage = "catalog-after-snapshot";
  const after = buildCatalogPreservationManifest(await readHostedCatalog(config), key);
  verificationStage = "catalog-before-after-comparison";
  reconciliationStage = "post-operation-catalog-byte-comparison";
  postCatalogMatch = "failed";
  assertCatalogPreserved(before, after);
  postCatalogMatch = "matched";
  if (operationError) reconciliationStage = "post-operation-catalog-byte-match";
  if (operationError) throw operationError;
  return { result: result as T, manifest: before };
}

async function main(argv: string[]): Promise<void> {
  verificationStage = "runtime-configuration";
  const config = runtimeConfig();
  if (argv.includes("--baseline")) {
    verificationStage = "standalone-catalog-baseline";
    const manifest = await verifyHostedCatalog(config);
    const summary = (set: { count: number; setHmac: string }) => ({ count: set.count, setHmac: set.setHmac });
    process.stdout.write(`${JSON.stringify({ counts: manifest.counts, catalogRows: manifest.catalogRows,
      menuPhotoPaths: summary(manifest.menuPhotoPaths), menuPhotoBytes: summary(manifest.menuPhotoBytes),
      menuPhotoObjects: summary(manifest.menuPhotoObjects), gompocha: {
        menuPhotoPaths: summary(manifest.gompocha.menuPhotoPaths), menuPhotoBytes: summary(manifest.gompocha.menuPhotoBytes),
        menuPhotoObjects: summary(manifest.gompocha.menuPhotoObjects),
      } }, null, 2)}\n`);
    return;
  }
  if (argv.includes("--apply-reviewed-migrations")) {
    verificationStage = "same-process-catalog-baseline-and-tracked-apply";
    const { manifest } = await withHostedCatalogPreservation(() => applyTrackedMigrations(config), config);
    process.stdout.write(`${JSON.stringify({ outcome: "four tracked migrations applied and verified", counts: manifest.counts, migrationVersions: EXPECTED_MIGRATIONS }, null, 2)}\n`);
    return;
  }
  if (argv.includes("--dry-run-only")) {
    verificationStage = "standalone-cli-dry-run";
    if (!process.env.PGPASSWORD || !process.env.SUPABASE_DB_PASSWORD) throw new Error("Password must be injected into the process environment.");
    const env = { ...process.env, PGSSLROOTCERT: config.caPath, PGOPTIONS: "-c statement_timeout=30000" };
    const dbUrl = `postgresql://${encodeURIComponent(config.databaseUser)}@${config.databaseHost}:5432/postgres?sslmode=verify-full`;
    const migrations = migrationList(cli(env, buildDryRunArgs(dbUrl)));
    process.stdout.write(`${JSON.stringify({ pendingMigrationCount: migrations.length, pendingMigrations: migrations }, null, 2)}\n`);
    return;
  }
  if (argv.includes("--status")) {
    verificationStage = "read-only-status";
    const [versions, snapshot] = await Promise.all([currentMigrationHistory(config), readHostedCatalog(config)]);
    const manifest = buildCatalogPreservationManifest(snapshot, randomBytes(32));
    process.stdout.write(`${JSON.stringify({ migrationCount: versions.length, latestMigration: versions.at(-1) ?? null, counts: manifest.counts }, null, 2)}\n`);
    return;
  }
  if (argv.includes("--diagnose-apply-preconditions")) {
    verificationStage = "read-only-migration-precondition-diagnosis";
    process.stdout.write(`${JSON.stringify(await diagnoseMigrationPreconditions(config), null, 2)}\n`);
    return;
  }
  if (argv.includes("--release-preflight")) {
    verificationStage = "read-only-g10-release-preflight";
    await verifyHostedReleasePreconditions(config);
    const [manifest, auth, deploymentCommit] = await Promise.all([
      verifyHostedCatalog(config), readHostedAuthConfiguration(config), readVercelProductionCommit(),
    ]);
    const summary = {
      database: "migration history, PG17 roles/grants, and inactive freeze PASS",
      catalog: manifest.counts,
      auth: safeAuthPolicy(auth),
      vercelProductionCommit: deploymentCommit,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (argv.includes("--push-and-verify-release")) {
    verificationStage = "same-process-preservation-push-deploy-and-post-compare";
    const result = await pushAndWaitForHostedRelease(config);
    process.stdout.write(`${JSON.stringify({ outcome: "DEPLOY_GATE_PASS", ...result }, null, 2)}\n`);
    return;
  }
  if (argv.includes("--update-auth-release-settings")) {
    verificationStage = "production-auth-release-settings-update-and-verification";
    const result = await updateHostedAuthReleaseSettings(config);
    process.stdout.write(`${JSON.stringify({ outcome: "AUTH_SETTINGS_PASS", auth: result }, null, 2)}\n`);
    return;
  }
  throw new Error("Use --baseline, --status, --release-preflight (diagnostic only), --push-and-verify-release, --update-auth-release-settings, or --apply-reviewed-migrations.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    if (failedStage === "none") failedStage = verificationStage;
    const safeError = error instanceof Error && /migration list/i.test(error.message) ? "migration list rejected"
      : error instanceof Error && /preservation verification failed/i.test(error.message) ? "catalog before/after mismatch"
      : error instanceof Error && /count gate/i.test(error.message) ? "catalog count or Gompocha gate rejected"
      : error instanceof Error && /Hosted catalog preflight failed during connect/i.test(error.message) ? "database connection preflight failed"
      : error instanceof Error && /Hosted catalog preflight failed during catalog-query/i.test(error.message) ? "catalog query or exact Storage path-set check failed"
      : error instanceof Error && /Hosted catalog preflight failed during storage-byte-read/i.test(error.message) ? "Storage byte read failed"
      : error instanceof Error && /Official Supabase CLI operation failed/i.test(error.message) ? "CLI command failed"
      : error instanceof Error && /Tracked Supabase apply failed/i.test(error.message) ? "CLI apply failed"
      : "unclassified safe failure";
    process.stderr.write(`Hosted release checkpoint: failureStage=${failedStage}; reconciliationStage=${reconciliationStage}; cliApplyInvoked=${applyCliInvoked}; latestMigration=${latestAppliedVersion}; postCatalog=${postCatalogMatch}; safeCliCause=${failureCategory}; safeError=${safeError}.\n`);
    process.exitCode = 1;
  });
}
