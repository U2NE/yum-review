import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

export const EXPORT_FORMAT = "yum-review.spring-export/v1";
export const TASK07_MEDIA_CONTRACT = "Normal interactive uploads send bytes to the configured yum-review-media Storage bucket and call POST /api/media/verify; that authenticated server path verifies the stored object and invokes public.activate_media_upload(p_media_id uuid, p_proof_payload text, p_proof_signature text) with a one-use proof. The retired one-argument activation RPC does not exist. Legacy bulk media imports use only the separate scripts/migrate/import-media.ts --apply --local-disposable-target workflow against a disposable local Supabase target. That importer validates the mapped uploader and exact menu/review target, checks the Storage object, byte count, and SHA-256 against the import manifest, then performs guarded local activation and exact photo association in its local database transaction. On any mismatch, preserve pending and unlinked media. Do not call the user-facing activation RPC or hand-roll a service-role bypass for bulk import.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type ExportUser = {
  legacyUserId: string;
  targetAuthUserId: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  systemRole: "MEMBER" | "SERVER_ADMIN";
  mustChangePassword: boolean;
  createdAt: string;
};
export type ExportRestaurant = {
  id: string; name: string; description: string | null; address: string | null; region: string | null;
  latitude: string | null; longitude: string | null; createdAt: string;
};
export type ExportMenu = {
  id: string; restaurantId: string; name: string; description: string | null; priceKrw: number | null;
  cuisineCategory: string; active: boolean; photoMediaId: string | null; photoUrl: string | null; createdAt: string;
};
export type ExportOwner = { userId: string; restaurantId: string; createdAt: string };
export type ExportReview = {
  id: string; userId: string; menuId: string; overallScore: string; tasteScore: string; valueScore: string;
  portionScore: string; comment: string | null; nonEventReviewConsent: boolean | null; createdAt: string; updatedAt: string;
};
export type ExportMedia = {
  mediaId: string; targetMediaId: string; storageKey: string; uploadedByUserId: string; contentType: string;
  originalBytes: string; storedBytes: string; sha256Hex: string; provenance: string; rightsBasis: string;
  rightsAttestedAt: string; rightsAttestedByUserId: string; lifecycleStatus: string; createdAt: string;
};
export type ExportReviewPhoto = { reviewId: string; mediaId: string; sortOrder: number; createdAt: string };
export type ImportData = {
  users: ExportUser[]; restaurants: ExportRestaurant[]; menus: ExportMenu[]; restaurantOwners: ExportOwner[];
  reviews: ExportReview[]; mediaAssets: ExportMedia[]; reviewPhotos: ExportReviewPhoto[];
};
export type ImportArtifact = {
  manifest: {
    format: string; createdAt: string; sourceMigrations: string[]; counts: Record<string, number>;
    deferredMedia: { binaryObjectCount: number; staticMenuPhotoCount: number; total: number; staticMenuPhotoPaths: string[] };
    dataSha256: string; emailConfirmationMapping: string; consentNullsPreserved: boolean;
  };
  data: ImportData;
};
export type CliOptions = {
  inputPath: string; databaseUrlEnv: string; supabaseUrlEnv: string; serviceKeyEnv: string;
  apply: boolean; localDisposableTarget: boolean;
};
export type EntityName = "users" | "profiles" | "userRoles" | "restaurants" | "menus" | "restaurantOwners" |
  "menuPhotos" | "reviews" | "mediaAssets" | "legacyMediaIdentity" | "legacyMediaRights" | "reviewPhotos";
export type RowAction = "insert" | "exact_skip" | "deferred" | "conflict";
export type ImportPlan = {
  actions: Record<EntityName, Map<string, RowAction>>;
  authUsersToCreate: ExportUser[];
  conflicts: number;
  deferredMedia: { binaryObjectCount: number; staticMenuPhotoCount: number; unlinkedAssetMetadataCount: number; total: number };
  deferredLinks: { menuPhotoCount: number; reviewPhotoCount: number; total: number };
};

type AuthUserLite = { id: string; email: string | undefined; emailConfirmedAt: string | undefined };
type MediaReference = { kind: "MENU" | "REVIEW"; menuId?: string; reviewId?: string };

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function assertId(value: string, label: string): void {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`Invalid ${label} in private export.`);
}

