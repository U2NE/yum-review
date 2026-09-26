import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { chmod, lstat, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { inspectImageHeader, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, OPTIMIZE_IMAGE_BYTES } from "@/lib/media/validate-image";
import { assertLocalUrl, readImportArtifact, type ExportMedia, type ImportArtifact } from "./import-supabase";

const execFileAsync = promisify(execFile);
const BUCKET = "yum-review-media";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_ZIP_BYTES = 500_000_000;
const MAX_ZIP_ENTRIES = 1_000;
const MAX_UNCOMPRESSED_BYTES = 2_000_000_000;

type ZipImage = {
  entryName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  sha256: string;
  width: number;
  height: number;
  menuName: string | null;
  priceKrw: number | null;
};

type Options = {
  inputPath?: string;
  zipPath?: string;
  sourceRoot?: string;
  manifestOut?: string;
  databaseUrlEnv?: string;
  supabaseUrlEnv?: string;
  serviceKeyEnv?: string;
  apply: boolean;
  localDisposableTarget: boolean;
  seedGompocha: boolean;
  zipUploaderAuthId?: string;
};

type MediaRef =
  | { kind: "MENU"; id: string }
  | { kind: "REVIEW"; id: string; sortOrder: number; createdAt: string };

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  let localDisposableTarget = false;
  let seedGompocha = false;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--help" || key === "-h") {
      process.stdout.write(
        "Usage: npx tsx scripts/migrate/import-media.ts (--input <private-export> | --zip <user-zip>) [--source-root <legacy-media-root>] [--manifest-out <private-path>] [--seed-gompocha] [--zip-uploader-auth-id <existing-owner-or-admin-uuid>] [--apply --local-disposable-target --database-url-env <ENV> --supabase-url-env <ENV> --service-key-env <ENV>]\n",
      );
      process.exit(0);
    }
    if (key === "--apply") { apply = true; continue; }
    if (key === "--local-disposable-target") { localDisposableTarget = true; continue; }
    if (key === "--seed-gompocha") { seedGompocha = true; continue; }
    if (!key?.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--") || values.has(key)) {
      throw new Error("Media importer arguments are invalid.");
    }
    values.set(key, argv[i + 1]);
    i += 1;
  }
  const allowed = new Set([
    "--input", "--zip", "--source-root", "--manifest-out", "--database-url-env", "--supabase-url-env", "--service-key-env", "--zip-uploader-auth-id",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error("Media importer has an unsupported option.");
  const inputPath = values.get("--input");
  const zipPath = values.get("--zip");
  if (!inputPath && !zipPath) throw new Error("Provide a private export, a user ZIP, or both.");
  if (seedGompocha && !zipPath) throw new Error("Gompocha seeding requires the user-provided ZIP.");
  if (apply && !seedGompocha && !(inputPath && values.has("--source-root"))) {
    throw new Error("Local apply requires either --seed-gompocha with the ZIP or a private export plus its legacy --source-root bytes.");
  }
  if (seedGompocha && apply && !values.has("--zip-uploader-auth-id")) {
    throw new Error("Local Gompocha photo import requires an explicit existing owner/admin Auth UUID.");
  }
  if (apply !== localDisposableTarget) throw new Error("Writes require both --apply and --local-disposable-target.");
  if (apply && (!values.has("--database-url-env") || !values.has("--supabase-url-env") || !values.has("--service-key-env"))) {
    throw new Error("Local apply requires explicit local target environment variable names.");
  }
  if (!apply && ["--database-url-env", "--supabase-url-env", "--service-key-env"].some((key) => values.has(key))) {
    throw new Error("Target credentials are accepted only with explicit local apply mode.");
  }
  for (const key of ["--database-url-env", "--supabase-url-env", "--service-key-env"]) {
    const value = values.get(key);
    if (value && !/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new Error("Target options must name environment variables.");
  }
  return {
    inputPath: inputPath ? path.resolve(inputPath) : undefined,
    zipPath: zipPath ? path.resolve(zipPath) : undefined,
    sourceRoot: values.has("--source-root") ? path.resolve(values.get("--source-root")!) : undefined,
    manifestOut: values.has("--manifest-out") ? path.resolve(values.get("--manifest-out")!) : undefined,
    databaseUrlEnv: values.get("--database-url-env"),
    supabaseUrlEnv: values.get("--supabase-url-env"),
    serviceKeyEnv: values.get("--service-key-env"),
    apply,
    localDisposableTarget,
    seedGompocha,
    zipUploaderAuthId: values.get("--zip-uploader-auth-id"),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function safeArchiveName(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("\0")) {
    throw new Error("The user ZIP contains an unsafe entry path.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === ".")) throw new Error("The user ZIP contains an unsafe entry path.");
  return parts.join("/");
}

function menuFromFilename(entryName: string): { menuName: string | null; priceKrw: number | null } {
  const base = path.posix.basename(entryName).replace(/\.(?:jpe?g|png|webp)$/i, "");
  const match = base.match(/^(.+),\s*([0-9][0-9,]*)\s*원$/u);
  if (!match) return { menuName: null, priceKrw: null };
  const priceKrw = Number(match[2].replaceAll(",", ""));
  const menuName = match[1].trim();
  if (!menuName || !Number.isSafeInteger(priceKrw) || priceKrw < 0) return { menuName: null, priceKrw: null };
  return { menuName, priceKrw };
}

function supportedTypeForName(name: string): string | null {
  const extension = path.posix.extname(name).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
}

export async function inspectUserPhotoZip(zipPath: string): Promise<ZipImage[]> {
  const info = await lstat(zipPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 22 || info.size > MAX_ZIP_BYTES) {
    throw new Error("User ZIP must be a regular archive within the supported size.");
  }
  const archive = await readFile(zipPath);
  const minimum = Math.max(0, archive.length - 65_557);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("User ZIP directory could not be read safely.");
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const directoryDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const directorySize = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  if (
    diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount ||
    entryCount > MAX_ZIP_ENTRIES || directoryOffset + directorySize > eocd ||
    entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff
  ) {
    throw new Error("Multi-volume and ZIP64 archives are not supported by this inventory tool.");
  }

  const results: ZipImage[] = [];
  const names = new Set<string>();
  let offset = directoryOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("User ZIP directory contains an invalid record.");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const expectedCrc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > archive.length || localOffset + 30 > archive.length) throw new Error("User ZIP entry is truncated.");
    const entryName = safeArchiveName(archive.toString("utf8", offset + 46, offset + 46 + nameLength));
    if (names.has(entryName)) throw new Error("User ZIP contains a duplicate entry name.");
    names.add(entryName);
    const mode = externalAttributes >>> 16;
    if ((mode & 0o170000) === 0o120000) throw new Error("Symbolic links are not accepted in the user ZIP.");
    if ((flags & 0x0001) !== 0) throw new Error("Encrypted ZIP entries cannot be inventoried.");
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("User ZIP expands beyond the safe inventory limit.");

    const contentType = supportedTypeForName(entryName);
    if (!contentType || entryName.endsWith("/")) { offset = end; continue; }
    if (uncompressedSize < 1 || uncompressedSize >= MAX_IMAGE_BYTES) throw new Error("A ZIP photo is outside the accepted 100 MB limit.");
    if (compression !== 0 && compression !== 8) throw new Error("A ZIP photo uses an unsupported compression method.");
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("User ZIP entry header is invalid.");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) throw new Error("User ZIP photo data is truncated.");
    const compressed = archive.subarray(dataStart, dataEnd);
    let bytes: Buffer;
    try { bytes = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_IMAGE_BYTES }); }
    catch { throw new Error("A ZIP photo could not be safely decompressed."); }
    if (bytes.length !== uncompressedSize || crc32(bytes) !== expectedCrc) throw new Error("A ZIP photo failed its size or CRC check.");
    const header = inspectImageHeader(bytes);
    if (!header || header.contentType !== contentType) throw new Error("A ZIP photo's extension and image signature do not match.");
    if (header.width > MAX_IMAGE_SIDE || header.height > MAX_IMAGE_SIDE || header.width * header.height > MAX_IMAGE_PIXELS) {
      throw new Error("A ZIP photo exceeds the safe image dimensions.");
    }
    results.push({
      entryName,
      contentType: header.contentType,
      bytes,
      sha256: sha256(bytes),
      width: header.width,
      height: header.height,
      ...menuFromFilename(entryName),
    });
    offset = end;
  }
  return results.sort((left, right) => left.entryName.localeCompare(right.entryName, "ko"));
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s\p{P}\p{S}]/gu, "");
}

