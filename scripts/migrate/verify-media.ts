import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { inspectImageHeader, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE } from "@/lib/media/validate-image";
import { assertLocalUrl, readImportArtifact, type ExportMedia, type ImportArtifact } from "./import-supabase";
import { inspectUserPhotoZip, writePrivateJson } from "./import-media";

const BUCKET = "yum-review-media";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_VERIFY_OBJECTS = 20_000;
const MAX_VERIFY_TOTAL_BYTES = 2_000_000_000;

type Options = {
  inputPath?: string;
  zipPath?: string;
  sourceRoot?: string;
  reportOut?: string;
  inspectLocalTarget: boolean;
  localDisposableTarget: boolean;
  databaseUrlEnv?: string;
  supabaseUrlEnv?: string;
  serviceKeyEnv?: string;
};

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  let inspectLocalTarget = false;
  let localDisposableTarget = false;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--help" || key === "-h") {
      process.stdout.write(
        "Usage: npx tsx scripts/migrate/verify-media.ts [--input <private-export>] [--zip <user-zip>] [--source-root <legacy-media-root>] [--report-out <private-path>] [--inspect-local-target --local-disposable-target --database-url-env <ENV> --supabase-url-env <ENV> --service-key-env <ENV>]\n",
      );
      process.exit(0);
    }
    if (key === "--inspect-local-target") { inspectLocalTarget = true; continue; }
    if (key === "--local-disposable-target") { localDisposableTarget = true; continue; }
    if (!key?.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--") || values.has(key)) {
      throw new Error("Media verifier arguments are invalid.");
    }
    values.set(key, argv[i + 1]);
    i += 1;
  }
  const allowed = new Set([
    "--input", "--zip", "--source-root", "--report-out", "--database-url-env", "--supabase-url-env", "--service-key-env",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error("Media verifier has an unsupported option.");
  if (!inspectLocalTarget && localDisposableTarget) throw new Error("Local target credentials require --inspect-local-target.");
  if (inspectLocalTarget !== localDisposableTarget) throw new Error("Target inspection requires both --inspect-local-target and --local-disposable-target.");
  const envKeys = ["--database-url-env", "--supabase-url-env", "--service-key-env"];
  if (inspectLocalTarget && envKeys.some((key) => !values.has(key))) throw new Error("Local target inspection requires explicit target environment variable names.");
  if (!inspectLocalTarget && envKeys.some((key) => values.has(key))) throw new Error("Target credentials are accepted only in explicit local disposable mode.");
  for (const key of envKeys) {
    const value = values.get(key);
    if (value && !/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new Error("Target options must name environment variables.");
  }
  const inputPath = values.get("--input");
  const zipPath = values.get("--zip");
  if (!inputPath && !zipPath && !inspectLocalTarget) throw new Error("Provide a private export, user ZIP, or explicit local target to verify.");
  return {
    inputPath: inputPath ? path.resolve(inputPath) : undefined,
    zipPath: zipPath ? path.resolve(zipPath) : undefined,
    sourceRoot: values.has("--source-root") ? path.resolve(values.get("--source-root")!) : undefined,
    reportOut: values.has("--report-out") ? path.resolve(values.get("--report-out")!) : undefined,
    inspectLocalTarget,
    localDisposableTarget,
    databaseUrlEnv: values.get("--database-url-env"),
    supabaseUrlEnv: values.get("--supabase-url-env"),
    serviceKeyEnv: values.get("--service-key-env"),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readRequiredEnv(name: string | undefined): string {
  if (!name || !process.env[name]) throw new Error("An explicitly named local target variable is not set.");
  return process.env[name]!;
}

function validateSourceBytes(bytes: Buffer, media: ExportMedia): void {
  if (bytes.length >= MAX_IMAGE_BYTES || bytes.length !== Number(media.storedBytes) || sha256(bytes) !== media.sha256Hex.toLowerCase()) {
    throw new Error("A legacy source image does not match its stored byte count or checksum.");
  }
  const header = inspectImageHeader(bytes);
  if (!header || header.contentType !== media.contentType || header.width > MAX_IMAGE_SIDE || header.height > MAX_IMAGE_SIDE || header.width * header.height > MAX_IMAGE_PIXELS) {
    throw new Error("A legacy source image failed its signature or dimension check.");
  }
}

function safeSourcePath(root: string, key: string): string {
  if (!key || key.includes("\\") || path.posix.isAbsolute(key) || key.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("A legacy media key is not a safe relative path.");
  }
  return path.resolve(root, ...key.split("/"));
}

async function readSourceFile(root: string, key: string): Promise<Buffer | null> {
  const rootReal = await realpath(root);
  const target = safeSourcePath(rootReal, key);
  const real = await realpath(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!real) return null;
  const relative = path.relative(rootReal, real);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("A legacy media file resolves outside its read-only source directory.");
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size >= MAX_IMAGE_BYTES) throw new Error("A legacy source media item is not a supported regular file.");
  return readFile(real);
}

function inspectSourceMapping(artifact: ImportArtifact) {
  const legacyIds = new Set<string>();
  const linkCounts = new Map<string, number>();
  for (const media of artifact.data.mediaAssets) {
    if (!media.mediaId || legacyIds.has(media.mediaId)) throw new Error("Legacy media export has a missing or duplicate media identity.");
    legacyIds.add(media.mediaId);
  }
  for (const menu of artifact.data.menus) if (menu.photoMediaId) linkCounts.set(menu.photoMediaId, (linkCounts.get(menu.photoMediaId) ?? 0) + 1);
  for (const photo of artifact.data.reviewPhotos) linkCounts.set(photo.mediaId, (linkCounts.get(photo.mediaId) ?? 0) + 1);
  return {
    uniqueLegacyMedia: legacyIds.size,
    duplicateLinks: [...linkCounts.values()].filter((count) => count > 1).length,
    v6PhotoUrls: artifact.data.menus.filter((menu) => Boolean(menu.photoUrl)).length,
  };
}

async function inspectLocalTarget(
  options: Options,
  artifact: ImportArtifact | null,
  zipPhotos: Awaited<ReturnType<typeof inspectUserPhotoZip>>,
) {
  const databaseUrl = readRequiredEnv(options.databaseUrlEnv);
  const supabaseUrl = readRequiredEnv(options.supabaseUrlEnv);
  const serviceKey = readRequiredEnv(options.serviceKeyEnv);
  assertLocalUrl(databaseUrl, "postgres");
  assertLocalUrl(supabaseUrl, "supabase");
  const client = new Client({ connectionString: databaseUrl, application_name: "yum-review-local-media-verify", statement_timeout: 60_000 });
  const storage = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.connect();
  try {
    const summary = await client.query<{
      mediaAssets: string; reviewPhotos: string; menuPhotoRefs: string; v6PhotoUrls: string;
      pending: string; active: string; revoked: string; deletePending: string; deleted: string;
      missingLinks: string; orphanLinks: string; invalidActiveLinks: string;
    }>("SELECT " +
      "(SELECT count(*) FROM public.media_assets)::text AS \"mediaAssets\", " +
      "(SELECT count(*) FROM public.review_photos)::text AS \"reviewPhotos\", " +
      "(SELECT count(*) FROM public.menus WHERE photo_media_id IS NOT NULL)::text AS \"menuPhotoRefs\", " +
      "'0'::text AS \"v6PhotoUrls\", " +
      "(SELECT count(*) FROM public.media_assets WHERE lifecycle_status='PENDING')::text AS pending, " +
      "(SELECT count(*) FROM public.media_assets WHERE lifecycle_status='ACTIVE')::text AS active, " +
      "(SELECT count(*) FROM public.media_assets WHERE lifecycle_status='REVOKED')::text AS revoked, " +
      "(SELECT count(*) FROM public.media_assets WHERE lifecycle_status='DELETE_PENDING')::text AS \"deletePending\", " +
      "(SELECT count(*) FROM public.media_assets WHERE lifecycle_status='DELETED')::text AS deleted, " +
      "(SELECT count(*) FROM public.media_assets AS a WHERE a.lifecycle_status='ACTIVE' AND NOT (" +
      "EXISTS (SELECT 1 FROM public.menus AS m WHERE m.photo_media_id=a.id) OR " +
      "EXISTS (SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id=a.id)))::text AS \"missingLinks\", " +
      "((SELECT count(*) FROM public.menus AS m LEFT JOIN public.media_assets AS a ON a.id=m.photo_media_id " +
      "WHERE m.photo_media_id IS NOT NULL AND (a.id IS NULL OR a.media_kind <> 'MENU' OR a.menu_id <> m.id)) + " +
      "(SELECT count(*) FROM public.review_photos AS rp LEFT JOIN public.media_assets AS a ON a.id=rp.media_id " +
      "WHERE a.id IS NULL OR a.media_kind <> 'REVIEW' OR a.review_id <> rp.review_id))::text AS \"orphanLinks\", " +
      "((SELECT count(*) FROM public.menus AS m JOIN public.media_assets AS a ON a.id=m.photo_media_id " +
      "WHERE a.lifecycle_status <> 'ACTIVE') + " +
      "(SELECT count(*) FROM public.review_photos AS rp JOIN public.media_assets AS a ON a.id=rp.media_id " +
      "WHERE a.lifecycle_status <> 'ACTIVE'))::text AS \"invalidActiveLinks\"");

    const v6Column = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='menus' AND column_name='photo_url') AS exists",
    );
    let v6PhotoUrls = "0";
    if (v6Column.rows[0]?.exists) {
      const v6Count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM public.menus WHERE photo_url IS NOT NULL");
      v6PhotoUrls = v6Count.rows[0]?.count ?? "0";
    }

    const mediaRows = await client.query<{
      id: string; object_path: string; media_kind: "MENU" | "REVIEW"; uploaded_by: string;
      menu_id: string | null; review_id: string | null; content_type: string; original_bytes: string; stored_bytes: string;
      sha256_hex: string | null; lifecycle_status: string; legacy_media_id: string | null;
      rights_basis: string | null; rights_attested_at: string | null; rights_attested_legacy_user_id: string | null;
      menu_link_id: string | null; review_link_id: string | null;
    }>("SELECT a.id::text, a.object_path, a.media_kind, a.uploaded_by::text, a.menu_id::text, a.review_id::text, " +
      "a.content_type, a.original_bytes::text, a.stored_bytes::text, a.sha256_hex, a.lifecycle_status, " +
      "li.legacy_media_id, lr.rights_basis, lr.rights_attested_at::text, lr.rights_attested_legacy_user_id::text, " +
      "m.id::text AS menu_link_id, rp.review_id::text AS review_link_id " +
      "FROM public.media_assets AS a " +
      "LEFT JOIN private.legacy_media_asset_identity AS li ON li.media_id=a.id " +
      "LEFT JOIN private.legacy_media_rights AS lr ON lr.legacy_media_id=li.legacy_media_id " +
      "LEFT JOIN public.menus AS m ON m.photo_media_id=a.id " +
      "LEFT JOIN public.review_photos AS rp ON rp.media_id=a.id ORDER BY a.id");
    if (mediaRows.rows.length > MAX_VERIFY_OBJECTS) throw new Error("Local media target exceeds the verifier object limit; no Storage objects were downloaded.");
    const byteTotal = mediaRows.rows.reduce((total, row) => total + (row.lifecycle_status === "ACTIVE" ? Number(row.stored_bytes) : 0), 0);
    if (!Number.isSafeInteger(byteTotal) || byteTotal > MAX_VERIFY_TOTAL_BYTES) throw new Error("Active local media exceeds the verifier byte limit; no Storage objects were downloaded.");

    let verifiedObjects = 0;
    let failedObjects = 0;
    for (const row of mediaRows.rows) {
      if (row.lifecycle_status !== "ACTIVE") continue;
      const { data, error } = await storage.storage.from(BUCKET).download(row.object_path);
      if (error || !data) { failedObjects += 1; continue; }
      const bytes = Buffer.from(await data.arrayBuffer());
      if (bytes.length !== Number(row.stored_bytes) || (row.sha256_hex && sha256(bytes) !== row.sha256_hex.toLowerCase())) {
        failedObjects += 1;
        continue;
      }
      const header = inspectImageHeader(bytes);
      if (!header || header.contentType !== row.content_type || header.width > MAX_IMAGE_SIDE || header.height > MAX_IMAGE_SIDE || header.width * header.height > MAX_IMAGE_PIXELS) {
        failedObjects += 1;
        continue;
      }
      verifiedObjects += 1;
    }

    let legacyMappingChecks: { compared: number; mismatches: number } | null = null;
    if (artifact) {
      let compared = 0;
      let mismatches = 0;
      const byLegacy = new Map(mediaRows.rows.filter((row) => row.legacy_media_id).map((row) => [row.legacy_media_id!, row]));
      const refs = new Map<string, Array<{ kind: "MENU" | "REVIEW"; id: string }>>();
      for (const menu of artifact.data.menus) if (menu.photoMediaId) refs.set(menu.photoMediaId, [...(refs.get(menu.photoMediaId) ?? []), { kind: "MENU", id: menu.id }]);
      for (const photo of artifact.data.reviewPhotos) refs.set(photo.mediaId, [...(refs.get(photo.mediaId) ?? []), { kind: "REVIEW", id: photo.reviewId }]);
      for (const media of artifact.data.mediaAssets) {
        const row = byLegacy.get(media.mediaId);
        const related = refs.get(media.mediaId) ?? [];
        if (related.length !== 1) { mismatches += 1; continue; }
        compared += 1;
        const ref = related[0];
        const expectedUploader = artifact.data.users.find((user) => user.legacyUserId === media.uploadedByUserId)?.targetAuthUserId;
        const extension = media.contentType === "image/jpeg" ? "jpg" : media.contentType === "image/png" ? "png" : media.contentType === "image/webp" ? "webp" : "unknown";
        const expectedObjectPath = ref.kind.toLowerCase() + "/" + expectedUploader + "/" + media.targetMediaId + "." + extension;
        const sourceRightsAt = media.rightsAttestedAt ? Date.parse(media.rightsAttestedAt) : null;
        const targetRightsAt = row?.rights_attested_at ? Date.parse(row.rights_attested_at) : null;
        const exact = Boolean(row && expectedUploader &&
          row.id === media.targetMediaId && row.object_path === expectedObjectPath && row.media_kind === ref.kind &&
          row.uploaded_by === expectedUploader && row.content_type === media.contentType &&
          row.original_bytes === media.originalBytes && row.stored_bytes === media.storedBytes &&
          row.sha256_hex?.toLowerCase() === media.sha256Hex.toLowerCase() && row.lifecycle_status === "ACTIVE" &&
          row.legacy_media_id === media.mediaId && row.rights_basis === (media.rightsBasis ?? null) &&
          row.rights_attested_legacy_user_id === (media.rightsAttestedByUserId ?? null) &&
          (sourceRightsAt === null ? targetRightsAt === null : sourceRightsAt === targetRightsAt) &&
          (ref.kind === "MENU" ? row.menu_id === ref.id && row.menu_link_id === ref.id && row.review_id === null && row.review_link_id === null
            : row.review_id === ref.id && row.review_link_id === ref.id && row.menu_id === null && row.menu_link_id === null));
        if (!exact) mismatches += 1;
      }
      legacyMappingChecks = { compared, mismatches };
    }

    let gompochaCheck: { expectedPhotoLinks: number; matchedMenus: number; missingMenus: number; photoLinks: number; photoBytesVerified: number } | null = null;
    if (zipPhotos.length) {
      const restaurant = await client.query<{ id: string; region: string | null; address: string | null; latitude: string | null; longitude: string | null }>(
        "SELECT id::text, region, address, latitude::text, longitude::text FROM public.restaurants WHERE name='곰포차 죽전점'",
      );
      let matchedMenus = 0;
      let missingMenus = 0;
      let photoLinks = 0;
      let photoBytesVerified = 0;
      const expectedPhotoLinks = zipPhotos.filter((photo) => photo.bytes.length <= 10_000_000).length;
      if (restaurant.rows.length === 1) {
        const targetRestaurant = restaurant.rows[0];
        for (const photo of zipPhotos) {
          if (!photo.menuName || photo.priceKrw === null) { missingMenus += 1; continue; }
          const menu = await client.query<{ id: string; cuisine_category: string; photo_media_id: string | null }>(
            "SELECT id::text, cuisine_category, photo_media_id::text FROM public.menus WHERE restaurant_id=$1::bigint AND name=$2 AND price_krw=$3",
            [targetRestaurant.id, photo.menuName, photo.priceKrw],
          );
          if (menu.rows.length !== 1 || menu.rows[0].cuisine_category !== "PUB") { missingMenus += 1; continue; }
          matchedMenus += 1;
          if (!menu.rows[0].photo_media_id) continue;
          const attached = mediaRows.rows.find((row) => row.id === menu.rows[0].photo_media_id && row.menu_id === menu.rows[0].id && row.lifecycle_status === "ACTIVE");
          if (!attached) continue;
          photoLinks += 1;
          const { data, error } = await storage.storage.from(BUCKET).download(attached.object_path);
          if (!error && data) {
            const bytes = Buffer.from(await data.arrayBuffer());
            if (bytes.length === photo.bytes.length && sha256(bytes) === photo.sha256) photoBytesVerified += 1;
          }
        }
        if (targetRestaurant.region !== "죽전" || targetRestaurant.address !== null || targetRestaurant.latitude !== null || targetRestaurant.longitude !== null) {
          throw new Error("Gompocha target restaurant contains details outside the approved ZIP-only seed facts.");
        }
      } else missingMenus += zipPhotos.length;
      gompochaCheck = { expectedPhotoLinks, matchedMenus, missingMenus, photoLinks, photoBytesVerified };
    }

    const orphanOrMismatchedLinks = Number(summary.rows[0].orphanLinks);
    const activeAssetsWithoutLink = Number(summary.rows[0].missingLinks);
    const linkedAssetsNotActive = Number(summary.rows[0].invalidActiveLinks);
    const mediaChecksOk = failedObjects === 0 && orphanOrMismatchedLinks === 0 && activeAssetsWithoutLink === 0 &&
      linkedAssetsNotActive === 0 && (!legacyMappingChecks || legacyMappingChecks.mismatches === 0) &&
      (!gompochaCheck || (gompochaCheck.missingMenus === 0 && gompochaCheck.photoBytesVerified === gompochaCheck.expectedPhotoLinks));
    return {
      ok: mediaChecksOk,
      mode: "read-only-local-disposable-inspection",
      counts: { ...summary.rows[0], v6PhotoUrls },
      activeStorage: { expectedActive: Number(summary.rows[0].active), verifiedObjects, failedObjects },
      integrity: { orphanOrMismatchedLinks, activeAssetsWithoutLink, linkedAssetsNotActive },
      legacyMappingChecks,
      gompochaCheck,
      writes: "none; DB and Storage were accessed read-only; source ZIP and export were read-only",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const artifact = options.inputPath ? await readImportArtifact(options.inputPath, REPO_ROOT) : null;
  const zipPhotos = options.zipPath ? await inspectUserPhotoZip(options.zipPath) : [];
  const sourceCounts = artifact ? inspectSourceMapping(artifact) : null;
  const sourceBytes = { found: 0, missing: 0 };
  if (artifact && options.sourceRoot) {
    const root = await realpath(options.sourceRoot);
    for (const media of artifact.data.mediaAssets) {
      const bytes = await readSourceFile(root, media.storageKey);
      if (!bytes) { sourceBytes.missing += 1; continue; }
      validateSourceBytes(bytes, media);
      sourceBytes.found += 1;
    }
    for (const menu of artifact.data.menus.filter((row) => row.photoUrl)) {
      const key = menu.photoUrl!.replace(/^\//, "");
      const bytes = await readSourceFile(root, key);
      if (bytes) sourceBytes.found += 1;
      else sourceBytes.missing += 1;
    }
  }
  const localTarget = options.inspectLocalTarget ? await inspectLocalTarget(options, artifact, zipPhotos) : null;
  const sourceOk = (!sourceCounts || sourceCounts.duplicateLinks === 0) && (!options.sourceRoot || sourceBytes.missing === 0);
  const ok = sourceOk && (!localTarget || localTarget.ok);
  const report = {
    format: "yum-review.media-verification/v1",
    createdAt: new Date().toISOString(),
    readOnly: true,
    ok,
    sourceExport: artifact ? {
      format: artifact.manifest.format,
      declaredMediaAssets: artifact.data.mediaAssets.length,
      reviewPhotoRows: artifact.data.reviewPhotos.length,
      menuPhotoMediaRefs: artifact.data.menus.filter((menu) => Boolean(menu.photoMediaId)).length,
      v6StaticMenuPhotoUrls: sourceCounts?.v6PhotoUrls ?? 0,
      sourceCounts,
      rightsMetadata: "compared/preserved as source fields only; no rights claim is invented by this verifier",
    } : null,
    sourceFiles: options.sourceRoot ? sourceBytes : null,
    userPhotoZip: options.zipPath ? {
      imageCount: zipPhotos.length,
      totalBytes: zipPhotos.reduce((sum, photo) => sum + photo.bytes.length, 0),
      filenameMenuPriceCandidates: zipPhotos.map((photo) => ({ entryName: photo.entryName, menuName: photo.menuName, priceKrw: photo.priceKrw, sha256: photo.sha256 })),
      preservation: "read only; original ZIP was not extracted, moved, renamed, or changed",
    } : null,
    localTarget,
    hostedServicesConnected: false,
    note: options.inspectLocalTarget
      ? "Local target inspection is read-only and requires explicit loopback target settings. It does not inspect hosted or production services."
      : "Source inventory only; no database or Storage connection was made.",
  };
  if (options.reportOut) await writePrivateJson(options.reportOut, report);
  process.stdout.write(JSON.stringify({
    ok,
    mode: options.inspectLocalTarget ? "read-only-local-disposable-inspection" : "dry-run-source-inventory",
    sourceMediaCount: artifact?.data.mediaAssets.length ?? 0,
    sourceV6PhotoCount: sourceCounts?.v6PhotoUrls ?? 0,
    zipImageCount: zipPhotos.length,
    localTargetInspected: Boolean(localTarget),
    reportOut: options.reportOut ? "written-outside-repository" : "not-written",
    noWrites: true,
  }) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(() => {
    process.stderr.write("Media verification stopped safely. No database or source files were changed; sensitive details were withheld.\n");
    process.exitCode = 1;
  });
}
