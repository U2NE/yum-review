import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

export const EXACT_RUN_ID = "yum-overhaul-20260928";
export const APPROVED_SPEC_HASH = "c1de6d7dcf8e998d6bd3659315aa5bec65871402f54695f8ee4343b0c24a428b";
export const APPROVED_PLAN_HASH = "2ff118cf5b9785c358ece636d7ceeed0a982de163a3e49d7b90178244990e761";
export const AUTHORIZATION_SIGNAL = "YUM_PURGE_FREEZE_OPERATOR_AUTH";
export const EXPECTED_AUTHORIZATION = "run=" + EXACT_RUN_ID + ";spec=" + APPROVED_SPEC_HASH + ";plan=" + APPROVED_PLAN_HASH;
const OPERATIONAL_MODES = new Set(["--preflight", "--freeze", "--verify", "--release"]);

export type OperationMode = "--preflight" | "--freeze" | "--verify" | "--release";
export type OperationCheck = { mode: OperationMode; runId?: string } | { usageError: string };

export function parseOperation(args: string[]): OperationCheck {
  if (args.length === 0 || !OPERATIONAL_MODES.has(args[0])) {
    return { usageError: "Choose one supported operational mode: --preflight, --freeze, --verify, or --release." };
  }
  const mode = args[0] as OperationMode;
  let runId: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--run-id") {
      if (runId !== undefined || index + 1 >= args.length || args[index + 1].startsWith("--")) {
        return { usageError: "Supply exactly one --run-id value." };
      }
      runId = args[index + 1];
      index += 1;
    } else if (argument.startsWith("--run-id=")) {
      if (runId !== undefined) return { usageError: "Supply exactly one --run-id value." };
      runId = argument.slice("--run-id=".length);
    } else {
      return { usageError: "Unsupported operational arguments; no target action was attempted." };
    }
  }
  if (runId !== EXACT_RUN_ID) return { usageError: "An explicit --run-id " + EXACT_RUN_ID + " is required." };
  return { mode, runId };
}

export function hasExactAuthorization(environment: NodeJS.ProcessEnv): boolean {
  return environment[AUTHORIZATION_SIGNAL] === EXPECTED_AUTHORIZATION;
}

type VolumeConfig = { id: string; configuredRoot: string; root: string };
type VolumeScan = {
  id: string;
  root: string;
  reviewDigests: string[];
  temporaryDigests: string[];
  menuDigests: string[];
  reviewCount: number;
  temporaryCount: number;
  menuCount: number;
};
type TargetClients = { supabase: Client | null; legacy: Client | null };
type TargetStatus = {
  migrationReady: boolean;
  supabase: Record<string, unknown> | null;
  legacy: Record<string, unknown> | null;
  supabaseTargetJournals: Record<string, unknown>[];
  legacyTargetJournals: Record<string, unknown>[];
  volumes: Record<string, unknown>[];
  databaseBlockers: string[];
};
type RemoteControls = {
  authConfig: Record<string, unknown> | null;
  reviewBucketPresent: boolean;
  blockers: string[];
};
type Context = {
  clients: TargetClients;
  status: TargetStatus;
  remote: RemoteControls;
  volumeConfigs: VolumeConfig[];
  scans: VolumeScan[];
  volumeDigest: string | null;
  blockers: string[];
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string | null {
  const value = environment[name];
  return value && value.trim() ? value : null;
}

export function parseVolumeMap(raw: string | undefined): Array<{ id: string; root: string }> {
  if (!raw) throw new Error("YUM_REVIEW_MEDIA_VOLUME_MAP_JSON is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("YUM_REVIEW_MEDIA_VOLUME_MAP_JSON must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The media volume map must be a non-empty object of stable IDs to absolute roots.");
  }
  const values = Object.entries(parsed as Record<string, unknown>);
  if (values.length === 0) throw new Error("The media volume map must enumerate at least one volume.");
  const seenRoots = new Set<string>();
  return values.map(([id, value]) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || typeof value !== "string"
        || !isAbsolute(value) || normalize(value) !== value || value.split(/[\\/]/).includes("..")) {
      throw new Error("The media volume map contains an invalid stable ID or unsafe root.");
    }
    const normalizedRoot = process.platform === "win32" ? value.toLowerCase() : value;
    if (seenRoots.has(normalizedRoot)) throw new Error("The media volume map repeats a root.");
    seenRoots.add(normalizedRoot);
    return { id, root: value };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function rejectSymlinkPath(root: string): Promise<void> {
  let current = parse(root).root;
  const components = root.slice(current.length).split(/[\\/]+/).filter(Boolean);
  for (const component of components) {
    current = join(current, component);
    const details = await lstat(current);
    if (details.isSymbolicLink()) throw new Error("A media volume path contains a symbolic link.");
  }
}

async function rawItemDigest(path: string): Promise<string> {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("A media volume contains a non-regular entry.");
  const bytes = await readFile(path);
  return sha256(basename(path) + ":" + bytes.byteLength + ":" + sha256(bytes));
}

export async function scanVolume(id: string, configuredRoot: string): Promise<VolumeScan> {
  await rejectSymlinkPath(configuredRoot);
  const root = await realpath(configuredRoot);
  if (root !== configuredRoot || !isAbsolute(root)) throw new Error("A media volume root is not canonical.");
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("A configured media volume is unreachable.");
  const tmp = join(root, "tmp");
  const tmpInfo = await lstat(tmp);
  if (!tmpInfo.isDirectory() || tmpInfo.isSymbolicLink()) throw new Error("A dedicated media tmp directory is unavailable.");

  const reviewDigests: string[] = [];
  const menuDigests: string[] = [];
  const temporaryDigests: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.name === "tmp") continue;
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("A media root contains an unknown or linked entry.");
    if (/^review-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.webp$/.test(entry.name)) reviewDigests.push(await rawItemDigest(child));
    else if (/^menu-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.webp$/.test(entry.name)) menuDigests.push(await rawItemDigest(child));
    else throw new Error("A media root contains an unknown entry.");
  }
  for (const entry of await readdir(tmp, { withFileTypes: true })) {
    const child = join(tmp, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile() || !/^yum-(?:stage|output)-[A-Za-z0-9_-]{6,64}\.part$/.test(entry.name)) {
      throw new Error("A media tmp directory contains an unknown or linked entry.");
    }
    temporaryDigests.push(await rawItemDigest(child));
  }
  reviewDigests.sort();
  temporaryDigests.sort();
  menuDigests.sort();
  return {
    id, root, reviewDigests, temporaryDigests, menuDigests,
    reviewCount: reviewDigests.length, temporaryCount: temporaryDigests.length, menuCount: menuDigests.length,
  };
}

