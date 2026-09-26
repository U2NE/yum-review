import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, open, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const execFileAsync = promisify(execFile);
const EXPORT_FORMAT = "yum-review.spring-export/v1";
// UUIDv5 of the DNS namespace and the stable project label `yum-review:migration:identity:v1`.
// Keep this immutable across exports; identifiers are derived only from legacy table IDs.
const PROJECT_IDENTITY_NAMESPACE = "e14b9b93-d2f5-5f85-8aad-9bd1e9c7c158";

function stableIdentityUuid(name: string): string {
  const namespaceBytes = Buffer.from(PROJECT_IDENTITY_NAMESPACE.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  const uuidBytes = Buffer.from(digest.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = uuidBytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type CliOptions = { outputPath: string; sourceUrlEnv: string };
type AppUserRow = {
  legacyUserId: string;
  targetAuthUserId: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  systemRole: string;
  mustChangePassword: boolean;
  createdAt: string;
};
type RestaurantRow = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  region: string | null;
  latitude: string | null;
  longitude: string | null;
  createdAt: string;
};
type MenuRow = {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  priceKrw: number | null;
  cuisineCategory: string;
  active: boolean;
  photoMediaId: string | null;
  photoUrl: string | null;
  createdAt: string;
};
type RestaurantOwnerRow = { userId: string; restaurantId: string; createdAt: string };
type ReviewRow = {
  id: string;
  userId: string;
  menuId: string;
  overallScore: string;
  tasteScore: string;
  valueScore: string;
  portionScore: string;
  comment: string | null;
  nonEventReviewConsent: boolean | null;
  createdAt: string;
  updatedAt: string;
};
type MediaAssetRow = {
  mediaId: string;
  targetMediaId: string;
  storageKey: string;
  uploadedByUserId: string;
  contentType: string;
  originalBytes: string;
  storedBytes: string;
  sha256Hex: string;
  provenance: string;
  rightsBasis: string;
  rightsAttestedAt: string;
  rightsAttestedByUserId: string;
  lifecycleStatus: string;
  createdAt: string;
};
type ReviewPhotoRow = { reviewId: string; mediaId: string; sortOrder: number; createdAt: string };
type ExportData = {
  users: AppUserRow[];
  restaurants: RestaurantRow[];
  menus: MenuRow[];
  restaurantOwners: RestaurantOwnerRow[];
  reviews: ReviewRow[];
  mediaAssets: MediaAssetRow[];
  reviewPhotos: ReviewPhotoRow[];
};

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      process.stdout.write(
        "Usage: npm run migrate:export -- --output <private-file-outside-repo> --source-url-env <ENV_NAME>\n",
      );
      process.exit(0);
    }
    if (!key?.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("Arguments must use --output and --source-url-env with values.");
    }
    if (values.has(key)) throw new Error("Duplicate command option.");
    values.set(key, argv[index + 1]);
    index += 1;
  }

  const outputPath = values.get("--output");
  const sourceUrlEnv = values.get("--source-url-env");
  if (!outputPath || !sourceUrlEnv || values.size !== 2) {
    throw new Error("Both --output and --source-url-env are required.");
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(sourceUrlEnv)) {
    throw new Error("--source-url-env must name an environment variable.");
  }
  return { outputPath: path.resolve(outputPath), sourceUrlEnv };
}

function sortForDigest(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortForDigest);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, sortForDigest(item)]),
  );
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortForDigest(value))).digest("hex");
}

async function ensureOutputIsPrivateAndExternal(outputPath: string): Promise<string> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = await realpath(path.resolve(scriptDir, "../.."));
  const parent = await realpath(path.dirname(outputPath)).catch(() => {
    throw new Error("The output directory must already exist outside the repository.");
  });
  const output = path.join(parent, path.basename(outputPath));
  const relative = path.relative(repoRoot, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Sensitive export output must stay outside the repository.");
  }
  try {
    await lstat(output);
    throw new Error("The output file already exists; choose a new path.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return output;
}

async function restrictWindowsAcl(filePath: string): Promise<void> {
  const { stdout } = await execFileAsync("whoami", ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
    maxBuffer: 16 * 1024,
  });
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error("Could not establish a restrictive export file permission.");
  await execFileAsync("icacls", [filePath, "/inheritance:r", "/grant:r", `*${sid}:(F)`], {
    windowsHide: true,
    maxBuffer: 16 * 1024,
  });
}

