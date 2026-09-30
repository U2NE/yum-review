import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { buildCatalogPreservationManifest, assertCatalogPreserved, type CatalogSnapshot } from "./catalog-preservation-manifest.js";

const EXPECTED = { restaurants: 3, menus: 72, menuPhotos: 40 };
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
  return {
    databaseHost: DB_HOST,
    databaseUser: required("SUPABASE_DB_USER"),
    databasePassword: required("PGPASSWORD"),
    supabaseUrl: required("SUPABASE_URL"),
    serviceKey: required("SUPABASE_SERVICE_KEY"),
    caPath: required("SUPABASE_CA_PATH"),
  };
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

/** Removes only the two restaurant columns introduced by the consent migration.
 * They are absent from the pre-migration catalog shape and therefore cannot be
 * part of a before/after preservation comparison across that schema change.
 */
export function normalizeHostedRestaurantRow(row: Record<string, unknown>): Record<string, unknown> {
  const catalogRow = { ...row };
  delete catalogRow.location_consent_version;
  delete catalogRow.location_consent_at;
  return catalogRow;
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
        if (declaredLength > 0 && declaredLength !== bytes.byteLength) throw new Error("A hosted MENU object byte read was incomplete.");
        photos[index] = { restaurantId: item.restaurant_id, menuId: item.menu_id, objectPath: item.object_path, bytes };
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, items.length) }, () => readWorker()));
    return {
      restaurants: restaurantsResult.rows.map(row => normalizeHostedRestaurantRow(row.row)),
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

function assertExpectedManifest(manifest: ReturnType<typeof buildCatalogPreservationManifest>, snapshot: CatalogSnapshot): void {
  if (manifest.counts.restaurants !== EXPECTED.restaurants || manifest.counts.menus !== EXPECTED.menus || manifest.counts.menuPhotos !== EXPECTED.menuPhotos ||
    manifest.counts.gompocha.restaurants < 1 || manifest.counts.gompocha.menus < 1 || manifest.counts.gompocha.menuPhotos < 1) {
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
  throw new Error("Use --baseline or --apply-reviewed-migrations.");
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