function inventoryDigest(configs: VolumeConfig[]): string {
  const stableValues = configs.map(item => item.id + "\0" + item.root).sort();
  return sha256(stableValues.join("\n"));
}

async function connectOperatorDatabase(connectionString: string | null): Promise<Client | null> {
  if (!connectionString) return null;
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, application_name: "yum-purge-freeze-operator" });
  try {
    await client.connect();
    const identity = await client.query("SELECT session_user AS role_name, current_setting('transaction_read_only') AS read_only");
    if (identity.rows[0]?.role_name !== "postgres" || identity.rows[0]?.read_only !== "off") {
      await client.end();
      return null;
    }
    return client;
  } catch {
    try { await client.end(); } catch { /* connection cleanup is best effort */ }
    return null;
  }
}

async function readMigrationStatus(client: Client, supabase: boolean): Promise<boolean> {
  if (supabase) {
    const exists = await client.query("SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present");
    if (!exists.rows[0]?.present) return false;
    const result = await client.query(
      "SELECT count(DISTINCT version)::integer AS applied FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])",
      [["20260928115000", "20260928120000"]],
    );
    return Number(result.rows[0]?.applied) === 2;
  }
  const exists = await client.query("SELECT pg_catalog.to_regclass('public.flyway_schema_history') IS NOT NULL AS present");
  if (!exists.rows[0]?.present) return false;
  const result = await client.query(
    "SELECT EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version = '8' AND success) AS applied",
  );
  return result.rows[0]?.applied === true;
}

async function readSupabaseStatus(client: Client): Promise<Record<string, unknown>> {
  const result = await client.query(
    "SELECT f.active_run_id, active_run.state, exact_run.state AS exact_run_state, "
      + "COALESCE(active_run.storage_context_verified, false) AS storage_context_verified, "
      + "COALESCE(active_run.tus_quiescence_verified, false) AS tus_quiescence_verified "
      + "FROM private.personal_data_write_freeze f "
      + "LEFT JOIN private.personal_data_purge_runs active_run ON active_run.run_id = f.active_run_id "
      + "LEFT JOIN private.personal_data_purge_runs exact_run ON exact_run.run_id = $1 "
      + "WHERE f.singleton",
    [EXACT_RUN_ID],
  );
  if (!result.rows[0]) throw new Error("Supabase freeze status is unavailable.");
  return result.rows[0];
}

async function readLegacyStatus(client: Client): Promise<Record<string, unknown>> {
  const result = await client.query(
    "SELECT f.active_run_id, active_run.state, exact_run.state AS exact_run_state, "
      + "COALESCE(active_run.media_inventory_verified, false) AS media_inventory_verified, "
      + "active_run.media_inventory_digest "
      + "FROM private.personal_data_write_freeze f "
      + "LEFT JOIN private.personal_data_purge_runs active_run ON active_run.run_id = f.active_run_id "
      + "LEFT JOIN private.personal_data_purge_runs exact_run ON exact_run.run_id = $1 "
      + "WHERE f.singleton",
    [EXACT_RUN_ID],
  );
  if (!result.rows[0]) throw new Error("Legacy freeze status is unavailable.");
  return result.rows[0];
}

async function readSupabaseTargetJournals(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    "SELECT target, status, remaining_rows, remaining_objects, retained_menu_path_hmac, retained_menu_bytes_hmac "
      + "FROM private.personal_data_purge_journal WHERE run_id = $1 ORDER BY target",
    [EXACT_RUN_ID],
  );
  return result.rows;
}

async function readLegacyTargetJournals(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    "SELECT target, status, remaining_rows, remaining_objects, retained_menu_path_hmac, retained_menu_bytes_hmac "
      + "FROM private.personal_data_purge_journal WHERE run_id = $1 ORDER BY target",
    [EXACT_RUN_ID],
  );
  return result.rows;
}

