import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface CatalogRestaurant {
  id: string | number;
  name: string;
  [key: string]: unknown;
}

export interface CatalogMenu {
  id: string | number;
  restaurantId: string | number;
  [key: string]: unknown;
}

export interface CatalogMenuPhoto {
  restaurantId: string | number;
  menuId: string | number;
  objectPath: string;
  bytes: Buffer | Uint8Array | string;
  bytesEncoding?: "base64" | "utf8";
}

export interface CatalogSnapshot {
  restaurants: CatalogRestaurant[];
  menus: CatalogMenu[];
  menuPhotos: CatalogMenuPhoto[];
}

export interface OpaqueSetDigest {
  count: number;
  setHmac: string;
  itemHmacs: string[];
}

export interface CatalogPreservationManifest {
  schemaVersion: 1;
  counts: {
    restaurants: number;
    menus: number;
    menuPhotos: number;
    menuPhotoBytes: number;
    gompocha: {
      restaurants: number;
      menus: number;
      menuPhotos: number;
      menuPhotoBytes: number;
    };
  };
  catalogRows: {
    restaurantsHmac: string;
    menusHmac: string;
    gompochaRestaurantsHmac: string;
    gompochaMenusHmac: string;
  };
  menuPhotoPaths: OpaqueSetDigest;
  menuPhotoBytes: OpaqueSetDigest;
  menuPhotoObjects: OpaqueSetDigest;
  gompocha: {
    menuPhotoPaths: OpaqueSetDigest;
    menuPhotoBytes: OpaqueSetDigest;
    menuPhotoObjects: OpaqueSetDigest;
  };
}

type HmacKey = Buffer | Uint8Array | string;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function bytesFor(photo: CatalogMenuPhoto): Buffer {
  const encoding = (photo as CatalogMenuPhoto & { bytesEncoding?: unknown }).bytesEncoding;
  if (encoding !== undefined && encoding !== "base64" && encoding !== "utf8") {
    throw new Error("Catalog photo byte encoding is unsupported.");
  }
  if (Buffer.isBuffer(photo.bytes)) return Buffer.from(photo.bytes);
  if (photo.bytes instanceof Uint8Array) return Buffer.from(photo.bytes);
  if (typeof photo.bytes !== "string") throw new Error("Catalog photo bytes are invalid.");

  const effectiveEncoding = encoding ?? "base64";
  if (effectiveEncoding === "utf8") {
    for (let index = 0; index < photo.bytes.length; index++) {
      const unit = photo.bytes.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = photo.bytes.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Catalog photo UTF-8 text is malformed.");
        index++;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        throw new Error("Catalog photo UTF-8 text is malformed.");
      }
    }
    return Buffer.from(photo.bytes, "utf8");
  }

  // Buffer.from(base64) silently ignores invalid characters and accepts partial input.
  // Accept only canonical RFC 4648 base64 so malformed values can never hash as empty bytes.
  const isCanonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photo.bytes);
  if (!isCanonicalBase64) throw new Error("Catalog photo base64 is malformed.");
  const decoded = Buffer.from(photo.bytes, "base64");
  if (decoded.toString("base64") !== photo.bytes) throw new Error("Catalog photo base64 is malformed.");
  return decoded;
}

function keyBytes(key: HmacKey): Buffer {
  const bytes = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (bytes.length < 32) throw new Error("HMAC key must contain at least 32 bytes.");
  return bytes;
}

function opaqueHmac(key: Buffer, domain: string, value: Buffer | string): string {
  return createHmac("sha256", key).update(domain, "utf8").update(Buffer.from([0])).update(value).digest("hex");
}

function setDigest(key: Buffer, domain: string, items: string[]): OpaqueSetDigest {
  const sorted = [...items].sort();
  const setHmac = opaqueHmac(key, `${domain}:set`, sorted.join("\n"));
  return { count: sorted.length, setHmac, itemHmacs: sorted };
}

function rowSetHmac(key: Buffer, domain: string, rows: unknown[]): string {
  const rowHashes = rows.map(row => opaqueHmac(key, `${domain}:row`, canonical(row))).sort();
  return opaqueHmac(key, `${domain}:set`, rowHashes.join("\n"));
}

function compareId(a: string | number, b: string | number): boolean {
  return String(a) === String(b);
}