async function writePrivateExport(outputPath: string, contents: string): Promise<void> {
  const handle = await open(outputPath, "wx", 0o600);
  try {
    if (process.platform === "win32") {
      await restrictWindowsAcl(outputPath);
    } else {
      await chmod(outputPath, 0o600);
      const permissions = (await stat(outputPath)).mode & 0o777;
      if ((permissions & 0o077) !== 0) throw new Error("Could not establish restrictive export file permissions.");
    }
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

function readOnlyConnectionString(envName: string): string {
  const value = process.env[envName];
  if (!value) throw new Error(`The named source connection variable ${envName} is not set.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The named source connection variable is not a valid PostgreSQL URL.");
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("The source connection must use PostgreSQL.");
  }
  return value;
}

async function exportRows(connectionString: string): Promise<ExportData> {
  const client = new Client({
    connectionString,
    application_name: "yum-review-read-only-migration-export",
    statement_timeout: 60_000,
    query_timeout: 65_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const [usersResult, restaurantsResult, menusResult, ownersResult, reviewsResult, mediaResult, reviewPhotosResult] = await Promise.all([
      client.query(`SELECT id::text AS "legacyUserId", email, email_normalized AS "emailNormalized",
        password_hash AS "passwordHash", system_role AS "systemRole",
        must_change_password AS "mustChangePassword", created_at::text AS "createdAt"
        FROM public.app_user ORDER BY id`),
      client.query(`SELECT id::text AS id, name, description, address, region,
        latitude::text AS latitude, longitude::text AS longitude, created_at::text AS "createdAt"
        FROM public.restaurant ORDER BY id`),
      client.query(`SELECT id::text AS id, restaurant_id::text AS "restaurantId", name, description,
        price_krw AS "priceKrw", cuisine_category AS "cuisineCategory", active,
        photo_media_id AS "photoMediaId", photo_url AS "photoUrl", created_at::text AS "createdAt"
        FROM public.menu ORDER BY id`),
      client.query(`SELECT user_id::text AS "userId", restaurant_id::text AS "restaurantId", created_at::text AS "createdAt"
        FROM public.restaurant_owner ORDER BY user_id, restaurant_id`),
      client.query(`SELECT id::text AS id, user_id::text AS "userId", menu_id::text AS "menuId",
        overall_score::text AS "overallScore", taste_score::text AS "tasteScore",
        value_score::text AS "valueScore", portion_score::text AS "portionScore", comment,
        non_event_review_consent AS "nonEventReviewConsent", created_at::text AS "createdAt", updated_at::text AS "updatedAt"
        FROM public.review ORDER BY id`),
      client.query(`SELECT media_id AS "mediaId", storage_key AS "storageKey",
        uploaded_by_user_id::text AS "uploadedByUserId", content_type AS "contentType",
        original_bytes::text AS "originalBytes", stored_bytes::text AS "storedBytes",
        sha256_hex AS "sha256Hex", provenance, rights_basis AS "rightsBasis",
        rights_attested_at::text AS "rightsAttestedAt", rights_attested_by_user_id::text AS "rightsAttestedByUserId",
        lifecycle_status AS "lifecycleStatus", created_at::text AS "createdAt"
        FROM public.media_asset ORDER BY media_id`),
      client.query(`SELECT review_id::text AS "reviewId", media_id AS "mediaId",
        sort_order AS "sortOrder", created_at::text AS "createdAt"
        FROM public.review_photo ORDER BY review_id, sort_order, media_id`),
    ]);
    const data: ExportData = {
      users: usersResult.rows.map((row) => ({
        ...row,
        targetAuthUserId: stableIdentityUuid(`legacy-user:${row.legacyUserId}`),
      }) as AppUserRow),
      restaurants: restaurantsResult.rows as RestaurantRow[],
      menus: menusResult.rows as MenuRow[],
      restaurantOwners: ownersResult.rows as RestaurantOwnerRow[],
      reviews: reviewsResult.rows as ReviewRow[],
      mediaAssets: mediaResult.rows.map((row) => ({
        ...row,
        targetMediaId: stableIdentityUuid(`legacy-media:${row.mediaId}`),
      })) as MediaAssetRow[],
      reviewPhotos: reviewPhotosResult.rows as ReviewPhotoRow[],
    };
    await client.query("COMMIT");
    return data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = await ensureOutputIsPrivateAndExternal(options.outputPath);
  const connectionString = readOnlyConnectionString(options.sourceUrlEnv);
  const data = await exportRows(connectionString);
  const staticMenuPhotoPaths = data.menus
    .flatMap((menu) => (menu.photoUrl ? [menu.photoUrl] : []))
    .sort();
  const manifest = {
    format: EXPORT_FORMAT,
    createdAt: new Date().toISOString(),
    sourceMigrations: ["V1", "V2", "V3", "V4", "V5", "V6"],
    counts: {
      users: data.users.length,
      restaurants: data.restaurants.length,
      menus: data.menus.length,
      restaurantOwners: data.restaurantOwners.length,
      reviews: data.reviews.length,
      mediaAssets: data.mediaAssets.length,
      reviewPhotos: data.reviewPhotos.length,
    },
    deferredMedia: {
      binaryObjectCount: data.mediaAssets.length,
      staticMenuPhotoCount: staticMenuPhotoPaths.length,
      total: data.mediaAssets.length + staticMenuPhotoPaths.length,
      staticMenuPhotoPaths,
    },
    dataSha256: sha256(data),
    emailConfirmationMapping: "unconfirmed",
    consentNullsPreserved: true,
  };
  const artifact = { manifest, data };
  await writePrivateExport(outputPath, JSON.stringify(artifact) + "\n");
  process.stdout.write(JSON.stringify({ ok: true, counts: manifest.counts, deferredMedia: {
    binaryObjectCount: manifest.deferredMedia.binaryObjectCount,
    staticMenuPhotoCount: manifest.deferredMedia.staticMenuPhotoCount,
    total: manifest.deferredMedia.total,
  } }) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("Export failed. Source details and sensitive values were withheld.\n");
    process.exitCode = 1;
  });
}