async function readVolumes(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    "SELECT v.volume_id, v.start_attested_at, v.committed_at, j.status, j.committed_review_file_count, "
      + "j.committed_temporary_file_count, j.committed_menu_file_count "
      + "FROM private.legacy_personal_data_media_volumes v "
      + "LEFT JOIN private.legacy_review_media_purge_journal j USING (run_id, volume_id) "
      + "WHERE v.run_id = $1 ORDER BY v.volume_id",
    [EXACT_RUN_ID],
  );
  return result.rows;
}

async function readTargetStatus(clients: TargetClients): Promise<TargetStatus> {
  const status: TargetStatus = {
    migrationReady: false, supabase: null, legacy: null,
    supabaseTargetJournals: [], legacyTargetJournals: [], volumes: [], databaseBlockers: [],
  };
  if (!clients.supabase) status.databaseBlockers.push("Supabase operator database connection is unavailable or not postgres.");
  if (!clients.legacy) status.databaseBlockers.push("Legacy operator database connection is unavailable or not postgres.");
  if (clients.supabase) {
    try {
      const migrationsReady = await readMigrationStatus(clients.supabase, true);
      const freeze = await readSupabaseStatus(clients.supabase);
      status.supabase = { ...freeze, migrationsReady };
      if (migrationsReady) {
        status.supabaseTargetJournals = await readSupabaseTargetJournals(clients.supabase);
      }
    } catch {
      status.databaseBlockers.push("Supabase migration or freeze status could not be read.");
    }
  }
  if (clients.legacy) {
    try {
      const migrationsReady = await readMigrationStatus(clients.legacy, false);
      const freeze = await readLegacyStatus(clients.legacy);
      status.legacy = { ...freeze, migrationsReady };
      if (migrationsReady) {
        status.legacyTargetJournals = await readLegacyTargetJournals(clients.legacy);
        status.volumes = await readVolumes(clients.legacy);
      }
    } catch {
      status.databaseBlockers.push("Legacy migration, freeze, journal, or volume status could not be read.");
    }
  }
  status.migrationReady = status.supabase?.migrationsReady === true && status.legacy?.migrationsReady === true;
  return status;
}

async function fetchJson(url: string, headers: Record<string, string>, method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Remote project control check failed.");
  return response.json();
}

async function readRemoteControls(environment: NodeJS.ProcessEnv): Promise<RemoteControls> {
  const blockers: string[] = [];
  const projectRef = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_PROJECT_REF");
  const supabaseUrl = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_URL");
  const managementToken = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_MANAGEMENT_TOKEN");
  const serviceKey = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_SERVICE_KEY");
  if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) blockers.push("A valid Supabase project reference is unavailable.");
  let parsedUrl: URL | null = null;
  try { if (supabaseUrl) parsedUrl = new URL(supabaseUrl); } catch { /* reported below */ }
  if (!parsedUrl || parsedUrl.protocol !== "https:" || !projectRef || parsedUrl.hostname !== projectRef + ".supabase.co") {
    blockers.push("The Supabase URL does not identify the exact configured project.");
  }
  if (!managementToken) blockers.push("Supabase Management API credentials are unavailable.");
  if (!serviceKey) blockers.push("Read-only Supabase Storage API credentials are unavailable.");
  if (blockers.length > 0 || !projectRef || !parsedUrl || !managementToken || !serviceKey) {
    return { authConfig: null, reviewBucketPresent: false, blockers };
  }
  let authConfig: Record<string, unknown> | null = null;
  let reviewBucketPresent = false;
  try {
    const value = await fetchJson(
      "https://api.supabase.com/v1/projects/" + encodeURIComponent(projectRef) + "/config/auth",
      { authorization: "Bearer " + managementToken },
    );
    if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).disable_signup !== "boolean") {
      throw new Error("invalid auth config");
    }
    authConfig = value as Record<string, unknown>;
  } catch {
    blockers.push("Supabase Auth configuration could not be read from the Management API.");
  }
  try {
    const value = await fetchJson(
      parsedUrl.toString().replace(/\/$/, "") + "/storage/v1/bucket",
      { apikey: serviceKey, authorization: "Bearer " + serviceKey },
    );
    reviewBucketPresent = Array.isArray(value) && value.some(bucket =>
      !!bucket && typeof bucket === "object" && (bucket as Record<string, unknown>).id === "yum-review-media");
    if (!reviewBucketPresent) blockers.push("The fixed yum-review-media Storage bucket is not present.");
  } catch {
    blockers.push("Supabase Storage bucket inventory could not be read.");
  }
  return { authConfig, reviewBucketPresent, blockers };
}

async function loadVolumeConfigs(environment: NodeJS.ProcessEnv): Promise<VolumeConfig[]> {
  const parsed = parseVolumeMap(environment.YUM_REVIEW_MEDIA_VOLUME_MAP_JSON);
  const configs: VolumeConfig[] = [];
  const canonicalRoots = new Set<string>();
  for (const entry of parsed) {
    const root = await realpath(entry.root);
    if (root !== entry.root) throw new Error("A configured media root must be canonical and directly addressable.");
    if (canonicalRoots.has(root)) throw new Error("Two stable media volume IDs resolve to the same root.");
    canonicalRoots.add(root);
    configs.push({ id: entry.id, configuredRoot: entry.root, root });
  }
  return configs;
}