function validateSnapshot(snapshot: CatalogSnapshot): void {
  if (!snapshot || !Array.isArray(snapshot.restaurants) || !Array.isArray(snapshot.menus) || !Array.isArray(snapshot.menuPhotos)) {
    throw new Error("Catalog snapshot is invalid.");
  }
  for (const photo of snapshot.menuPhotos) {
    if (!photo || typeof photo.objectPath !== "string" || photo.objectPath.length === 0) throw new Error("Catalog snapshot is invalid.");
    if (!Buffer.isBuffer(photo.bytes) && !(photo.bytes instanceof Uint8Array) && typeof photo.bytes !== "string") {
      throw new Error("Catalog snapshot is invalid.");
    }
    if (photo.bytesEncoding !== undefined && photo.bytesEncoding !== "base64" && photo.bytesEncoding !== "utf8") {
      throw new Error("Catalog photo byte encoding is unsupported.");
    }
    // Decode every string before calculating any HMAC so malformed encodings fail closed.
    if (typeof photo.bytes === "string") bytesFor(photo);
    if (typeof photo.restaurantId !== "string" && typeof photo.restaurantId !== "number") throw new Error("Catalog snapshot is invalid.");
    if (typeof photo.menuId !== "string" && typeof photo.menuId !== "number") throw new Error("Catalog snapshot is invalid.");
  }
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateOpaqueSet(value: unknown): value is OpaqueSetDigest {
  if (!value || typeof value !== "object" || !hasExactKeys(value, ["count", "setHmac", "itemHmacs"])) return false;
  const digest = value as OpaqueSetDigest;
  return Number.isSafeInteger(digest.count) && digest.count >= 0 &&
    typeof digest.setHmac === "string" && /^[a-f0-9]{64}$/.test(digest.setHmac) &&
    Array.isArray(digest.itemHmacs) && digest.itemHmacs.length === digest.count &&
    digest.itemHmacs.every(item => typeof item === "string" && /^[a-f0-9]{64}$/.test(item));
}

/** Validates the persisted, opaque form before it can become a purge resume baseline. */
export function assertValidCatalogPreservationManifest(value: unknown): asserts value is CatalogPreservationManifest {
  if (!value || typeof value !== "object" || !hasExactKeys(value, ["schemaVersion", "counts", "catalogRows", "menuPhotoPaths", "menuPhotoBytes", "menuPhotoObjects", "gompocha"])) {
    throw new Error("Catalog preservation baseline is invalid.");
  }
  const manifest = value as CatalogPreservationManifest;
  if (manifest.schemaVersion !== 1 || !manifest.counts || typeof manifest.counts !== "object" ||
      !hasExactKeys(manifest.counts, ["restaurants", "menus", "menuPhotos", "menuPhotoBytes", "gompocha"]) ||
      !manifest.counts.gompocha || typeof manifest.counts.gompocha !== "object" ||
      !hasExactKeys(manifest.counts.gompocha, ["restaurants", "menus", "menuPhotos", "menuPhotoBytes"])) {
    throw new Error("Catalog preservation baseline is invalid.");
  }
  const counts = [manifest.counts.restaurants, manifest.counts.menus, manifest.counts.menuPhotos, manifest.counts.menuPhotoBytes,
    manifest.counts.gompocha.restaurants, manifest.counts.gompocha.menus, manifest.counts.gompocha.menuPhotos, manifest.counts.gompocha.menuPhotoBytes];
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0) ||
      !manifest.catalogRows || typeof manifest.catalogRows !== "object" ||
      !hasExactKeys(manifest.catalogRows, ["restaurantsHmac", "menusHmac", "gompochaRestaurantsHmac", "gompochaMenusHmac"]) ||
      Object.values(manifest.catalogRows).some(digest => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) ||
      !validateOpaqueSet(manifest.menuPhotoPaths) || !validateOpaqueSet(manifest.menuPhotoBytes) || !validateOpaqueSet(manifest.menuPhotoObjects) ||
      !manifest.gompocha || typeof manifest.gompocha !== "object" || !hasExactKeys(manifest.gompocha, ["menuPhotoPaths", "menuPhotoBytes", "menuPhotoObjects"]) ||
      !validateOpaqueSet(manifest.gompocha.menuPhotoPaths) || !validateOpaqueSet(manifest.gompocha.menuPhotoBytes) || !validateOpaqueSet(manifest.gompocha.menuPhotoObjects)) {
    throw new Error("Catalog preservation baseline is invalid.");
  }
}