function validateData(data: ImportData): void {
  const collections: Array<[keyof ImportData, unknown]> = [
    ["users", data.users], ["restaurants", data.restaurants], ["menus", data.menus],
    ["restaurantOwners", data.restaurantOwners], ["reviews", data.reviews],
    ["mediaAssets", data.mediaAssets], ["reviewPhotos", data.reviewPhotos],
  ];
  for (const [name, value] of collections) {
    if (!Array.isArray(value)) throw new Error(`Invalid ${name} collection in private export.`);
  }
  const userIds = new Set(data.users.map((row) => row.legacyUserId));
  const targetUserIds = data.users.map((row) => row.targetAuthUserId);
  const restaurantIds = new Set(data.restaurants.map((row) => row.id));
  const menuIds = new Set(data.menus.map((row) => row.id));
  const mediaIds = new Set(data.mediaAssets.map((row) => row.mediaId));
  const targetMediaIds = data.mediaAssets.map((row) => row.targetMediaId);

  for (const user of data.users) {
    assertId(user.legacyUserId, "legacy identity");
    if (!UUID_RE.test(user.targetAuthUserId) || !requiredString(user.email) || user.emailNormalized !== user.email.toLowerCase() ||
        !requiredString(user.passwordHash) || !["MEMBER", "SERVER_ADMIN"].includes(user.systemRole) || !user.createdAt) {
      throw new Error("Invalid legacy account row in private export.");
    }
  }
  if (!unique(targetUserIds) || !unique([...targetUserIds, ...targetMediaIds])) {
    throw new Error("Duplicate deterministic identity UUID in private export.");
  }
  for (const restaurant of data.restaurants) {
    assertId(restaurant.id, "restaurant ID");
    if (!requiredString(restaurant.name) || !restaurant.createdAt) throw new Error("Invalid restaurant row in private export.");
  }
  for (const menu of data.menus) {
    assertId(menu.id, "menu ID"); assertId(menu.restaurantId, "restaurant ID");
    if (!restaurantIds.has(menu.restaurantId) || !requiredString(menu.name) || !menu.createdAt) throw new Error("Invalid menu row in private export.");
    if (menu.photoUrl !== null && (!menu.photoUrl.startsWith("/menu-images/") || menu.photoUrl.includes("..") || menu.photoUrl.includes("\\"))) {
      throw new Error("Unsupported static menu photo path in private export.");
    }
    if (menu.photoMediaId && !mediaIds.has(menu.photoMediaId)) throw new Error("Menu photo media reference is missing from private export.");
  }
  for (const owner of data.restaurantOwners) {
    assertId(owner.userId, "owner user ID"); assertId(owner.restaurantId, "owner restaurant ID");
    if (!userIds.has(owner.userId) || !restaurantIds.has(owner.restaurantId)) throw new Error("Orphan owner relation in private export.");
  }
  for (const review of data.reviews) {
    assertId(review.id, "review ID"); assertId(review.userId, "review user ID"); assertId(review.menuId, "review menu ID");
    if (!userIds.has(review.userId) || !menuIds.has(review.menuId)) throw new Error("Orphan review relation in private export.");
    for (const score of [review.overallScore, review.tasteScore, review.valueScore, review.portionScore]) {
      const number = Number(score);
      if (!Number.isFinite(number) || number < 0.5 || number > 5 || number * 2 !== Math.trunc(number * 2)) {
        throw new Error("Invalid review score in private export.");
      }
    }
  }
  if (!unique(targetMediaIds)) throw new Error("Duplicate media UUID in private export.");
  for (const media of data.mediaAssets) {
    if (!requiredString(media.mediaId) || !UUID_RE.test(media.targetMediaId) || !userIds.has(media.uploadedByUserId) ||
        !userIds.has(media.rightsAttestedByUserId) || !/^[0-9a-f]{64}$/i.test(media.sha256Hex) ||
        !["image/jpeg", "image/png", "image/webp"].includes(media.contentType) || !media.createdAt || !media.rightsAttestedAt) {
      throw new Error("Invalid media metadata in private export.");
    }
    if (!requiredString(media.storageKey) || !requiredString(media.rightsBasis) ||
        !["OWNER_UPLOAD", "ADMIN_UPLOAD", "USER_UPLOAD", "LICENSED"].includes(media.provenance) ||
        !["ACTIVE", "REVOKED", "DELETE_PENDING"].includes(media.lifecycleStatus)) {
      throw new Error("Unsupported legacy media metadata in private export.");
    }
    const originalBytes = Number(media.originalBytes);
    const storedBytes = Number(media.storedBytes);
    if (!Number.isInteger(originalBytes) || originalBytes < 1 || originalBytes >= 100_000_000 ||
        !Number.isInteger(storedBytes) || storedBytes < 1 || storedBytes >= 100_000_000) {
      throw new Error("Unsupported media size in private export.");
    }
  }
  for (const photo of data.reviewPhotos) {
    assertId(photo.reviewId, "photo review ID");
    if (!data.reviews.some((review) => review.id === photo.reviewId) || !mediaIds.has(photo.mediaId) ||
        !Number.isInteger(photo.sortOrder) || photo.sortOrder < 0) throw new Error("Orphan review photo in private export.");
  }
  const staticPaths = data.menus.flatMap((menu) => menu.photoUrl ? [menu.photoUrl] : []).sort();
  if (!unique(data.users.map((row) => row.legacyUserId)) || !unique(data.restaurants.map((row) => row.id)) ||
      !unique(data.menus.map((row) => row.id)) || !unique(data.reviews.map((row) => row.id)) ||
      !unique(data.mediaAssets.map((row) => row.mediaId)) || !unique(data.reviewPhotos.map((row) => `${row.reviewId}:${row.mediaId}`))) {
    throw new Error("Duplicate primary key in private export.");
  }
  if (staticPaths.some((photoPath) => !photoPath.startsWith("/menu-images/"))) throw new Error("Invalid deferred photo list.");
}