async function createContext(environment: NodeJS.ProcessEnv): Promise<Context> {
  const blockers: string[] = [];
  const supabaseDsn = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_DATABASE_URL");
  const legacyDsn = requiredEnvironment(environment, "YUM_PURGE_LEGACY_DATABASE_URL");
  const clients = {
    supabase: await connectOperatorDatabase(supabaseDsn),
    legacy: await connectOperatorDatabase(legacyDsn),
  };
  const status = await readTargetStatus(clients);
  blockers.push(...status.databaseBlockers);
  if (clients.supabase && clients.legacy && !status.migrationReady) {
    blockers.push("Both approved purge migrations must be recorded as successfully applied.");
  }
  const remote = await readRemoteControls(environment);
  blockers.push(...remote.blockers);
  let volumeConfigs: VolumeConfig[] = [];
  let scans: VolumeScan[] = [];
  let volumeDigest: string | null = null;
  try {
    volumeConfigs = await loadVolumeConfigs(environment);
    scans = await Promise.all(volumeConfigs.map(item => scanVolume(item.id, item.root)));
    volumeDigest = inventoryDigest(volumeConfigs);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Media volume inventory could not be verified.");
  }
  return { clients, status, remote, volumeConfigs, scans, volumeDigest, blockers };
}

async function closeContext(context: Context): Promise<void> {
  await Promise.all([context.clients.supabase, context.clients.legacy].filter((item): item is Client => !!item)
    .map(async client => { try { await client.end(); } catch { /* connection cleanup is best effort */ } }));
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function volumeStatusMatches(context: Context): boolean {
  if (context.status.volumes.length !== context.volumeConfigs.length) return false;
  const ids = context.status.volumes.map(item => String(item.volume_id)).sort();
  return sameSet(ids, context.volumeConfigs.map(item => item.id).sort());
}

function commonReadinessBlockers(context: Context): string[] {
  const blockers = [...context.blockers];
  if (!hasExactAuthorization(process.env)) blockers.push("Exact run, SPEC, and PLAN operator authorization is missing or mismatched.");
  if (context.volumeConfigs.length === 0 || !context.volumeDigest) blockers.push("The fixed media volume set is unavailable.");
  return blockers;
}

function releaseReadinessBlockers(context: Context): string[] {
  const blockers = commonReadinessBlockers(context);
  const supabase = context.status.supabase;
  const legacy = context.status.legacy;
  if (supabase?.active_run_id !== EXACT_RUN_ID || legacy?.active_run_id !== EXACT_RUN_ID) {
    blockers.push("Both database write freezes must be active for the exact run.");
  }
  if (supabase?.state !== "COMPLETE" || legacy?.state !== "COMPLETE") {
    blockers.push("Both exact-run purge journals must be COMPLETE.");
  }
  if (supabase?.storage_context_verified !== true) blockers.push("The independent Storage principal proof is missing.");
  if (supabase?.tus_quiescence_verified !== true) blockers.push("The independent TUS quiescence proof is missing.");
  if (context.remote.authConfig?.disable_signup !== true) blockers.push("Signup must remain disabled until the final release step.");
  if (context.status.supabaseTargetJournals.length !== 4
      || context.status.supabaseTargetJournals.some(row => row.status !== "COMMITTED"
        || row.remaining_rows !== "0" && row.remaining_rows !== 0
        || row.remaining_objects !== "0" && row.remaining_objects !== 0
        || !/^[0-9a-f]{64}$/.test(String(row.retained_menu_path_hmac))
        || !/^[0-9a-f]{64}$/.test(String(row.retained_menu_bytes_hmac)))) {
    blockers.push("All four Supabase purge targets must have committed zero-remaining evidence.");
  }
  const legacyTargets = context.status.legacyTargetJournals.filter(row =>
    row.target === "legacy-review-media" || row.target === "legacy-db");
  if (legacyTargets.length !== 2 || legacyTargets.some(row => row.status !== "COMMITTED"
      || row.remaining_rows !== "0" && row.remaining_rows !== 0
      || row.remaining_objects !== "0" && row.remaining_objects !== 0
      || !/^[0-9a-f]{64}$/.test(String(row.retained_menu_path_hmac))
      || !/^[0-9a-f]{64}$/.test(String(row.retained_menu_bytes_hmac)))) {
    blockers.push("Both legacy purge targets must have committed zero-remaining evidence.");
  }
  if (!retainedMenuCheckpointAgreement(context)) {
    blockers.push("Retained MENU path/byte HMACs must agree across every committed target.");
  }
  if (!volumeStatusMatches(context)
      || context.status.volumes.some(row => !row.start_attested_at
        || (row.status !== "STARTED" && row.status !== "COMMITTED"))) {
    blockers.push("Every fixed media volume needs a trusted STARTED checkpoint.");
  }
  if (context.status.legacy?.media_inventory_verified !== true
      || context.status.legacy?.media_inventory_digest !== context.volumeDigest) {
    blockers.push("The immutable legacy volume map does not match the trusted operator attestation.");
  }
  if (context.scans.some(item => item.reviewCount !== 0 || item.temporaryCount !== 0)) {
    blockers.push("Every media volume must rescan with zero review and temporary files.");
  }
  return [...new Set(blockers)];
}

function verifyReadOnlyBlockers(context: Context): string[] {
  const blockers = commonReadinessBlockers(context);
  const supabase = context.status.supabase;
  const legacy = context.status.legacy;
  if (supabase?.active_run_id !== EXACT_RUN_ID || legacy?.active_run_id !== EXACT_RUN_ID) {
    blockers.push("Both database write freezes are not active for the exact run.");
  }
  if (context.remote.authConfig?.disable_signup !== true) blockers.push("Auth signup is not confirmed disabled.");
  if (supabase?.storage_context_verified !== true) blockers.push("The independent Storage principal proof is absent.");
  if (supabase?.tus_quiescence_verified !== true) blockers.push("TUS quiescence remains unattested.");
  if (!volumeStatusMatches(context)
      || context.status.legacy?.media_inventory_verified !== true
      || context.status.legacy?.media_inventory_digest !== context.volumeDigest) {
    blockers.push("The registered fixed media volume set does not match the operator inventory.");
  }
  if (context.status.supabaseTargetJournals.length !== 4
      || context.status.supabaseTargetJournals.some(row => row.status !== "COMMITTED")) {
    blockers.push("The four Supabase target checkpoints are not all committed.");
  }
  if (context.status.legacyTargetJournals.filter(row =>
      (row.target === "legacy-review-media" || row.target === "legacy-db") && row.status === "COMMITTED").length !== 2) {
    blockers.push("The two legacy target checkpoints are not both committed.");
  }
  if (context.status.volumes.some(row => row.status !== "COMMITTED" || !row.start_attested_at || !row.committed_at)) {
    blockers.push("Every enumerated volume must have trusted STARTED and COMMITTED checkpoints.");
  }
  if (context.scans.some(item => item.reviewCount !== 0 || item.temporaryCount !== 0)) {
    blockers.push("Review or temporary files remain on an enumerated media volume.");
  }
  if (supabase?.state !== "COMPLETE" || legacy?.state !== "COMPLETE") {
    blockers.push("Both target databases have not completed their exact-run journals.");
  }
  if (!volumeStatusMatches(context) || context.status.volumes.length === 0) {
    blockers.push("The immutable media volume set is empty or incomplete.");
  }
  return [...new Set(blockers)];
}

function retainedMenuCheckpointAgreement(context: Context): boolean {
  const supabaseRows = context.status.supabaseTargetJournals;
  const legacyRows = context.status.legacyTargetJournals.filter(row =>
    row.target === "legacy-review-media" || row.target === "legacy-db");
  const targets = ["supabase-review-storage", "supabase-db-auth", "legacy-review-media", "legacy-db"];
  if (supabaseRows.length !== targets.length
      || targets.some(target => supabaseRows.filter(row => row.target === target && row.status === "COMMITTED").length !== 1)
      || legacyRows.length !== 2 || legacyRows.some(row => row.status !== "COMMITTED")) return false;
  const rows = [...supabaseRows, ...legacyRows];
  const paths = new Set(rows.map(row => String(row.retained_menu_path_hmac)));
  const bytes = new Set(rows.map(row => String(row.retained_menu_bytes_hmac)));
  return paths.size === 1 && bytes.size === 1
    && /^[0-9a-f]{64}$/.test([...paths][0])
    && /^[0-9a-f]{64}$/.test([...bytes][0]);
}

async function acquireFreezeLocks(context: Context): Promise<void> {
  const supabase = context.clients.supabase;
  const legacy = context.clients.legacy;
  if (!supabase || !legacy) throw new Error("Both postgres operator sessions are required.");
  const first = await supabase.query("SELECT pg_catalog.pg_try_advisory_lock(7123341, 2809) AS locked");
  if (first.rows[0]?.locked !== true) throw new Error("Supabase write transactions are still active; the freeze lock was not acquired.");
  const second = await legacy.query("SELECT pg_catalog.pg_try_advisory_lock(7123341, 2810) AS locked");
  if (second.rows[0]?.locked !== true) {
    await supabase.query("SELECT pg_catalog.pg_advisory_unlock(7123341, 2809)");
    throw new Error("Legacy write transactions are still active; the freeze lock was not acquired.");
  }
}

async function releaseFreezeLocks(context: Context): Promise<void> {
  if (context.clients.legacy) {
    try { await context.clients.legacy.query("SELECT pg_catalog.pg_advisory_unlock(7123341, 2810)"); } catch { /* session close releases it */ }
  }
  if (context.clients.supabase) {
    try { await context.clients.supabase.query("SELECT pg_catalog.pg_advisory_unlock(7123341, 2809)"); } catch { /* session close releases it */ }
  }
}

function activeExact(status: Record<string, unknown> | null): boolean {
  return status?.active_run_id === EXACT_RUN_ID;
}

async function attestMediaVolumes(context: Context): Promise<void> {
  const client = context.clients.legacy;
  if (!client || !context.volumeDigest || context.volumeConfigs.length === 0) throw new Error("The trusted fixed media volume map is unavailable.");
  const legacy = context.status.legacy;
  if (!legacy || legacy.active_run_id !== EXACT_RUN_ID || legacy.state !== "FROZEN") {
    throw new Error("The exact legacy freeze must be active and still FROZEN before volume attestation.");
  }
  if (legacy.media_inventory_verified === true) {
    if (legacy.media_inventory_digest !== context.volumeDigest || !volumeStatusMatches(context)) {
      throw new Error("The operator media map differs from the immutable registered volume set.");
    }
  } else {
    if (context.status.volumes.length !== 0) throw new Error("An unverified volume map already has checkpoints; reconcile it manually.");
    await client.query("SELECT private.attest_legacy_personal_data_media_inventory($1, $2::text[], $3)",
      [EXACT_RUN_ID, context.volumeConfigs.map(item => item.id), context.volumeDigest]);
  }

  const latestVolumes = await readVolumes(client);
  const rowById = new Map(latestVolumes.map(item => [String(item.volume_id), item]));
  for (const scan of context.scans) {
    const row = rowById.get(scan.id);
    if (!row || !row.status || row.start_attested_at) continue;
    if (row.status !== "STARTED") throw new Error("An untrusted media volume checkpoint is not STARTED.");
    await client.query(
      "SELECT private.attest_legacy_review_media_purge_start($1, $2, $3::text[], $4::text[], $5::text[])",
      [EXACT_RUN_ID, scan.id, scan.reviewDigests, scan.temporaryDigests, scan.menuDigests],
    );
  }
}

async function patchSignup(environment: NodeJS.ProcessEnv, disableSignup: boolean): Promise<void> {
  const projectRef = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_PROJECT_REF");
  const token = requiredEnvironment(environment, "YUM_PURGE_SUPABASE_MANAGEMENT_TOKEN");
  if (!projectRef || !token) throw new Error("Supabase Management API operator credentials are unavailable.");
  await fetchJson(
    "https://api.supabase.com/v1/projects/" + encodeURIComponent(projectRef) + "/config/auth",
    { authorization: "Bearer " + token },
    "PATCH",
    { disable_signup: disableSignup },
  );
}

async function freezeMode(context: Context, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const blockers = [...context.blockers];
  if (!hasExactAuthorization(environment)) blockers.push("Exact run, SPEC, and PLAN operator authorization is missing or mismatched.");
  if (!context.status.migrationReady) blockers.push("Both approved database migrations are not recorded as applied.");
  if (!context.volumeDigest || context.volumeConfigs.length === 0) blockers.push("The fixed media volume set is not available.");
  if (context.remote.authConfig === null) blockers.push("The Auth Management API could not be checked before freeze activation.");
  if (!context.remote.reviewBucketPresent) blockers.push("The exact project Storage bucket is unavailable.");
  if (blockers.length) return [...new Set(blockers)];

  const supabase = context.status.supabase;
  const legacy = context.status.legacy;
  const bothInactive = !supabase?.active_run_id && !legacy?.active_run_id
    && !supabase?.exact_run_state && !legacy?.exact_run_state;
  const bothActiveExact = activeExact(supabase ?? null) && activeExact(legacy ?? null)
    && supabase?.state === "FROZEN" && legacy?.state === "FROZEN";
  if (!bothInactive && !bothActiveExact) {
    return ["Database freeze states differ or a prior exact-run checkpoint exists; preserve the reached freeze and reconcile before continuing."];
  }

  await acquireFreezeLocks(context);
  try {
    const supabaseClient = context.clients.supabase;
    const legacyClient = context.clients.legacy;
    if (!supabaseClient || !legacyClient) return ["Both postgres operator sessions are required."];
    if (bothInactive) {
      await supabaseClient.query("SELECT private.activate_personal_data_write_freeze($1)", [EXACT_RUN_ID]);
      await legacyClient.query("SELECT private.activate_legacy_personal_data_write_freeze($1)", [EXACT_RUN_ID]);
    }
    context.scans = await Promise.all(context.volumeConfigs.map(item => scanVolume(item.id, item.root)));
    context.status.supabase = await readSupabaseStatus(supabaseClient);
    context.status.legacy = await readLegacyStatus(legacyClient);
    context.status.volumes = await readVolumes(legacyClient);
    await attestMediaVolumes(context);
    if (context.remote.authConfig?.disable_signup !== true) await patchSignup(environment, true);
    context.remote.authConfig = { ...(context.remote.authConfig ?? {}), disable_signup: true };
    return [];
  } catch {
    context.status = await readTargetStatus(context.clients);
    return ["A target freeze or independent media-volume attestation did not complete; keep any reached target frozen and reconcile from its durable status."];
  } finally {
    await releaseFreezeLocks(context);
  }
}

async function hmacArrays(client: Client, scan: VolumeScan): Promise<{ review: string[]; temporary: string[]; menu: string[] }> {
  const result = await client.query(
    "SELECT review_hmacs, temporary_hmacs, menu_hmacs "
      + "FROM public.legacy_personal_data_media_item_hmacs($1, $2::text[], $3::text[], $4::text[])",
    [EXACT_RUN_ID, scan.reviewDigests, scan.temporaryDigests, scan.menuDigests],
  );
  const row = result.rows[0];
  if (!row) throw new Error("A media volume rescan could not be keyed by the exact-run database secret.");
  return { review: row.review_hmacs, temporary: row.temporary_hmacs, menu: row.menu_hmacs };
}

async function assertCatalogPreserved(client: Client): Promise<boolean> {
  const result = await client.query("SELECT preserved FROM private.verify_personal_data_catalog_preserved($1)", [EXACT_RUN_ID]);
  return result.rows[0]?.preserved === true;
}

async function verifyMode(context: Context): Promise<string[]> {
  const blockers = verifyReadOnlyBlockers(context);
  const legacy = context.clients.legacy;
  const supabase = context.clients.supabase;
  if (context.status.migrationReady && supabase) {
    try {
      if (!await assertCatalogPreserved(supabase)) blockers.push("Supabase restaurant, menu, or retained MENU media preservation verification failed.");
    } catch {
      blockers.push("Supabase catalog preservation verification could not be read.");
    }
  }
  if (context.status.migrationReady && legacy) {
    try {
      if (!retainedMenuCheckpointAgreement(context)) blockers.push("Retained MENU path/byte checkpoint HMACs do not agree across all fixed purge targets.");
      const registered = new Set(context.status.volumes.map(item => String(item.volume_id)));
      for (const scan of context.scans.filter(item => registered.has(item.id))) {
        const current = await hmacArrays(legacy, scan);
        const started = await legacy.query(
          "SELECT started_menu_hmacs FROM private.legacy_review_media_purge_journal WHERE run_id=$1 AND volume_id=$2",
          [EXACT_RUN_ID, scan.id],
        );
        if (!started.rows[0] || JSON.stringify(current.menu) !== JSON.stringify(started.rows[0].started_menu_hmacs)) {
          blockers.push("A retained MENU file set differs from its trusted per-volume checkpoint.");
        }
      }
    } catch {
      blockers.push("Independent per-volume or retained MENU checkpoint verification could not be read.");
    }
  }
  return [...new Set(blockers)];
}

async function releaseMode(context: Context, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const blockers = releaseReadinessBlockers(context);
  if (blockers.length) return blockers;
  const supabase = context.clients.supabase;
  const legacy = context.clients.legacy;
  if (!supabase || !legacy) return ["Both postgres operator sessions are required."];
  await acquireFreezeLocks(context);
  try {
    const freshSupabase = await readSupabaseStatus(supabase);
    const freshLegacy = await readLegacyStatus(legacy);
    if (freshSupabase.active_run_id !== EXACT_RUN_ID || freshLegacy.active_run_id !== EXACT_RUN_ID
        || freshSupabase.state !== "COMPLETE" || freshLegacy.state !== "COMPLETE"
        || freshSupabase.storage_context_verified !== true || freshSupabase.tus_quiescence_verified !== true) {
      return ["Target state changed after read-only verification; both freezes remain active."];
    }
    const volumes = await readVolumes(legacy);
    const byId = new Map(context.scans.map(item => [item.id, item]));
    if (volumes.length !== byId.size || volumes.some(row => !byId.has(String(row.volume_id)) || !row.start_attested_at)) {
      return ["The immutable volume set changed after verification; both freezes remain active."];
    }
    const releaseScans = await Promise.all(context.volumeConfigs.map(item => scanVolume(item.id, item.root)));
    for (const scan of releaseScans) {
      if (!scan || scan.reviewCount !== 0 || scan.temporaryCount !== 0) {
        return ["A media volume no longer has a zero review/temp rescan; both freezes remain active."];
      }
      const current = await hmacArrays(legacy, scan);
      const result = await legacy.query(
        "SELECT status FROM public.commit_legacy_review_media_purge($1, $2, $3::text[], $4::text[], $5::text[])",
        [EXACT_RUN_ID, scan.id, scan.reviewDigests, scan.temporaryDigests, scan.menuDigests],
      );
      if (result.rows[0]?.status !== "COMMITTED" || current.review.length || current.temporary.length) {
        return ["A trusted per-volume COMMITTED rescan did not succeed; both freezes remain active."];
      }
    }
    if (!await assertCatalogPreserved(supabase) || !retainedMenuCheckpointAgreement(context)) {
      return ["Catalog preservation changed during release checks; both freezes remain active."];
    }
    await supabase.query("SELECT private.release_personal_data_write_freeze($1)", [EXACT_RUN_ID]);
    await legacy.query("SELECT private.release_legacy_personal_data_write_freeze($1)", [EXACT_RUN_ID]);
    await patchSignup(environment, false);
    const auth = await readRemoteControls(environment);
    if (auth.authConfig?.disable_signup !== false) {
      return ["Database freezes were released, but signup reopening could not be confirmed; reconcile before declaring completion."];
    }
    return [];
  } catch {
    return ["A release prerequisite or final operation failed; do not declare completion and inspect durable exact-run status."];
  } finally {
    await releaseFreezeLocks(context);
  }
}

function report(mode: OperationMode, blockers: string[], context: Context): void {
  const summary = {
    mode: mode.slice(2),
    runId: EXACT_RUN_ID,
    supabaseConnected: context.clients.supabase !== null,
    legacyConnected: context.clients.legacy !== null,
    migrationsApplied: context.status.migrationReady,
    supabaseFreeze: context.status.supabase?.active_run_id ?? null,
    legacyFreeze: context.status.legacy?.active_run_id ?? null,
    storageContextVerified: context.status.supabase?.storage_context_verified === true,
    tusQuiescenceVerified: context.status.supabase?.tus_quiescence_verified === true,
    storageBucketPresent: context.remote.reviewBucketPresent,
    volumeCount: context.volumeConfigs.length,
    blockers,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (blockers.length > 0) process.exitCode = 2;
}

async function loadFixtures() {
  const root = process.cwd();
  const [supabaseSql, legacySql, legacyPurge, mediaConfiguration, locationRoute] = await Promise.all([
    readFile(resolve(root, "supabase/migrations/20260928115000_personal_data_write_freeze.sql"), "utf8"),
    readFile(resolve(root, "backend/src/main/resources/db/migration/V8__personal_data_write_freeze.sql"), "utf8"),
    readFile(resolve(root, "backend/src/main/java/com/yumreview/media/ReviewMediaPurgeService.java"), "utf8"),
    readFile(resolve(root, "backend/src/main/java/com/yumreview/media/MediaConfiguration.java"), "utf8"),
    readFile(resolve(root, "app/api/restaurants/[id]/location/route.ts"), "utf8"),
  ]);
  return { supabaseSql, legacySql, legacyPurge, mediaConfiguration, locationRoute };
}

function selfTest(fixtures: Awaited<ReturnType<typeof loadFixtures>>) {
  const { supabaseSql, legacySql, legacyPurge, mediaConfiguration, locationRoute } = fixtures;
  assert.match(supabaseSql, /VALUES\s*\(true, NULL, NULL\)/i);
  assert.match(supabaseSql, /pg_advisory_xact_lock_shared\(7123341, 2809\)/i);
  assert.match(supabaseSql, /pg_advisory_xact_lock\(7123341, 2809\)/i);
  assert.match(supabaseSql, /CREATE ROLE purge_guard_owner NOLOGIN/i);
  assert.doesNotMatch(supabaseSql, /\bcurrent_user\b/i);
  assert.match(supabaseSql, /attest_personal_data_tus_quiescence[\s\S]*?RETURN false/i);
  assert.match(legacySql, /CREATE TABLE private\.legacy_personal_data_media_volumes[\s\S]*?PRIMARY KEY \(run_id, volume_id\)/i);
  assert.match(legacySql, /legacy_personal_data_media_inventory_all_volumes_attested/i);
  assert.match(legacySql, /session_user <> 'postgres'[\s\S]*?trusted operator may commit/i);
  assert.match(legacySql, /commit_legacy_review_media_purge[\s\S]*?r\.state IN \('FROZEN', 'SNAPSHOTTED', 'PURGING', 'COMPLETE'\)/i);
  assert.match(legacySql, /every enumerated legacy media volume must have trusted STARTED and COMMITTED evidence/i);
  assert.match(legacyPurge, /System\.getenv\("YUM_REVIEW_MEDIA_DIR"\)/);
  assert.match(legacyPurge, /YUM_REVIEW_MEDIA_VOLUME_ID/);
  assert.match(legacyPurge, /startAttested\(\)/);
  assert.match(mediaConfiguration, /sendError\(int status, String message\)/);
  assert.match(mediaConfiguration, /copyBodyToResponse[\s\S]*?target\.sendError/);
  assert.match(locationRoute, /personalWriteFreezeResponse\(\)[\s\S]*?readBoundedJson/);

  assert.equal(hasExactAuthorization({ [AUTHORIZATION_SIGNAL]: EXPECTED_AUTHORIZATION }), true);
  assert.equal(hasExactAuthorization({ [AUTHORIZATION_SIGNAL]: "present" }), false);
  assert.equal(parseOperation(["--verify", "--run-id", EXACT_RUN_ID]).mode, "--verify");
  assert.ok("usageError" in parseOperation(["--release", "--run-id", "other"]));
  assert.ok("usageError" in parseOperation(["--release", "--run-id", EXACT_RUN_ID, "--run-id", EXACT_RUN_ID]));
  console.log("purge/write-freeze self-test passed (adapter and invariant checks only)");
}

export async function runOperation(mode: OperationMode, environment: NodeJS.ProcessEnv): Promise<{ blockers: string[]; context: Context }> {
  const context = await createContext(environment);
  try {
    let blockers: string[];
    if (mode === "--preflight") {
      blockers = commonReadinessBlockers(context);
      if (context.status.supabase?.active_run_id && context.status.supabase.active_run_id !== EXACT_RUN_ID) {
        blockers.push("A different Supabase freeze run is active.");
      }
      if (context.status.legacy?.active_run_id && context.status.legacy.active_run_id !== EXACT_RUN_ID) {
        blockers.push("A different legacy freeze run is active.");
      }
      if (context.status.supabase?.storage_context_verified !== true) blockers.push("Independent Storage principal proof is not yet present.");
      if (context.status.supabase?.tus_quiescence_verified !== true) blockers.push("TUS quiescence remains unattested.");
      return { blockers: [...new Set(blockers)], context };
    }
    if (mode === "--freeze") blockers = await freezeMode(context, environment);
    else if (mode === "--verify") blockers = await verifyMode(context);
    else blockers = await releaseMode(context, environment);
    return { blockers, context };
  } catch {
    return { blockers: ["The guarded operator handler failed closed; target status was not accepted."], context };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtures = await loadFixtures();
  if (args.length === 1 && args[0] === "--self-test") {
    selfTest(fixtures);
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("Use --preflight, --freeze, --verify, or --release with --run-id " + EXACT_RUN_ID + ".\n");
    return;
  }
  const operation = parseOperation(args);
  if ("usageError" in operation) {
    process.stderr.write(operation.usageError + "\n");
    process.exitCode = 2;
    return;
  }
  const result = await runOperation(operation.mode, process.env);
  report(operation.mode, result.blockers, result.context);
  await closeContext(result.context);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => {
    const selfTestFailure = process.argv.includes("--self-test") && error instanceof Error ? ": " + error.message : "";
    process.stderr.write("Purge/write-freeze operator checks failed closed before accepting any target status" + selfTestFailure + ".\n");
    process.exitCode = 1;
  });
}