function mapArchiveToSourceMenus(artifact: ImportArtifact | null, photos: ZipImage[]) {
  if (!artifact) return photos.map((photo) => ({ entryName: photo.entryName, menuName: photo.menuName, priceKrw: photo.priceKrw, sourceMatch: "target-check-required" }));
  const restaurants = artifact.data.restaurants.filter((restaurant) => normalizedName(restaurant.name) === normalizedName("곰포차 죽전점"));
  const restaurantIds = new Set(restaurants.map((row) => row.id));
  return photos.map((photo) => {
    if (!photo.menuName || photo.priceKrw === null) return { entryName: photo.entryName, menuName: null, priceKrw: null, sourceMatch: "filename-unparsed" };
    const matches = artifact.data.menus.filter((menu) => restaurantIds.has(menu.restaurantId) && normalizedName(menu.name) === normalizedName(photo.menuName!) && menu.priceKrw === photo.priceKrw);
    return {
      entryName: photo.entryName,
      menuName: photo.menuName,
      priceKrw: photo.priceKrw,
      sourceMatch: matches.length === 1 ? "exact-source-menu" : matches.length === 0 ? "target-check-required" : "ambiguous-source-menu",
      sourceMenuId: matches.length === 1 ? matches[0].id : undefined,
    };
  });
}