export async function readImportArtifact(inputPath: string, repositoryRoot?: string): Promise<ImportArtifact> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = await realpath(repositoryRoot ?? path.resolve(scriptDir, "../.."));
  const parent = await realpath(path.dirname(inputPath));
  const resolvedPath = path.join(parent, path.basename(inputPath));
  const relative = path.relative(repoRoot, resolvedPath);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Sensitive export input must stay outside the repository.");
  }
  const fileInfo = await lstat(resolvedPath);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error("Input must be a regular private export file.");
  if (fileInfo.size > 2_000_000_000) throw new Error("Private export exceeds the supported size.");
  const text = await readFile(resolvedPath, "utf8");
  let artifact: unknown;
  try { artifact = JSON.parse(text); } catch { throw new Error("Private export is not valid JSON."); }
  if (!isPlainObject(artifact) || !isPlainObject(artifact.manifest) || !isPlainObject(artifact.data)) {
    throw new Error("Private export has an invalid shape.");
  }
  const bundle = artifact as unknown as ImportArtifact;
  if (bundle.manifest.format !== EXPORT_FORMAT || bundle.manifest.emailConfirmationMapping !== "unconfirmed" ||
      bundle.manifest.consentNullsPreserved !== true || bundle.manifest.dataSha256 !== digest(bundle.data)) {
    throw new Error("Private export manifest or integrity digest is invalid.");
  }
  validateData(bundle.data);
  const computedCounts = {
    users: bundle.data.users.length, restaurants: bundle.data.restaurants.length, menus: bundle.data.menus.length,
    restaurantOwners: bundle.data.restaurantOwners.length, reviews: bundle.data.reviews.length,
    mediaAssets: bundle.data.mediaAssets.length, reviewPhotos: bundle.data.reviewPhotos.length,
  };
  for (const [key, count] of Object.entries(computedCounts)) {
    if (bundle.manifest.counts?.[key] !== count) throw new Error("Private export counts do not match its rows.");
  }
  const deferred = bundle.manifest.deferredMedia;
  const staticPaths = bundle.data.menus.flatMap((menu) => menu.photoUrl ? [menu.photoUrl] : []).sort();
  if (!deferred || deferred.binaryObjectCount !== bundle.data.mediaAssets.length || deferred.staticMenuPhotoCount !== staticPaths.length ||
      deferred.total !== deferred.binaryObjectCount + deferred.staticMenuPhotoCount ||
      JSON.stringify(deferred.staticMenuPhotoPaths) !== JSON.stringify(staticPaths)) {
    throw new Error("Deferred media manifest does not match the private export.");
  }
  return bundle;
}

export function parseImportArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  let apply = false;
  let localDisposableTarget = false;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      process.stdout.write("Usage: npm run migrate:import -- --input <private-export> --database-url-env <ENV> --supabase-url-env <ENV> --service-key-env <ENV> [--apply --local-disposable-target]\n");
      process.exit(0);
    }
    if (key === "--apply") { apply = true; continue; }
    if (key === "--local-disposable-target") { localDisposableTarget = true; continue; }
    if (!key?.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Importer arguments are invalid.");
    if (values.has(key)) throw new Error("Duplicate importer option.");
    values.set(key, argv[index + 1]); index += 1;
  }
  const required = ["--input", "--database-url-env", "--supabase-url-env", "--service-key-env"];
  if (required.some((key) => !values.has(key)) || values.size !== required.length) throw new Error("Importer requires an explicit input path and named local target variables.");
  for (const key of ["--database-url-env", "--supabase-url-env", "--service-key-env"]) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(values.get(key)!)) throw new Error("Target options must name environment variables.");
  }
  if (apply && !localDisposableTarget) throw new Error("Apply mode requires --local-disposable-target.");
  if (!apply && localDisposableTarget) throw new Error("--local-disposable-target is valid only with --apply.");
  return {
    inputPath: path.resolve(values.get("--input")!), databaseUrlEnv: values.get("--database-url-env")!,
    supabaseUrlEnv: values.get("--supabase-url-env")!, serviceKeyEnv: values.get("--service-key-env")!,
    apply, localDisposableTarget,
  };
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`The explicitly named target variable ${name} is not set.`);
  return value;
}

export function assertLocalUrl(value: string, kind: "postgres" | "supabase"): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`The named ${kind} target variable is invalid.`); }
  const expectedProtocol = kind === "postgres" ? /^postgres(?:ql)?:$/ : /^https?:$/;
  if (!expectedProtocol.test(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.search || parsed.hash) {
    throw new Error("Only explicit loopback local/disposable targets are supported; hosted targets are disabled.");
  }
  if (kind === "postgres" && (parsed.username !== "postgres" || !parsed.password || parsed.port !== "54322" || parsed.pathname !== "/postgres")) {
    throw new Error("Only the configured local Supabase database port is supported.");
  }
  if (kind === "supabase" && ((parsed.username || parsed.password) || parsed.port !== "54321")) {
    throw new Error("Only the configured local Supabase API port is supported.");
  }
  return parsed;
}

export function createLocalAdminClient(url: string, serviceKey: string): SupabaseClient {
  assertLocalUrl(url, "supabase");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

export async function listLocalAuthUsers(admin: SupabaseClient): Promise<AuthUserLite[]> {
  const users: AuthUserLite[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Local Auth preflight failed; response details were withheld.");
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email, emailConfirmedAt: user.email_confirmed_at })));
    if (data.users.length < 1000) break;
  }
  return users;
}

function emptyActions(): Record<EntityName, Map<string, RowAction>> {
  return {
    users: new Map(), profiles: new Map(), userRoles: new Map(), restaurants: new Map(), menus: new Map(),
    restaurantOwners: new Map(), menuPhotos: new Map(), reviews: new Map(), mediaAssets: new Map(), legacyMediaIdentity: new Map(),
    legacyMediaRights: new Map(), reviewPhotos: new Map(),
  };
}

async function classify(client: Client, entity: EntityName, key: string, sql: string,
  values: Array<string | number | boolean | null>, expectedIdentity: string): Promise<RowAction> {
  const { rows } = await client.query<{ identity: string; exact: boolean }>(sql, values);
  if (rows.length === 0) return "insert";
  if (rows.length === 1 && rows[0].identity === expectedIdentity && rows[0].exact === true) return "exact_skip";
  return "conflict";
}