/** Creates a privacy-safe preservation proof. The key is supplied by the caller at runtime. */
export function buildCatalogPreservationManifest(snapshot: CatalogSnapshot, suppliedKey: HmacKey): CatalogPreservationManifest {
  validateSnapshot(snapshot);
  const key = keyBytes(suppliedKey);
  const photoBytes = new Map(snapshot.menuPhotos.map(photo => [photo, bytesFor(photo)]));
  const gompochaRestaurants = snapshot.restaurants.filter(row => /곰포차/i.test(row.name.normalize("NFC")));
  const gompochaIds = new Set(gompochaRestaurants.map(row => String(row.id)));
  const gompochaMenus = snapshot.menus.filter(row => gompochaIds.has(String(row.restaurantId)));
  const gompochaMenuIds = new Set(gompochaMenus.map(row => `${row.restaurantId}:${row.id}`));
  const gompochaPhotos = snapshot.menuPhotos.filter(photo => gompochaIds.has(String(photo.restaurantId)) && gompochaMenuIds.has(`${photo.restaurantId}:${photo.menuId}`));

  const pathHash = (photo: CatalogMenuPhoto) => opaqueHmac(key, "menu-photo-path", photo.objectPath);
  const byteHash = (photo: CatalogMenuPhoto) => opaqueHmac(key, "menu-photo-bytes", photoBytes.get(photo)!);
  const associationHash = (photo: CatalogMenuPhoto) => opaqueHmac(key, "menu-photo-association", canonical([String(photo.restaurantId), String(photo.menuId)]));
  const objectHash = (photo: CatalogMenuPhoto) => opaqueHmac(key, "menu-photo-object", `${pathHash(photo)}:${byteHash(photo)}:${associationHash(photo)}`);
  const totalBytes = (photos: CatalogMenuPhoto[]) => photos.reduce((sum, photo) => sum + photoBytes.get(photo)!.byteLength, 0);

  return {
    schemaVersion: 1,
    counts: {
      restaurants: snapshot.restaurants.length,
      menus: snapshot.menus.length,
      menuPhotos: snapshot.menuPhotos.length,
      menuPhotoBytes: totalBytes(snapshot.menuPhotos),
      gompocha: {
        restaurants: gompochaRestaurants.length,
        menus: gompochaMenus.length,
        menuPhotos: gompochaPhotos.length,
        menuPhotoBytes: totalBytes(gompochaPhotos),
      },
    },
    catalogRows: {
      restaurantsHmac: rowSetHmac(key, "restaurant", snapshot.restaurants),
      menusHmac: rowSetHmac(key, "menu", snapshot.menus),
      gompochaRestaurantsHmac: rowSetHmac(key, "gompocha-restaurant", gompochaRestaurants),
      gompochaMenusHmac: rowSetHmac(key, "gompocha-menu", gompochaMenus),
    },
    menuPhotoPaths: setDigest(key, "menu-photo-paths", snapshot.menuPhotos.map(pathHash)),
    menuPhotoBytes: setDigest(key, "menu-photo-bytes", snapshot.menuPhotos.map(byteHash)),
    menuPhotoObjects: setDigest(key, "menu-photo-objects", snapshot.menuPhotos.map(objectHash)),
    gompocha: {
      menuPhotoPaths: setDigest(key, "gompocha-menu-photo-paths", gompochaPhotos.map(pathHash)),
      menuPhotoBytes: setDigest(key, "gompocha-menu-photo-bytes", gompochaPhotos.map(byteHash)),
      menuPhotoObjects: setDigest(key, "gompocha-menu-photo-objects", gompochaPhotos.map(objectHash)),
    },
  };
}

export function assertCatalogPreserved(before: CatalogPreservationManifest, after: CatalogPreservationManifest): void {
  if (canonical(before) !== canonical(after)) throw new Error("Catalog preservation verification failed.");
}

export function runtimeManifestKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = environment.CATALOG_MANIFEST_HMAC_KEY;
  if (!encoded) throw new Error("CATALOG_MANIFEST_HMAC_KEY must be injected into the runtime environment.");
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32) throw new Error("CATALOG_MANIFEST_HMAC_KEY is invalid.");
  return key;
}

function selfTest(): void {
  const key = randomBytes(32);
  const synthetic: CatalogSnapshot = {
    restaurants: [
      { id: 1, name: "곰포차 synthetic", address: "synthetic", latitude: 1, longitude: 2 },
      { id: 2, name: "Local sample", address: "synthetic", latitude: null, longitude: null },
    ],
    menus: [
      { id: 11, restaurantId: 1, name: "synthetic menu", priceKrw: 1000 },
      { id: 21, restaurantId: 2, name: "local sample", priceKrw: 2000 },
    ],
    menuPhotos: [
      { restaurantId: 1, menuId: 11, objectPath: "menu/synthetic/one.webp", bytes: Buffer.from("synthetic Gompocha photo") },
      { restaurantId: 2, menuId: 21, objectPath: "menu/synthetic/two.webp", bytes: Buffer.from("synthetic photo") },
    ],
  };
  const manifest = buildCatalogPreservationManifest(synthetic, key);
  const serialized = JSON.stringify(manifest);
  if (manifest.counts.restaurants !== 2 || manifest.counts.menus !== 2 || manifest.counts.menuPhotos !== 2 || manifest.counts.gompocha.menuPhotos !== 1) {
    throw new Error("Manifest self-test failed.");
  }
  if (serialized.includes("menu/synthetic") || serialized.includes("synthetic Gompocha photo")) throw new Error("Manifest self-test failed.");
  process.stdout.write("catalog-manifest self-test PASS\n");
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const inputIndex = argv.indexOf("--input");
  if (inputIndex < 0 || !argv[inputIndex + 1]) throw new Error("Provide --input with a local sanitized snapshot JSON file.");
  const inputPath = resolve(argv[inputIndex + 1]);
  const snapshot = JSON.parse(await readFile(inputPath, "utf8")) as CatalogSnapshot;
  const manifest = buildCatalogPreservationManifest(snapshot, runtimeManifestKey());
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("catalog-manifest failed; sensitive input details were suppressed.\n");
    process.exitCode = 1;
  });
}