async function ensurePrivateOutput(outputPath: string): Promise<string> {
  const parent = await realpath(path.dirname(outputPath));
  const resolved = path.join(parent, path.basename(outputPath));
  const relative = path.relative(REPO_ROOT, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Private media manifest must be written outside the repository.");
  }
  try { await lstat(resolved); throw new Error("Media manifest destination already exists."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return resolved;
}

async function restrictWindowsAcl(filePath: string): Promise<void> {
  const { stdout } = await execFileAsync("whoami", ["/user", "/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 16_384 });
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error("Could not establish a private manifest ACL.");
  await execFileAsync("icacls", [filePath, "/inheritance:r", "/grant:r", `*${sid}:(F)`], { windowsHide: true, maxBuffer: 16_384 });
}

export async function writePrivateJson(outputPath: string, value: unknown): Promise<void> {
  const target = await ensurePrivateOutput(outputPath);
  const handle = await open(target, "wx", 0o600);
  try {
    if (process.platform === "win32") await restrictWindowsAcl(target);
    else {
      await chmod(target, 0o600);
      if (((await stat(target)).mode & 0o077) !== 0) throw new Error("Could not make the manifest private.");
    }
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  await handle.close();
}

function mediaRefs(artifact: ImportArtifact): Map<string, MediaRef[]> {
  const refs = new Map<string, MediaRef[]>();
  const add = (legacyId: string, ref: MediaRef) => refs.set(legacyId, [...(refs.get(legacyId) ?? []), ref]);
  for (const menu of artifact.data.menus) if (menu.photoMediaId) add(menu.photoMediaId, { kind: "MENU", id: menu.id });
  for (const photo of artifact.data.reviewPhotos) add(photo.mediaId, {
    kind: "REVIEW", id: photo.reviewId, sortOrder: photo.sortOrder, createdAt: photo.createdAt,
  });
  return refs;
}

function sourceMediaPath(root: string, key: string): string {
  if (!key || key.includes("\\") || path.posix.isAbsolute(key) || key.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Legacy media key is not a safe relative path.");
  }
  return path.resolve(root, ...key.split("/"));
}

async function readContainedFile(root: string, key: string): Promise<Buffer | null> {
  const rootReal = await realpath(root);
  const target = sourceMediaPath(rootReal, key);
  const real = await realpath(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!real) return null;
  const relative = path.relative(rootReal, real);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Legacy media resolves outside its read-only source directory.");
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size >= MAX_IMAGE_BYTES) throw new Error("Legacy media file is not a supported regular file.");
  return readFile(real);
}

function validateBinary(bytes: Buffer, expectedType: string, expectedHash?: string, expectedLength?: string | number): void {
  const header = inspectImageHeader(bytes);
  if (!header || header.contentType !== expectedType) throw new Error("A source photo failed image signature checks.");
  if (header.width > MAX_IMAGE_SIDE || header.height > MAX_IMAGE_SIDE || header.width * header.height > MAX_IMAGE_PIXELS) {
    throw new Error("A source photo exceeds the safe image dimensions.");
  }
  if (expectedLength !== undefined && bytes.length !== Number(expectedLength)) throw new Error("A source photo byte count does not match its recorded metadata.");
  if (expectedHash && sha256(bytes) !== expectedHash.toLowerCase()) throw new Error("A source photo checksum does not match its recorded metadata.");
}

function getRequiredEnv(name: string | undefined): string {
  if (!name) throw new Error("A local target variable name is required.");
  const value = process.env[name];
  if (!value) throw new Error(`The explicitly named local target variable ${name} is not set.`);
  return value;
}

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  throw new Error("Unsupported image content type.");
}

function targetUserForLegacy(artifact: ImportArtifact, legacyId: string): string {
  const match = artifact.data.users.find((user) => user.legacyUserId === legacyId);
  if (!match) throw new Error("Legacy media uploader mapping is missing.");
  return match.targetAuthUserId;
}

async function inventoryLocalTarget(client: Client) {
  const { rows } = await client.query<{
    mediaAssets: string; reviewPhotos: string; menuPhotoRefs: string; staticPhotoColumn: boolean;
    pending: string; deletePending: string;
  }>(`SELECT
      (SELECT count(*) FROM public.media_assets)::text AS "mediaAssets",
      (SELECT count(*) FROM public.review_photos)::text AS "reviewPhotos",
      (SELECT count(*) FROM public.menus WHERE photo_media_id IS NOT NULL)::text AS "menuPhotoRefs",
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='menus' AND column_name='photo_url') AS "staticPhotoColumn",
      (SELECT count(*) FROM public.media_assets WHERE lifecycle_status='PENDING')::text AS pending,
      (SELECT count(*) FROM public.media_assets WHERE lifecycle_status='DELETE_PENDING')::text AS "deletePending"`);
  let staticPhotoRefs = "0";
  if (rows[0]?.staticPhotoColumn) {
    const staticRows = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM public.menus WHERE photo_url IS NOT NULL");
    staticPhotoRefs = staticRows.rows[0]?.count ?? "0";
  }
  return { ...rows[0], staticPhotoRefs };
}

async function seedGompochaMenus(client: Client, photos: ZipImage[]) {
  const entries = photos.map((photo) => ({ name: photo.menuName, priceKrw: photo.priceKrw }));
  if (entries.some((entry) => !entry.name || entry.priceKrw === null)) throw new Error("Every Gompocha ZIP filename must include `메뉴명, 가격원` before seeding.");
  const uniqueNames = new Set<string>();
  for (const entry of entries) {
    const nameKey = normalizedName(entry.name!);
    if (uniqueNames.has(nameKey)) throw new Error("The Gompocha ZIP contains duplicate menu names; catalog seeding stopped before writes.");
    uniqueNames.add(nameKey);
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const existingRestaurants = await client.query<{
      id: string; name: string; description: string | null; address: string | null; region: string | null;
      latitude: string | null; longitude: string | null;
    }>(`SELECT id::text, name, description, address, region, latitude::text, longitude::text
        FROM public.restaurants WHERE name = $1 FOR UPDATE`, ["곰포차 죽전점"]);
    let restaurantId: string;
    if (existingRestaurants.rows.length > 1) throw new Error("Gompocha restaurant identity is ambiguous.");
    if (existingRestaurants.rows[0]) {
      const row = existingRestaurants.rows[0];
      const exact = row.name === "곰포차 죽전점" && row.description === null && row.address === null &&
        row.region === "죽전" && row.latitude === null && row.longitude === null;
      if (!exact) throw new Error("Existing Gompocha restaurant row conflicts with the approved source; nothing was overwritten.");
      restaurantId = row.id;
    } else {
      const inserted = await client.query<{ id: string }>(`INSERT INTO public.restaurants (name, description, address, region, latitude, longitude)
        VALUES ('곰포차 죽전점', NULL, NULL, '죽전', NULL, NULL) RETURNING id::text`);
      restaurantId = inserted.rows[0].id;
    }

    const planned: Array<{ name: string; priceKrw: number; action: "insert" | "exact_skip" }> = [];
    for (const entry of entries) {
      const rows = await client.query<{
        id: string; description: string | null; price_krw: number | null; cuisine_category: string; active: boolean;
      }>(`SELECT id::text, description, price_krw, cuisine_category, active
          FROM public.menus WHERE restaurant_id=$1 AND name=$2 FOR UPDATE`, [restaurantId, entry.name]);
      if (rows.rows.length > 1) throw new Error("Gompocha menu identity is ambiguous.");
      const existing = rows.rows[0];
      if (existing) {
        const exact = existing.description === null && existing.price_krw === entry.priceKrw &&
          existing.cuisine_category === "PUB" && existing.active === true;
        if (!exact) throw new Error(`Existing Gompocha menu row conflicts with the approved filename data: ${entry.name}. Nothing was overwritten.`);
        planned.push({ name: entry.name!, priceKrw: entry.priceKrw!, action: "exact_skip" });
      } else {
        planned.push({ name: entry.name!, priceKrw: entry.priceKrw!, action: "insert" });
      }
    }

    for (const entry of planned) {
      if (entry.action === "insert") {
        await client.query(`INSERT INTO public.menus (restaurant_id, name, description, price_krw, cuisine_category, active)
          VALUES ($1, $2, NULL, $3, 'PUB', true)`, [restaurantId, entry.name, entry.priceKrw]);
      }
    }
    await client.query("COMMIT");
    return { restaurantId, rows: planned };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function assertZipUploader(client: Client, authId: string, restaurantId?: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authId)) {
    throw new Error("ZIP uploader must be an explicit existing Auth UUID.");
  }
  const { rows } = await client.query<{ user_exists: boolean; is_server_admin: boolean; is_restaurant_owner: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id=$1::uuid) AS user_exists,
       EXISTS (SELECT 1 FROM private.user_roles AS ur WHERE ur.user_id=$1::uuid AND ur.role_code='SERVER_ADMIN') AS is_server_admin,
       CASE WHEN $2::bigint IS NULL THEN false ELSE EXISTS (
         SELECT 1 FROM private.restaurant_owners AS ro WHERE ro.user_id=$1::uuid AND ro.restaurant_id=$2::bigint
       ) END AS is_restaurant_owner`,
    [authId, restaurantId ?? null],
  );
  const access = rows[0];
  if (!access?.user_exists) throw new Error("The explicit ZIP uploader UUID does not identify an existing local Auth account.");
  if (restaurantId && !access.is_server_admin && !access.is_restaurant_owner) {
    throw new Error("ZIP photo import requires the uploader to own Gompocha Jukjeon or be a server admin.");
  }
}

async function assertGompochaSeedAccess(client: Client, authId: string): Promise<void> {
  const restaurants = await client.query<{ id: string }>("SELECT id::text FROM public.restaurants WHERE name='곰포차 죽전점'");
  if (restaurants.rows.length > 1) throw new Error("Gompocha restaurant identity is ambiguous.");
  if (restaurants.rows[0]) {
    await assertZipUploader(client, authId, restaurants.rows[0].id);
    return;
  }
  await assertZipUploader(client, authId);
  const role = await client.query<{ is_server_admin: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM private.user_roles WHERE user_id=$1::uuid AND role_code='SERVER_ADMIN') AS is_server_admin",
    [authId],
  );
  if (!role.rows[0]?.is_server_admin) {
    throw new Error("Creating the Gompocha restaurant requires an existing local server administrator; no catalog rows were written.");
  }
}

async function localStoredObjectMatches(
  admin: ReturnType<typeof createClient>,
  objectPath: string,
  expectedHash: string,
  expectedLength: number,
): Promise<boolean> {
  const { data, error } = await admin.storage.from(BUCKET).download(objectPath);
  if (error || !data) return false;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== expectedLength || sha256(bytes) !== expectedHash) {
    throw new Error("A local Storage object already uses this path with different bytes; it was preserved.");
  }
  return true;
}

async function importGompochaPhotos(
  client: Client,
  admin: ReturnType<typeof createClient>,
  restaurantId: string,
  uploaderId: string,
  photos: ZipImage[],
): Promise<{ uploaded: number; exactPhotoSkips: number; optimizedThroughUi: number }> {
  await assertZipUploader(client, uploaderId, restaurantId);
  let uploaded = 0;
  let exactPhotoSkips = 0;
  let optimizedThroughUi = 0;

  for (const photo of photos) {
    if (!photo.menuName || photo.priceKrw === null) throw new Error("A Gompocha photo filename could not be mapped to a menu name and price.");
    validateBinary(photo.bytes, photo.contentType, photo.sha256, photo.bytes.length);
    if (photo.bytes.length > OPTIMIZE_IMAGE_BYTES) {
      // There is no Node image encoder in the approved dependency set. Keep the
      // archive intact and let the browser upload path perform its optimization.
      optimizedThroughUi += 1;
      continue;
    }

    const menuResult = await client.query<{
      id: string; description: string | null; price_krw: number | null; cuisine_category: string; active: boolean;
      photo_media_id: string | null;
    }>(`SELECT id::text, description, price_krw, cuisine_category, active, photo_media_id::text
        FROM public.menus WHERE restaurant_id=$1 AND name=$2`, [restaurantId, photo.menuName]);
    if (menuResult.rows.length !== 1) throw new Error("A ZIP menu name did not resolve to one exact local menu row.");
    const menu = menuResult.rows[0];
    if (menu.description !== null || menu.price_krw !== photo.priceKrw || menu.cuisine_category !== "PUB" || !menu.active) {
      throw new Error("A local Gompocha menu conflicts with the ZIP filename data; photo import stopped.");
    }

    if (menu.photo_media_id) {
      const { rows } = await client.query<{
        sha256_hex: string | null; content_type: string; original_bytes: string; stored_bytes: string; lifecycle_status: string; object_path: string;
      }>(
        "SELECT sha256_hex, content_type, original_bytes::text, stored_bytes::text, lifecycle_status, object_path FROM public.media_assets WHERE id=$1::uuid AND menu_id=$2",
        [menu.photo_media_id, menu.id],
      );
      if (rows.length === 1 && rows[0].sha256_hex?.toLowerCase() === photo.sha256 &&
          rows[0].content_type === photo.contentType && Number(rows[0].original_bytes) === photo.bytes.length &&
          Number(rows[0].stored_bytes) === photo.bytes.length && rows[0].lifecycle_status === "ACTIVE" &&
          await localStoredObjectMatches(admin, rows[0].object_path, photo.sha256, photo.bytes.length)) {
        exactPhotoSkips += 1;
        continue;
      }
      throw new Error("A Gompocha menu already has a different photo; the existing image was preserved.");
    }

    const lockKey = `gompocha-photo:${menu.id}:${uploaderId}:${photo.sha256}`;
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    let mediaId: string;
    let objectPath: string;
    try {
      await client.query("SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))", [lockKey]);
      const candidates = await client.query<{
        id: string; object_path: string; lifecycle_status: string; content_type: string; original_bytes: string;
        stored_bytes: string; sha256_hex: string | null;
      }>(`SELECT id::text, object_path, lifecycle_status, content_type, original_bytes::text, stored_bytes::text, sha256_hex
          FROM public.media_assets WHERE media_kind='MENU' AND menu_id=$1 AND uploaded_by=$2::uuid AND sha256_hex=$3
          ORDER BY id FOR UPDATE`, [menu.id, uploaderId, photo.sha256]);
      if (candidates.rows.length > 1) throw new Error("Duplicate local media identities conflict for this menu photo.");
      if (candidates.rows[0]) {
        const existing = candidates.rows[0];
        if (!['PENDING', 'ACTIVE'].includes(existing.lifecycle_status) || existing.content_type !== photo.contentType ||
            Number(existing.original_bytes) !== photo.bytes.length || Number(existing.stored_bytes) !== photo.bytes.length ||
            existing.sha256_hex?.toLowerCase() !== photo.sha256) {
          throw new Error("A prior Gompocha photo import has conflicting media metadata.");
        }
        mediaId = existing.id;
        objectPath = existing.object_path;
      } else {
        mediaId = randomUUID();
        objectPath = `menu/${uploaderId}/${mediaId}.${extensionFor(photo.contentType)}`;
        await client.query(`INSERT INTO public.media_assets (
            id, object_path, media_kind, uploaded_by, menu_id, review_id, content_type,
            original_bytes, stored_bytes, sha256_hex, lifecycle_status
          ) VALUES ($1::uuid, $2, 'MENU', $3::uuid, $4, NULL, $5, $6, $6, $7, 'PENDING')`,
        [mediaId, objectPath, uploaderId, menu.id, photo.contentType, photo.bytes.length, photo.sha256]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const existingObject = await localStoredObjectMatches(admin, objectPath, photo.sha256, photo.bytes.length);
    if (!existingObject) {
      const { error } = await admin.storage.from(BUCKET).upload(
        objectPath,
        new Blob([Uint8Array.from(photo.bytes)], { type: photo.contentType }),
        { contentType: photo.contentType, cacheControl: "3600", upsert: false },
      );
      if (error) {
        const appearedAfterFailure = await localStoredObjectMatches(admin, objectPath, photo.sha256, photo.bytes.length);
        if (!appearedAfterFailure) throw new Error("A user-provided photo could not be uploaded to local Storage; the ZIP remains unchanged.");
      } else uploaded += 1;
    }
    if (!await localStoredObjectMatches(admin, objectPath, photo.sha256, photo.bytes.length)) {
      throw new Error("Uploaded photo bytes failed local Storage checksum verification.");
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      const row = await client.query<{ status: string; menu_photo_id: string | null }>(`SELECT a.lifecycle_status AS status, m.photo_media_id::text AS menu_photo_id
        FROM public.media_assets AS a JOIN public.menus AS m ON m.id=a.menu_id
        WHERE a.id=$1::uuid AND a.menu_id=$2 FOR UPDATE OF a, m`, [mediaId, menu.id]);
      if (!row.rows[0] || !["PENDING", "ACTIVE"].includes(row.rows[0].status)) throw new Error("Local media row changed before photo activation.");
      if (row.rows[0].menu_photo_id && row.rows[0].menu_photo_id !== mediaId) throw new Error("A different photo was attached concurrently; it was preserved.");
      const activation = await client.query(`UPDATE public.media_assets AS a
        SET lifecycle_status='ACTIVE', activated_at=COALESCE(a.activated_at, pg_catalog.now())
        WHERE a.id=$1::uuid AND a.menu_id=$2 AND a.uploaded_by=$3::uuid
          AND a.lifecycle_status IN ('PENDING', 'ACTIVE') AND a.sha256_hex=$4
          AND EXISTS (SELECT 1 FROM storage.objects AS o WHERE o.bucket_id=$5 AND o.name=a.object_path)`,
      [mediaId, menu.id, uploaderId, photo.sha256, BUCKET]);
      if (activation.rowCount !== 1) throw new Error("Local photo bytes or ownership failed the activation check.");
      if (!row.rows[0].menu_photo_id) {
        await client.query("UPDATE public.menus SET photo_media_id=$2::uuid WHERE id=$1 AND photo_media_id IS NULL", [menu.id, mediaId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  return { uploaded, exactPhotoSkips, optimizedThroughUi };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const artifact = options.inputPath ? await readImportArtifact(options.inputPath, REPO_ROOT) : null;
  const photos = options.zipPath ? await inspectUserPhotoZip(options.zipPath) : [];
  const photoRows = photos.map((photo) => ({
    entryName: photo.entryName,
    bytes: photo.bytes.length,
    contentType: photo.contentType,
    sha256: photo.sha256,
    width: photo.width,
    height: photo.height,
    menuName: photo.menuName,
    priceKrw: photo.priceKrw,
    sourceMatch: "not-yet-checked-against-local-target",
  }));
  const legacyInventory = artifact ? {
    mediaAssets: artifact.data.mediaAssets.map((media: ExportMedia) => ({
      legacyMediaId: media.mediaId,
      storageKey: media.storageKey,
      targetMediaId: media.targetMediaId,
      uploadedByLegacyUserId: media.uploadedByUserId,
      contentType: media.contentType,
      originalBytes: media.originalBytes,
      storedBytes: media.storedBytes,
      sha256Hex: media.sha256Hex,
      provenance: media.provenance,
      // Preserve only source-recorded fields; no import code adds rights claims.
      rightsBasis: media.rightsBasis,
      rightsAttestedAt: media.rightsAttestedAt,
      rightsAttestedByLegacyUserId: media.rightsAttestedByUserId,
      lifecycleStatus: media.lifecycleStatus,
      refs: (mediaRefs(artifact).get(media.mediaId) ?? []).map((ref) => ref),
    })),
    v6StaticMenuPhotos: artifact.data.menus.filter((menu) => menu.photoUrl).map((menu) => ({ menuId: menu.id, photoUrl: menu.photoUrl })),
    reviewPhotoCount: artifact.data.reviewPhotos.length,
    menuPhotoMediaReferenceCount: artifact.data.menus.filter((menu) => menu.photoMediaId).length,
  } : null;

  const sourceFiles: Record<string, { present: boolean; sha256?: string; bytes?: number }> = {};
  if (artifact && options.sourceRoot) {
    const root = await realpath(options.sourceRoot);
    for (const media of artifact.data.mediaAssets) {
      const bytes = await readContainedFile(root, media.storageKey);
      if (!bytes) { sourceFiles[media.mediaId] = { present: false }; continue; }
      validateBinary(bytes, media.contentType, media.sha256Hex, media.storedBytes);
      sourceFiles[media.mediaId] = { present: true, sha256: sha256(bytes), bytes: bytes.length };
    }
    for (const menu of artifact.data.menus.filter((row) => row.photoUrl)) {
      const relative = menu.photoUrl!.replace(/^\//, "");
      const bytes = await readContainedFile(root, relative);
      sourceFiles[`v6:${menu.id}`] = bytes
        ? { present: true, sha256: sha256(bytes), bytes: bytes.length }
        : { present: false };
    }
  }

  const manifest = {
    format: "yum-review.media-inventory/v1",
    createdAt: new Date().toISOString(),
    mode: options.apply ? "apply-local-disposable" : "dry-run",
    destructiveOperations: false,
    archive: options.zipPath ? {
      fileCount: photos.length,
      totalBytes: photos.reduce((sum, photo) => sum + photo.bytes.length, 0),
      filenameCandidates: mapArchiveToSourceMenus(artifact, photos),
      images: photoRows,
      preservation: "original ZIP remains unchanged; this command does not extract, move, rename, or delete archive entries",
    } : null,
    legacy: legacyInventory ? {
      ...legacyInventory,
      bytesFound: Object.values(sourceFiles).filter((entry) => entry.present).length,
      sourceFiles,
      v6Notice: "V6 photo_url files do not provide authenticated uploader/rights identity; inventory only until a verified mapping exists.",
    } : null,
    seededCatalog: options.seedGompocha ? {
      restaurant: { name: "곰포차 죽전점", region: "죽전", address: null, latitude: null, longitude: null },
      menuCategory: "PUB",
      menuCandidateCount: photos.length,
      priceAndNamesSource: "user-provided ZIP filenames only",
      conflictPolicy: "exact-match skip; any different existing row stops the transaction; no upsert or delete",
    } : null,
    notice: "A manifest is inventory evidence, not proof of hosted row counts or uploaded Storage bytes. No hosted URL is accepted.",
  };

  if (!options.apply) {
    if (options.manifestOut) await writePrivateJson(options.manifestOut, manifest);
    process.stdout.write(JSON.stringify({
      ok: true,
      mode: "dry-run",
      archiveImageCount: photos.length,
      archiveImageBytes: photos.reduce((sum, photo) => sum + photo.bytes.length, 0),
      legacyMediaCount: artifact?.data.mediaAssets.length ?? 0,
      v6StaticMenuPhotoCount: artifact?.data.menus.filter((menu) => menu.photoUrl).length ?? 0,
      sourceBytesFound: Object.values(sourceFiles).filter((entry) => entry.present).length,
      manifestOut: options.manifestOut ? "written-outside-repository" : "not-written",
      note: "No database or Storage connection was made.",
    }) + "\n");
    return;
  }

  const databaseUrl = getRequiredEnv(options.databaseUrlEnv);
  const supabaseUrl = getRequiredEnv(options.supabaseUrlEnv);
  const serviceKey = getRequiredEnv(options.serviceKeyEnv);
  assertLocalUrl(databaseUrl, "postgres");
  assertLocalUrl(supabaseUrl, "supabase");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = new Client({ connectionString: databaseUrl, application_name: "yum-review-local-media-import", statement_timeout: 60_000 });
  await client.connect();
  try {
    const existing = await inventoryLocalTarget(client);
    if (options.seedGompocha) await assertGompochaSeedAccess(client, options.zipUploaderAuthId!);
    const seed = options.seedGompocha ? await seedGompochaMenus(client, photos) : null;
    const gompochaPhotos = seed
      ? await importGompochaPhotos(client, admin, seed.restaurantId, options.zipUploaderAuthId!, photos)
      : { uploaded: 0, exactPhotoSkips: 0, optimizedThroughUi: 0 };
    const copiedLegacyMedia = artifact && options.sourceRoot
      ? await importLegacyMedia(client, admin, artifact, options.sourceRoot)
      : { uploaded: 0, exactObjectSkips: 0, deferred: artifact?.data.mediaAssets.length ?? 0 };
    const result = {
      ok: true,
      mode: "apply",
      target: "local-disposable",
      before: existing,
      seededCatalog: seed ? {
        restaurantId: seed.restaurantId,
        insertedMenus: seed.rows.filter((row) => row.action === "insert").length,
        exactMenuSkips: seed.rows.filter((row) => row.action === "exact_skip").length,
      } : null,
      gompochaPhotos,
      legacyMedia: copiedLegacyMedia,
      userZipPhotoBytes: "uploaded directly to local Storage only after an explicit existing uploader UUID was verified as restaurant owner/server admin",
      writes: "local target only; source files and original ZIP were read only",
    };
    if (options.manifestOut) await writePrivateJson(options.manifestOut, { ...manifest, localApplyResult: result });
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function importLegacyMedia(
  client: Client,
  admin: ReturnType<typeof createClient>,
  artifact: ImportArtifact,
  sourceRoot: string,
): Promise<{ uploaded: number; exactObjectSkips: number; deferred: number }> {
  const root = await realpath(sourceRoot);
  const refs = mediaRefs(artifact);
  let uploaded = 0;
  let exactObjectSkips = 0;
  let deferred = 0;
  const objectsToActivate: Array<{ media: ExportMedia; ref: MediaRef; objectPath: string }> = [];

  for (const media of artifact.data.mediaAssets) {
    const mediaReferences = refs.get(media.mediaId) ?? [];
    if (mediaReferences.length !== 1 || media.lifecycleStatus !== "ACTIVE") { deferred += 1; continue; }
    const ref = mediaReferences[0];
    const bytes = await readContainedFile(root, media.storageKey);
    if (!bytes) { deferred += 1; continue; }
    validateBinary(bytes, media.contentType, media.sha256Hex, media.storedBytes);
    const uploaderId = targetUserForLegacy(artifact, media.uploadedByUserId);
    const ext = extensionFor(media.contentType);
    const objectPath = `${ref.kind.toLowerCase()}/${uploaderId}/${media.targetMediaId}.${ext}`;
    const { rows } = await client.query<{
      id: string; object_path: string; media_kind: string; uploaded_by: string; menu_id: string | null; review_id: string | null;
      content_type: string; original_bytes: string; stored_bytes: string; sha256_hex: string | null; lifecycle_status: string;
      legacy_media_id: string | null;
    }>(`SELECT a.id::text, a.object_path, a.media_kind, a.uploaded_by::text, a.menu_id::text, a.review_id::text,
        a.content_type, a.original_bytes::text, a.stored_bytes::text, a.sha256_hex, a.lifecycle_status,
        li.legacy_media_id
      FROM public.media_assets AS a
      LEFT JOIN private.legacy_media_asset_identity AS li ON li.media_id = a.id
      WHERE a.id = $1::uuid OR a.object_path = $2`, [media.targetMediaId, objectPath]);
    if (rows.length !== 1) throw new Error("Local media target identity is missing or conflicts; import stopped.");
    const target = rows[0];
    const expectedMenu = ref.kind === "MENU" ? ref.id : null;
    const expectedReview = ref.kind === "REVIEW" ? ref.id : null;
    const rights = await client.query<{
      exact: boolean;
    }>(`SELECT (rights_basis IS NOT DISTINCT FROM $2
          AND rights_attested_at IS NOT DISTINCT FROM $3::timestamptz
          AND rights_attested_legacy_user_id IS NOT DISTINCT FROM $4::bigint) AS exact
        FROM private.legacy_media_rights WHERE legacy_media_id=$1`,
      [media.mediaId, media.rightsBasis, media.rightsAttestedAt, media.rightsAttestedByUserId]);
    const exactRights = rights.rows.length === 1 && rights.rows[0].exact === true;
    const exact = target.id === media.targetMediaId && target.object_path === objectPath && target.media_kind === ref.kind &&
      target.uploaded_by === uploaderId && target.menu_id === expectedMenu && target.review_id === expectedReview &&
      target.content_type === media.contentType && target.original_bytes === media.originalBytes &&
      target.stored_bytes === media.storedBytes && target.sha256_hex?.toLowerCase() === media.sha256Hex.toLowerCase() &&
      target.legacy_media_id === media.mediaId && exactRights;
    if (!exact) throw new Error("Local media metadata conflicts with the source identity; nothing was overwritten.");
    if (!["PENDING", "ACTIVE"].includes(target.lifecycle_status)) { deferred += 1; continue; }

    const { data: existingObject, error: downloadError } = await admin.storage.from(BUCKET).download(objectPath);
    if (existingObject && !downloadError) {
      const existingBytes = Buffer.from(await existingObject.arrayBuffer());
      if (sha256(existingBytes) !== media.sha256Hex.toLowerCase() || existingBytes.length !== Number(media.storedBytes)) {
        throw new Error("An existing local Storage object has different bytes; it was preserved and import stopped.");
      }
      exactObjectSkips += 1;
    } else {
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(
        objectPath,
        new Blob([Uint8Array.from(bytes)], { type: media.contentType }),
        { contentType: media.contentType, cacheControl: "3600", upsert: false },
      );
      if (uploadError) throw new Error("A legacy photo could not be uploaded to local Storage; source bytes were preserved.");
      uploaded += 1;
    }
    objectsToActivate.push({ media, ref, objectPath });
  }

  if (objectsToActivate.length) {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      for (const { media, ref } of objectsToActivate) {
        const updated = await client.query(`UPDATE public.media_assets AS a
          SET lifecycle_status = 'ACTIVE', activated_at = COALESCE(a.activated_at, pg_catalog.now())
          WHERE a.id = $1::uuid AND a.lifecycle_status IN ('PENDING', 'ACTIVE')
            AND EXISTS (SELECT 1 FROM storage.objects AS o WHERE o.bucket_id=$2 AND o.name=a.object_path)
            AND a.sha256_hex = $3`, [media.targetMediaId, BUCKET, media.sha256Hex.toLowerCase()]);
        if (updated.rowCount !== 1) throw new Error("A local media row changed while bytes were importing; association transaction stopped.");
        if (ref.kind === "MENU") {
          const menu = await client.query<{ photo_media_id: string | null }>(
            "SELECT photo_media_id::text FROM public.menus WHERE id=$1 FOR UPDATE", [ref.id],
          );
          if (!menu.rows[0]) throw new Error("A source menu mapping is missing in the local target.");
          if (menu.rows[0].photo_media_id !== null && menu.rows[0].photo_media_id !== media.targetMediaId) {
            throw new Error("A local menu already has a different photo; importer did not replace it.");
          }
          await client.query("UPDATE public.menus SET photo_media_id=$2::uuid WHERE id=$1 AND photo_media_id IS NULL", [ref.id, media.targetMediaId]);
        } else {
          const review = await client.query<{ id: string }>("SELECT id::text FROM public.reviews WHERE id=$1 FOR UPDATE", [ref.id]);
          if (!review.rows[0]) throw new Error("A source review mapping is missing in the local target.");
          const prior = await client.query<{ exact: boolean }>(
            `SELECT (sort_order=$3 AND created_at=$4::timestamptz) AS exact
             FROM public.review_photos WHERE review_id=$1 AND media_id=$2::uuid FOR UPDATE`,
            [ref.id, media.targetMediaId, ref.sortOrder, ref.createdAt],
          );
          if (prior.rows.length > 0) {
            if (prior.rows.length !== 1 || prior.rows[0].exact !== true) {
              throw new Error("An existing local review-photo relation conflicts with the source mapping.");
            }
          } else {
            await client.query(`INSERT INTO public.review_photos (review_id, media_id, sort_order, created_at)
              VALUES ($1, $2::uuid, $3, $4::timestamptz)`, [ref.id, media.targetMediaId, ref.sortOrder, ref.createdAt]);
          }
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  return { uploaded, exactObjectSkips, deferred };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(() => {
    process.stderr.write("Media import stopped safely. Source data and originals were preserved; because object storage cannot join a database transaction, earlier idempotent local inserts may remain and can be inspected or retried. Sensitive details were withheld.\n");
    process.exitCode = 1;
  });
}