async function sourceMediaReferences(data: ImportData): Promise<Map<string, MediaReference[]>> {
  const refs = new Map<string, MediaReference[]>();
  const add = (mediaId: string, ref: MediaReference) => refs.set(mediaId, [...(refs.get(mediaId) ?? []), ref]);
  for (const menu of data.menus) if (menu.photoMediaId) add(menu.photoMediaId, { kind: "MENU", menuId: menu.id });
  for (const photo of data.reviewPhotos) add(photo.mediaId, { kind: "REVIEW", reviewId: photo.reviewId });
  return refs;
}

async function classifyMenuPhotoLink(client: Client, menu: ExportMenu, media: ExportMedia | undefined): Promise<RowAction> {
  const targetMediaId = media?.targetMediaId ?? null;
  const { rows } = await client.query<{
    menuId: string; photoMediaId: string | null; assetId: string | null; lifecycleStatus: string | null;
    activatedAt: string | null; hasStorageObject: boolean;
  }>(
    `SELECT m.id::text AS "menuId", m.photo_media_id::text AS "photoMediaId", a.id::text AS "assetId",
        a.lifecycle_status AS "lifecycleStatus", a.activated_at::text AS "activatedAt",
        EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path)
          AS "hasStorageObject"
       FROM public.menus m LEFT JOIN public.media_assets a ON a.id = m.photo_media_id
       WHERE m.id = $1 OR ($2::uuid IS NOT NULL AND m.photo_media_id = $2::uuid)`,
    [menu.id, targetMediaId],
  );
  if (rows.length === 0) {
    if (!media) return "exact_skip";
    return media.lifecycleStatus === "ACTIVE" ? "deferred" : "conflict";
  }
  if (rows.length !== 1 || rows[0].menuId !== menu.id) return "conflict";
  const row = rows[0];
  if (!media) return row.photoMediaId === null ? "exact_skip" : "conflict";
  if (row.photoMediaId === null) return media.lifecycleStatus === "ACTIVE" ? "deferred" : "conflict";
  return media.lifecycleStatus === "ACTIVE" && row.photoMediaId === targetMediaId && row.assetId === targetMediaId &&
    row.lifecycleStatus === "ACTIVE" && row.activatedAt !== null && row.hasStorageObject ? "exact_skip" : "conflict";
}

async function classifyReviewPhotoLink(client: Client, photo: ExportReviewPhoto, media: ExportMedia): Promise<RowAction> {
  if (media.lifecycleStatus !== "ACTIVE") return "conflict";
  const targetMediaId = media.targetMediaId;
  const { rows } = await client.query<{
    reviewId: string; mediaId: string; sortOrder: number; createdAtMatches: boolean; lifecycleStatus: string | null;
    activatedAt: string | null; hasStorageObject: boolean;
  }>(
    `SELECT rp.review_id::text AS "reviewId", rp.media_id::text AS "mediaId", rp.sort_order AS "sortOrder",
        (rp.created_at = $3::timestamptz) AS "createdAtMatches", a.lifecycle_status AS "lifecycleStatus",
        a.activated_at::text AS "activatedAt",
        EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path)
          AS "hasStorageObject"
       FROM public.review_photos rp LEFT JOIN public.media_assets a ON a.id = rp.media_id
       WHERE (rp.review_id = $1 AND rp.media_id = $2::uuid) OR rp.media_id = $2::uuid`,
    [photo.reviewId, targetMediaId, photo.createdAt],
  );
  if (rows.length === 0) return "deferred";
  if (rows.length !== 1) return "conflict";
  const row = rows[0];
  return row.reviewId === photo.reviewId && row.mediaId === targetMediaId && row.sortOrder === photo.sortOrder &&
    row.createdAtMatches && row.lifecycleStatus === "ACTIVE" && row.activatedAt !== null && row.hasStorageObject
    ? "exact_skip" : "conflict";
}

