import assert from "node:assert/strict";
import test from "node:test";
import { assertCatalogPreserved, buildCatalogPreservationManifest, type CatalogSnapshot } from "./catalog-preservation-manifest";

const key = Buffer.alloc(32, 7);
const snapshot: CatalogSnapshot = {
  restaurants: [
    { id: "secret-restaurant-id", name: "곰포차 죽전점", address: "sensitive address", latitude: 37.1, longitude: 127.1 },
    { id: 2, name: "Sample", address: "synthetic", latitude: null, longitude: null },
  ],
  menus: [
    { id: 10, restaurantId: "secret-restaurant-id", name: "곰라면", priceKrw: 3900 },
    { id: 20, restaurantId: 2, name: "Synthetic menu", priceKrw: 1000 },
  ],
  menuPhotos: [
    { restaurantId: "secret-restaurant-id", menuId: 10, objectPath: "menu/private-uploader/private-asset.webp", bytes: Buffer.from([1, 2, 3]) },
    { restaurantId: 2, menuId: 20, objectPath: "menu/synthetic/local.webp", bytes: Buffer.from([4, 5, 6]) },
  ],
};

test("manifest uses opaque keyed path and byte hashes and counts Gompocha assets", () => {
  const manifest = buildCatalogPreservationManifest(snapshot, key);
  assert.equal(manifest.counts.restaurants, 2);
  assert.equal(manifest.counts.menus, 2);
  assert.equal(manifest.counts.menuPhotos, 2);
  assert.equal(manifest.counts.menuPhotoBytes, 6);
  assert.equal(manifest.counts.gompocha.restaurants, 1);
  assert.equal(manifest.counts.gompocha.menus, 1);
  assert.equal(manifest.counts.gompocha.menuPhotos, 1);
  assert.equal(manifest.menuPhotoPaths.itemHmacs.length, 2);
  assert.equal(manifest.gompocha.menuPhotoBytes.count, 1);
  assert.equal(manifest.gompocha.menuPhotoObjects.count, 1);
  const output = JSON.stringify(manifest);
  for (const forbidden of ["private-uploader", "private-asset", "sensitive address", "secret-restaurant-id", "gompocha 죽전점", " 곰라면 "]) {
    assert.equal(output.includes(forbidden), false);
  }
});

test("same snapshot verifies and any byte or path change fails", () => {
  const before = buildCatalogPreservationManifest(snapshot, key);
  assert.doesNotThrow(() => assertCatalogPreserved(before, buildCatalogPreservationManifest(snapshot, key)));
  const changed = structuredClone(snapshot);
  changed.menuPhotos[0].bytes = Buffer.from([1, 2, 4]);
  assert.throws(() => assertCatalogPreserved(before, buildCatalogPreservationManifest(changed, key)), /preservation verification failed/);
  const swapped = structuredClone(snapshot);
  const first = Buffer.from(swapped.menuPhotos[0].bytes);
  swapped.menuPhotos[0].bytes = swapped.menuPhotos[1].bytes;
  swapped.menuPhotos[1].bytes = first;
  assert.throws(() => assertCatalogPreserved(before, buildCatalogPreservationManifest(swapped, key)), /preservation verification failed/);
});

test("menu photo object hashes bind catalog and Gompocha restaurant/menu associations", () => {
  const catalogSnapshot: CatalogSnapshot = {
    restaurants: [{ id: "r1", name: "Sample one" }, { id: "r2", name: "Sample two" }],
    menus: [{ id: "m1", restaurantId: "r1", name: "One" }, { id: "m2", restaurantId: "r2", name: "Two" }],
    menuPhotos: [{ restaurantId: "r1", menuId: "m1", objectPath: "menu/sample.webp", bytes: Buffer.from([3, 4]) }],
  };
  const before = buildCatalogPreservationManifest(catalogSnapshot, key);
  const catalogReassigned = structuredClone(catalogSnapshot);
  catalogReassigned.menuPhotos[0].restaurantId = "r2";
  catalogReassigned.menuPhotos[0].menuId = "m2";
  assert.throws(() => assertCatalogPreserved(before, buildCatalogPreservationManifest(catalogReassigned, key)), /preservation verification failed/);

  const gompochaSnapshot: CatalogSnapshot = {
    restaurants: [
      { id: "g1", name: "곰포차 synthetic one" },
      { id: "g2", name: "곰포차 synthetic two" },
    ],
    menus: [
      { id: "m1", restaurantId: "g1", name: "Synthetic one" },
      { id: "m2", restaurantId: "g2", name: "Synthetic two" },
    ],
    menuPhotos: [
      { restaurantId: "g1", menuId: "m1", objectPath: "menu/g1.webp", bytes: Buffer.from([7, 8]) },
      { restaurantId: "g2", menuId: "m2", objectPath: "menu/g2.webp", bytes: Buffer.from([9, 10]) },
    ],
  };
  const gompochaBefore = buildCatalogPreservationManifest(gompochaSnapshot, key);
  const gompochaReassigned = structuredClone(gompochaSnapshot);
  gompochaReassigned.menuPhotos[0].restaurantId = "g2";
  gompochaReassigned.menuPhotos[0].menuId = "m2";
  gompochaReassigned.menuPhotos[1].restaurantId = "g1";
  gompochaReassigned.menuPhotos[1].menuId = "m1";
  const reassignedManifest = buildCatalogPreservationManifest(gompochaReassigned, key);
  assert.throws(() => assertCatalogPreserved(gompochaBefore, reassignedManifest), /preservation verification failed/);
  assert.notDeepEqual(gompochaBefore.gompocha.menuPhotoObjects, reassignedManifest.gompocha.menuPhotoObjects);
});

test("requires a runtime key of at least 32 bytes", () => {
  assert.throws(() => buildCatalogPreservationManifest(snapshot, Buffer.alloc(31)), /at least 32 bytes/);
});

test("rejects malformed base64 and unsupported runtime encodings before hashing", () => {
  for (const malformed of ["!", "%", "====", "YQ="]) {
    const invalid: CatalogSnapshot = {
      ...snapshot,
      menuPhotos: [{ restaurantId: "r1", menuId: "m1", objectPath: "menu/photo.webp", bytes: malformed, bytesEncoding: "base64" }],
    };
    assert.throws(() => buildCatalogPreservationManifest(invalid, key), /base64 is malformed/);
  }

  const unsupported = {
    ...snapshot,
    menuPhotos: [{ restaurantId: "r1", menuId: "m1", objectPath: "menu/photo.webp", bytes: "YQ==", bytesEncoding: "hex" }],
  } as unknown as CatalogSnapshot;
  assert.throws(() => buildCatalogPreservationManifest(unsupported, key), /encoding is unsupported/);

  const binaryWithUnsupportedEncoding = {
    ...snapshot,
    menuPhotos: [{ restaurantId: "r1", menuId: "m1", objectPath: "menu/photo.webp", bytes: Buffer.from([1]), bytesEncoding: "hex" }],
  } as unknown as CatalogSnapshot;
  assert.throws(() => buildCatalogPreservationManifest(binaryWithUnsupportedEncoding, key), /encoding is unsupported/);

  const malformedUtf8 = {
    ...snapshot,
    menuPhotos: [{ restaurantId: "r1", menuId: "m1", objectPath: "menu/photo.webp", bytes: "\ud800", bytesEncoding: "utf8" }],
  } as CatalogSnapshot;
  assert.throws(() => buildCatalogPreservationManifest(malformedUtf8, key), /UTF-8 text is malformed/);
});