export async function inspectTargetState(
  client: Client,
  authUsers: AuthUserLite[],
  artifact: ImportArtifact,
  preparedAuthUserIds: Set<string> = new Set(),
): Promise<ImportPlan> {
  const { data, manifest } = artifact;
  const actions = emptyActions();
  const plan: ImportPlan = {
    actions, authUsersToCreate: [], conflicts: 0,
    deferredMedia: { binaryObjectCount: data.mediaAssets.length, staticMenuPhotoCount: manifest.deferredMedia.staticMenuPhotoCount, unlinkedAssetMetadataCount: 0, total: manifest.deferredMedia.total },
    deferredLinks: { menuPhotoCount: 0, reviewPhotoCount: 0, total: 0 },
  };
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const authByEmail = new Map(authUsers.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), user]));
  const userUuidByLegacy = new Map(data.users.map((user) => [user.legacyUserId, user.targetAuthUserId]));
  const mediaByLegacy = new Map(data.mediaAssets.map((media) => [media.mediaId, media]));

  for (const user of data.users) {
    const mapResult = await client.query<{ authUserId: string; emailNormalized: string; mustChange: boolean }>(
      `SELECT auth_user_id::text AS "authUserId", legacy_email_normalized AS "emailNormalized",
        legacy_must_change_password AS "mustChange" FROM private.legacy_user_identity
       WHERE legacy_user_id = $1 OR legacy_email_normalized = $2 OR auth_user_id = $3`,
      [user.legacyUserId, user.emailNormalized, user.targetAuthUserId],
    );
    const existingMap = mapResult.rows;
    const mappedAuth = authById.get(user.targetAuthUserId);
    const emailOwner = authByEmail.get(user.emailNormalized);
    let userAction: RowAction;
    if (existingMap.length === 1 && existingMap[0].authUserId === user.targetAuthUserId &&
        existingMap[0].emailNormalized === user.emailNormalized && existingMap[0].mustChange === user.mustChangePassword &&
        mappedAuth?.email?.toLowerCase() === user.emailNormalized && !mappedAuth.emailConfirmedAt &&
        (!emailOwner || emailOwner.id === user.targetAuthUserId)) {
      userAction = "exact_skip";
    } else if (existingMap.length === 0 && !mappedAuth && !emailOwner) {
      userAction = "insert";
      plan.authUsersToCreate.push(user);
    } else if (existingMap.length === 0 && preparedAuthUserIds.has(user.targetAuthUserId) &&
        mappedAuth?.email?.toLowerCase() === user.emailNormalized && !mappedAuth.emailConfirmedAt &&
        (!emailOwner || emailOwner.id === user.targetAuthUserId)) {
      userAction = "insert";
    } else {
      userAction = "conflict";
    }
    actions.users.set(user.legacyUserId, userAction);
    if (userAction === "conflict") plan.conflicts += 1;

    // The Auth Admin API creates profiles through the local schema trigger. Their
    // timestamps are target-generated; only the mapped identity and neutral default
    // name are source-independent import-preservable fields.
    const profileAction = await classify(client, "profiles", user.targetAuthUserId,
      `SELECT user_id::text AS identity, (display_name = '회원') AS exact
       FROM public.profiles WHERE user_id = $1::uuid`, [user.targetAuthUserId], user.targetAuthUserId);
    actions.profiles.set(user.targetAuthUserId, profileAction);
    if (profileAction === "conflict") plan.conflicts += 1;

    const roles = await client.query<{ roleCode: string }>(
      `SELECT role_code AS "roleCode" FROM private.user_roles WHERE user_id = $1::uuid`, [user.targetAuthUserId]);
    const expectsAdmin = user.systemRole === "SERVER_ADMIN";
    const roleAction: RowAction = roles.rows.length === (expectsAdmin ? 1 : 0) &&
      (!expectsAdmin || roles.rows[0]?.roleCode === "SERVER_ADMIN") ? "exact_skip" :
      (roles.rows.length === 0 && expectsAdmin ? "insert" : "conflict");
    actions.userRoles.set(user.targetAuthUserId, roleAction);
    if (roleAction === "conflict") plan.conflicts += 1;
  }

  for (const restaurant of data.restaurants) {
    const values = [restaurant.id, restaurant.name, restaurant.description, restaurant.address, restaurant.region,
      restaurant.latitude, restaurant.longitude, restaurant.createdAt];
    const action = await classify(client, "restaurants", restaurant.id,
      `SELECT id::text AS identity,
        (name IS NOT DISTINCT FROM $2 AND description IS NOT DISTINCT FROM $3 AND address IS NOT DISTINCT FROM $4
         AND region IS NOT DISTINCT FROM $5 AND latitude IS NOT DISTINCT FROM $6::numeric
         AND longitude IS NOT DISTINCT FROM $7::numeric AND created_at = $8::timestamptz AND updated_at = $8::timestamptz) AS exact
       FROM public.restaurants WHERE id = $1 OR name = $2`, values, restaurant.id);
    actions.restaurants.set(restaurant.id, action); if (action === "conflict") plan.conflicts += 1;
  }

  for (const menu of data.menus) {
    const values = [menu.id, menu.restaurantId, menu.name, menu.description, menu.priceKrw, menu.cuisineCategory,
      menu.active, menu.createdAt];
    const action = await classify(client, "menus", menu.id,
      `SELECT id::text AS identity,
        (restaurant_id = $2 AND name IS NOT DISTINCT FROM $3 AND description IS NOT DISTINCT FROM $4
         AND price_krw IS NOT DISTINCT FROM $5::integer AND cuisine_category = $6 AND active = $7
         AND created_at = $8::timestamptz AND updated_at = $8::timestamptz) AS exact
       FROM public.menus WHERE id = $1 OR (restaurant_id = $2 AND name = $3)`, values, menu.id);
    actions.menus.set(menu.id, action); if (action === "conflict") plan.conflicts += 1;

    const sourceMedia = menu.photoMediaId ? mediaByLegacy.get(menu.photoMediaId) : undefined;
    const linkAction = await classifyMenuPhotoLink(client, menu, sourceMedia);
    if (menu.photoMediaId) actions.menuPhotos.set(menu.id, linkAction);
    if (linkAction === "conflict") plan.conflicts += 1;
    if (linkAction === "deferred") {
      plan.deferredLinks.menuPhotoCount += 1;
      plan.deferredLinks.total += 1;
    }
  }

  for (const owner of data.restaurantOwners) {
    const uuid = userUuidByLegacy.get(owner.userId)!;
    const identity = `${uuid}:${owner.restaurantId}`;
    const action = await classify(client, "restaurantOwners", identity,
      `SELECT user_id::text || ':' || restaurant_id::text AS identity,
        (assigned_by IS NULL AND created_at = $3::timestamptz) AS exact
       FROM private.restaurant_owners WHERE user_id = $1 AND restaurant_id = $2`,
      [uuid, owner.restaurantId, owner.createdAt], identity);
    actions.restaurantOwners.set(identity, action); if (action === "conflict") plan.conflicts += 1;
  }

  for (const review of data.reviews) {
    const uuid = userUuidByLegacy.get(review.userId)!;
    const values = [review.id, uuid, review.menuId, review.overallScore, review.tasteScore, review.valueScore,
      review.portionScore, review.comment, review.nonEventReviewConsent, review.createdAt, review.updatedAt];
    const action = await classify(client, "reviews", review.id,
      `SELECT id::text AS identity,
        (user_id = $2::uuid AND menu_id = $3 AND overall_score = $4::numeric AND taste_score = $5::numeric
         AND value_score = $6::numeric AND portion_score = $7::numeric AND comment IS NOT DISTINCT FROM $8
         AND non_event_review_consent IS NOT DISTINCT FROM $9::boolean AND created_at = $10::timestamptz
         AND updated_at = $11::timestamptz) AS exact
       FROM public.reviews WHERE id = $1 OR (user_id = $2::uuid AND menu_id = $3)`, values, review.id);
    actions.reviews.set(review.id, action); if (action === "conflict") plan.conflicts += 1;
  }

  const refs = await sourceMediaReferences(data);
  for (const media of data.mediaAssets) {
    const mediaRefs = refs.get(media.mediaId) ?? [];
    if (mediaRefs.length > 1) {
      actions.mediaAssets.set(media.mediaId, "conflict"); plan.conflicts += 1;
    } else if (mediaRefs.length === 0) {
      actions.mediaAssets.set(media.mediaId, "deferred"); plan.deferredMedia.unlinkedAssetMetadataCount += 1;
    } else {
      const ref = mediaRefs[0];
      const uuid = userUuidByLegacy.get(media.uploadedByUserId)!;
      const status = media.lifecycleStatus === "ACTIVE" ? "PENDING" : media.lifecycleStatus;
      const extension = media.contentType === "image/jpeg" ? "jpg" : media.contentType === "image/png" ? "png" : "webp";
      const objectPath = `${ref.kind.toLowerCase()}/${uuid}/${media.targetMediaId}.${extension}`;
      const menuId = ref.kind === "MENU" ? ref.menuId ?? null : null;
      const reviewId = ref.kind === "REVIEW" ? ref.reviewId ?? null : null;
      const mapAction = await classify(client, "legacyMediaIdentity", media.mediaId,
        `SELECT legacy_media_id AS identity, media_id = $2::uuid AS exact
         FROM private.legacy_media_asset_identity WHERE legacy_media_id = $1 OR media_id = $2::uuid`,
        [media.mediaId, media.targetMediaId], media.mediaId);
      const targetAction = await classify(client, "mediaAssets", media.mediaId,
        `SELECT id::text AS identity,
          (object_path = $2 AND media_kind = $3 AND uploaded_by = $4::uuid AND menu_id IS NOT DISTINCT FROM $5::bigint
           AND review_id IS NOT DISTINCT FROM $6::bigint AND content_type = $7 AND original_bytes = $8::bigint
           AND stored_bytes = $9::bigint AND sha256_hex IS NOT DISTINCT FROM $10 AND created_at = $12::timestamptz
           AND ((lifecycle_status = $11 AND activated_at IS NULL)
             OR ($11 = 'PENDING' AND lifecycle_status = 'ACTIVE' AND activated_at IS NOT NULL
                 AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'yum-review-media' AND o.name = $2)))) AS exact
         FROM public.media_assets WHERE id = $1::uuid OR object_path = $2`,
        [media.targetMediaId, objectPath, ref.kind, uuid, menuId, reviewId, media.contentType, media.originalBytes,
          media.storedBytes, media.sha256Hex, status, media.createdAt], media.targetMediaId);
      const action: RowAction = mapAction === "conflict" || targetAction === "conflict" ? "conflict" :
        mapAction === "insert" || targetAction === "insert" ? "insert" : "exact_skip";
      actions.legacyMediaIdentity.set(media.mediaId, mapAction);
      actions.mediaAssets.set(media.mediaId, targetAction);
      if (action === "conflict") plan.conflicts += 1;
    }
    const rightsAction = await classify(client, "legacyMediaRights", media.mediaId,
      `SELECT legacy_media_id AS identity,
        (rights_basis IS NOT DISTINCT FROM $2 AND rights_attested_at IS NOT DISTINCT FROM $3::timestamptz
         AND rights_attested_legacy_user_id IS NOT DISTINCT FROM $4::bigint) AS exact
       FROM private.legacy_media_rights WHERE legacy_media_id = $1`,
      [media.mediaId, media.rightsBasis, media.rightsAttestedAt, media.rightsAttestedByUserId], media.mediaId);
    actions.legacyMediaRights.set(media.mediaId, rightsAction);
    if (rightsAction === "conflict") plan.conflicts += 1;
  }

  for (const photo of data.reviewPhotos) {
    const media = mediaByLegacy.get(photo.mediaId)!;
    const identity = `${photo.reviewId}:${photo.mediaId}`;
    const action = await classifyReviewPhotoLink(client, photo, media);
    actions.reviewPhotos.set(identity, action);
    if (action === "conflict") plan.conflicts += 1;
    if (action === "deferred") {
      plan.deferredLinks.reviewPhotoCount += 1;
      plan.deferredLinks.total += 1;
    }
  }
  return plan;
}

export function planCounts(plan: ImportPlan): { plannedRows: number; exactMatches: number; deferredRows: number; conflicts: number } {
  let plannedRows = 0; let exactMatches = 0; let deferredRows = 0;
  for (const rows of Object.values(plan.actions)) for (const action of rows.values()) {
    if (action === "insert") plannedRows += 1;
    else if (action === "exact_skip") exactMatches += 1;
    else if (action === "deferred") deferredRows += 1;
  }
  return { plannedRows, exactMatches, deferredRows, conflicts: plan.conflicts };
}

export function mediaAssociationStage(plan: ImportPlan): "conflict" | "awaiting-task07" | "complete" {
  const linkActions = [...plan.actions.menuPhotos.values(), ...plan.actions.reviewPhotos.values()];
  if (linkActions.includes("conflict")) return "conflict";
  if (linkActions.includes("deferred")) return "awaiting-task07";
  return "complete";
}

async function insertPlannedRows(client: Client, artifact: ImportArtifact, plan: ImportPlan): Promise<void> {
  const { data } = artifact;
  const action = (entity: EntityName, key: string) => plan.actions[entity].get(key);
  const targetUserId = new Map(data.users.map((user) => [user.legacyUserId, user.targetAuthUserId]));
  const refs = await sourceMediaReferences(data);

  for (const user of data.users) {
    if (action("users", user.legacyUserId) === "insert") {
      await client.query(
        `INSERT INTO private.legacy_user_identity
          (legacy_user_id, auth_user_id, legacy_email_normalized, legacy_must_change_password)
         VALUES ($1, $2::uuid, $3, $4)`,
        [user.legacyUserId, user.targetAuthUserId, user.emailNormalized, user.mustChangePassword],
      );
    }
    if (action("profiles", user.targetAuthUserId) === "insert") {
      await client.query(
        `INSERT INTO public.profiles (user_id, display_name) VALUES ($1::uuid, '회원')`,
        [user.targetAuthUserId],
      );
    }
    if (user.systemRole === "SERVER_ADMIN" && action("userRoles", user.targetAuthUserId) === "insert") {
      await client.query(
        `INSERT INTO private.user_roles (user_id, role_code) VALUES ($1::uuid, 'SERVER_ADMIN')`,
        [user.targetAuthUserId],
      );
    }
  }

  for (const restaurant of data.restaurants) {
    if (action("restaurants", restaurant.id) !== "insert") continue;
    await client.query(
      `INSERT INTO public.restaurants (id, name, description, address, region, latitude, longitude, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::timestamptz, $8::timestamptz)`,
      [restaurant.id, restaurant.name, restaurant.description, restaurant.address, restaurant.region,
        restaurant.latitude, restaurant.longitude, restaurant.createdAt],
    );
  }

  // Import catalog rows without public photo links. The separate local-only
  // import-media.ts workflow validates bytes and exact targets before linking.
  for (const menu of data.menus) {
    if (action("menus", menu.id) !== "insert") continue;
    await client.query(
      `INSERT INTO public.menus (id, restaurant_id, name, description, price_krw, cuisine_category,
        active, photo_media_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8::timestamptz, $8::timestamptz)`,
      [menu.id, menu.restaurantId, menu.name, menu.description, menu.priceKrw, menu.cuisineCategory, menu.active, menu.createdAt],
    );
  }

  for (const owner of data.restaurantOwners) {
    const uuid = targetUserId.get(owner.userId)!;
    const identity = `${uuid}:${owner.restaurantId}`;
    if (action("restaurantOwners", identity) !== "insert") continue;
    await client.query(
      `INSERT INTO private.restaurant_owners (user_id, restaurant_id, assigned_by, created_at)
       VALUES ($1::uuid, $2, NULL, $3::timestamptz)`, [uuid, owner.restaurantId, owner.createdAt],
    );
  }

  for (const review of data.reviews) {
    if (action("reviews", review.id) !== "insert") continue;
    await client.query(
      `INSERT INTO public.reviews (id, user_id, menu_id, overall_score, taste_score, value_score, portion_score,
        comment, non_event_review_consent, created_at, updated_at)
       VALUES ($1, $2::uuid, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric,
        $8, $9::boolean, $10::timestamptz, $11::timestamptz)`,
      [review.id, targetUserId.get(review.userId)!, review.menuId, review.overallScore, review.tasteScore,
        review.valueScore, review.portionScore, review.comment, review.nonEventReviewConsent, review.createdAt, review.updatedAt],
    );
  }

  for (const media of data.mediaAssets) {
    if (action("legacyMediaRights", media.mediaId) === "insert") {
      await client.query(
        `INSERT INTO private.legacy_media_rights
          (legacy_media_id, rights_basis, rights_attested_at, rights_attested_legacy_user_id)
         VALUES ($1, $2, $3::timestamptz, $4)`,
        [media.mediaId, media.rightsBasis, media.rightsAttestedAt, media.rightsAttestedByUserId],
      );
    }
    const mediaRefs = refs.get(media.mediaId) ?? [];
    if (mediaRefs.length !== 1) continue;
    const ref = mediaRefs[0];
    const key = media.mediaId;
    const targetId = media.targetMediaId;
    const uuid = targetUserId.get(media.uploadedByUserId)!;
    const extension = media.contentType === "image/jpeg" ? "jpg" : media.contentType === "image/png" ? "png" : "webp";
    const objectPath = `${ref.kind.toLowerCase()}/${uuid}/${targetId}.${extension}`;
    const lifecycleStatus = media.lifecycleStatus === "ACTIVE" ? "PENDING" : media.lifecycleStatus;
    const menuId = ref.kind === "MENU" ? ref.menuId : null;
    const reviewId = ref.kind === "REVIEW" ? ref.reviewId : null;
    if (action("mediaAssets", key) === "insert") {
      await client.query(
        `INSERT INTO public.media_assets (id, object_path, media_kind, uploaded_by, menu_id, review_id, content_type,
          original_bytes, stored_bytes, sha256_hex, lifecycle_status, created_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
        [targetId, objectPath, ref.kind, uuid, menuId, reviewId, media.contentType, media.originalBytes,
          media.storedBytes, media.sha256Hex, lifecycleStatus, media.createdAt],
      );
    }
    if (action("legacyMediaIdentity", key) === "insert") {
      await client.query(
        `INSERT INTO private.legacy_media_asset_identity (legacy_media_id, media_id)
         VALUES ($1, $2::uuid)`, [media.mediaId, targetId],
      );
    }
  }

  // Both public association types stay deferred until Task07 verifies the
  // uploaded Storage bytes, activates the pending asset, and links it safely.

  // Explicit legacy identity IDs are preserved; advance target sequences only forward.
  for (const table of ["restaurants", "menus", "reviews"] as const) {
    const { rows } = await client.query<{ sequenceName: string; maxId: string }>(
      `SELECT pg_get_serial_sequence($1, 'id') AS "sequenceName", COALESCE(MAX(id), 0)::text AS "maxId"
       FROM public.${table}`,
      [`public.${table}`],
    );
    const sequenceName = rows[0]?.sequenceName;
    if (!sequenceName) throw new Error("Target identity sequence is unavailable.");
    const sequence = await client.query<{ lastValue: string | null }>(
      `SELECT pg_sequence_last_value($1::regclass)::text AS "lastValue"`, [sequenceName],
    );
    const maxId = BigInt(rows[0].maxId);
    const lastValue = BigInt(sequence.rows[0]?.lastValue ?? "0");
    if (maxId > lastValue) {
      await client.query(`SELECT setval($1::regclass, $2::bigint, true)`, [sequenceName, maxId.toString()]);
    }
  }
}

function formatSummary(plan: ImportPlan, artifact: ImportArtifact, mode: "dry-run" | "apply", authUsersCreated = 0) {
  return {
    ok: plan.conflicts === 0,
    mode,
    target: "local-disposable",
    sourceCounts: artifact.manifest.counts,
    plan: planCounts(plan),
    authUsersCreated,
    deferred_media: plan.deferredMedia,
    deferred_links: plan.deferredLinks,
    media_association_stage: mediaAssociationStage(plan),
    task07_contract: TASK07_MEDIA_CONTRACT,
  };
}

async function runImporter(options: CliOptions): Promise<void> {
  const artifact = await readImportArtifact(options.inputPath);
  const databaseUrl = getEnv(options.databaseUrlEnv);
  const supabaseUrl = getEnv(options.supabaseUrlEnv);
  const serviceKey = getEnv(options.serviceKeyEnv);
  assertLocalUrl(databaseUrl, "postgres");
  const admin = createLocalAdminClient(supabaseUrl, serviceKey);
  const client = new Client({ connectionString: databaseUrl, application_name: "yum-review-local-import", statement_timeout: 60_000 });
  let connected = false;
  let authUsersCreated = 0;
  const preparedIds = new Set<string>();
  try {
    await client.connect(); connected = true;
    let authUsers = await listLocalAuthUsers(admin);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let plan = await inspectTargetState(client, authUsers, artifact);
    await client.query("COMMIT");
    if (plan.conflicts > 0) {
      process.stdout.write(JSON.stringify(formatSummary(plan, artifact, options.apply ? "apply" : "dry-run")) + "\n");
      process.exitCode = 2;
      return;
    }
    if (!options.apply) {
      process.stdout.write(JSON.stringify(formatSummary(plan, artifact, "dry-run")) + "\n");
      return;
    }

    for (const user of plan.authUsersToCreate) {
      const { data, error } = await admin.auth.admin.createUser({
        id: user.targetAuthUserId,
        email: user.email,
        password_hash: user.passwordHash,
        email_confirm: false,
      });
      if (error || !data.user || data.user.id !== user.targetAuthUserId) {
        process.stdout.write(JSON.stringify({
          ok: false, mode: "apply", stage: "auth-provisioning", authUsersCreated,
          privateIdentityRowsWritten: 0, catalogRowsWritten: 0,
          note: "No Postgres rows were written. Newly created Auth rows, if any, were preserved for manual reconciliation.",
        }) + "\n");
        process.exitCode = 1;
        return;
      }
      preparedIds.add(user.targetAuthUserId);
      authUsersCreated += 1;
    }

    authUsers = await listLocalAuthUsers(admin);
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    plan = await inspectTargetState(client, authUsers, artifact, preparedIds);
    if (plan.conflicts > 0) {
      await client.query("ROLLBACK");
      process.stdout.write(JSON.stringify({
        ...formatSummary(plan, artifact, "apply", authUsersCreated),
        note: "No Postgres rows were committed. Any newly created Auth rows were preserved for manual reconciliation.",
      }) + "\n");
      process.exitCode = 2;
      return;
    }
    await insertPlannedRows(client, artifact, plan);
    await client.query("COMMIT");
    process.stdout.write(JSON.stringify(formatSummary(plan, artifact, "apply", authUsersCreated)) + "\n");
  } catch {
    if (connected) await client.query("ROLLBACK").catch(() => undefined);
    process.stderr.write("Import failed closed. Sensitive values and database/Auth response details were withheld. No Postgres transaction was committed.\n");
    process.exitCode = 1;
  } finally {
    if (connected) await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseImportArgs(process.argv.slice(2));
    runImporter(options).catch(() => {
      process.stderr.write("Import failed closed. Sensitive values and response details were withheld.\n");
      process.exitCode = 1;
    });
  } catch {
    process.stderr.write("Import arguments are invalid. Use --help for the safe invocation format.\n");
    process.exitCode = 2;
  }
}
