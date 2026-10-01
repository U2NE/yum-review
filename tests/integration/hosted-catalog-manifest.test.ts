import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedGitHubRemote, assertExactPendingMigrations, assertExactRedirectAllowlist, assertExactStoragePaths, assertExpectedManifest, assertHostedProjectBinding, assertOriginMainIsAncestor, assertReleaseWorktreeClean, buildApplyArgs, buildDryRunArgs, buildHostedAuthSettingsPayload, gitChildEnvironment, normalizeHostedRestaurantRow, safeCliFailure } from "../../scripts/qa/hosted-catalog-manifest";
import { assertCatalogPreserved, buildCatalogPreservationManifest, type CatalogSnapshot } from "../../scripts/qa/catalog-preservation-manifest";

const expected = [
  "20260928115000_personal_data_write_freeze.sql",
  "20260928120000_purge_journal_and_menu_media_attribution.sql",
  "20260928130000_auth_email_lookup_limits.sql",
  "20260928140000_restaurant_location_consent.sql",
];

test("hosted migration gate accepts exactly the four approved pending migrations", () => {
  assert.doesNotThrow(() => assertExactPendingMigrations(expected));
});

test("hosted migration gate rejects missing, extra, duplicate, or reordered migrations", () => {
  assert.throws(() => assertExactPendingMigrations(expected.slice(0, 3)));
  assert.throws(() => assertExactPendingMigrations([...expected, "20260928150000_unexpected.sql"]));
  assert.throws(() => assertExactPendingMigrations([...expected, expected[3]]));
  assert.throws(() => assertExactPendingMigrations([...expected].reverse()));
});

test("hosted MENU Storage path gate requires the exact 40-object set", () => {
  const paths = Array.from({ length: 40 }, (_, index) => `menu/synthetic/${index}.webp`);
  assert.doesNotThrow(() => assertExactStoragePaths(paths, [...paths].reverse()));
  assert.throws(() => assertExactStoragePaths(paths.slice(1), paths));
  assert.throws(() => assertExactStoragePaths([...paths, "menu/synthetic/extra.webp"], paths));
  assert.throws(() => assertExactStoragePaths([...paths.slice(0, 39), paths[0]], paths));
});

test("hosted row comparison ignores only the two G9-added restaurant consent columns", () => {
  const before = { id: 7, name: "synthetic", address: "sample", latitude: 1, longitude: 2 };
  const after = { ...before, location_consent_version: null, location_consent_at: null };
  assert.deepEqual(normalizeHostedRestaurantRow(after), before);
  assert.deepEqual(normalizeHostedRestaurantRow({ ...after, address: "changed" }), { ...before, address: "changed" });
  assert.deepEqual(normalizeHostedRestaurantRow({ ...after, latitude: 10 }), { ...before, latitude: 10 });
});

test("fresh keyed row and MENU-byte gate detects protected catalog changes", () => {
  const key = Buffer.alloc(32, 17);
  const baseline: CatalogSnapshot = {
    restaurants: [{ id: 1, name: "곰포차 fixture", address: "fixture", latitude: null, longitude: null }],
    menus: [{ id: 2, restaurantId: 1, name: "fixture menu", price: 1000 }],
    menuPhotos: [{ restaurantId: 1, menuId: 2, objectPath: "menu/fixture/photo.webp", bytes: Buffer.from([1, 2, 3]) }],
  };
  const before = buildCatalogPreservationManifest(baseline, key);
  assert.doesNotThrow(() => assertCatalogPreserved(before, buildCatalogPreservationManifest({
    ...baseline,
    restaurants: [normalizeHostedRestaurantRow({ ...baseline.restaurants[0], location_consent_version: "restaurant-location-v1", location_consent_at: null })],
  }, key)));
  assert.throws(() => assertCatalogPreserved(before, buildCatalogPreservationManifest({
    ...baseline, menus: [{ ...baseline.menus[0], price: 1100 }],
  }, key)));
  assert.throws(() => assertCatalogPreserved(before, buildCatalogPreservationManifest({
    ...baseline, menuPhotos: [{ ...baseline.menuPhotos[0], bytes: Buffer.from([1, 2, 4]) }],
  }, key)));
  assert.throws(() => assertCatalogPreserved(before, buildCatalogPreservationManifest({
    ...baseline, menuPhotos: [{ ...baseline.menuPhotos[0], objectPath: "menu/fixture/other.webp" }],
  }, key)));
  const currentSchema = {
    ...baseline,
    restaurants: [{ ...baseline.restaurants[0], location_consent_version: null, location_consent_at: null }],
  };
  const currentSchemaBefore = buildCatalogPreservationManifest(currentSchema, key);
  assert.throws(() => assertCatalogPreserved(currentSchemaBefore, buildCatalogPreservationManifest({
    ...currentSchema,
    restaurants: [{ ...currentSchema.restaurants[0], location_consent_version: "restaurant-location-v1" }],
  }, key)));
});

test("CLI failure reporting preserves only bounded code and SQLSTATE, never raw output", () => {
  const privateText = "ERROR SQLSTATE 42501 permission denied for object menu/123e4567-e89b-12d3-a456-426614174000/photo.webp; email person@example.test; token secret-value";
  const output = safeCliFailure(1, `prefix\n${JSON.stringify({ error: { code: "DbPushError", message: privateText } })}`);
  assert.deepEqual(output, { exitCode: "1", errorCode: "DbPushError", sqlState: "42501", detail: "permission denied" });
  assert.equal(JSON.stringify(output).includes("123e4567"), false);
  assert.equal(JSON.stringify(output).includes("person@example.test"), false);
  assert.equal(JSON.stringify(output).includes("secret-value"), false);
  assert.equal(JSON.stringify(output).includes("menu/"), false);
});

test("diagnostic runner builds a dry-run command without any apply flags", () => {
  const args = buildDryRunArgs("postgresql://user@example.invalid:5432/postgres");
  assert.deepEqual(args, ["db", "push", "--dry-run", "--db-url", "postgresql://user@example.invalid:5432/postgres"]);
  assert.equal(args.includes("--yes"), false);
  assert.equal(args.includes("--skip-vault"), false);
});

test("tracked apply command uses the official push with vault updates skipped", () => {
  const args = buildApplyArgs("postgresql://user@example.invalid:5432/postgres");
  assert.deepEqual(args, ["db", "push", "--yes", "--skip-vault", "--db-url", "postgresql://user@example.invalid:5432/postgres"]);
  assert.equal(args.includes("--dry-run"), false);
});

test("hosted project binding accepts only the approved HTTPS project, DB host, and DB user", () => {
  const valid = { supabaseUrl: "https://zeyrmufaprctdbhfvjic.supabase.co", databaseHost: "aws-0-ap-south-1.pooler.supabase.com", databaseUser: "postgres.zeyrmufaprctdbhfvjic" };
  assert.doesNotThrow(() => assertHostedProjectBinding(valid));
  for (const invalid of [
    { ...valid, supabaseUrl: "http://zeyrmufaprctdbhfvjic.supabase.co" },
    { ...valid, supabaseUrl: "https://attacker.supabase.co" },
    { ...valid, supabaseUrl: "https://zeyrmufaprctdbhfvjic.supabase.co.evil.test" },
    { ...valid, supabaseUrl: "https://zeyrmufaprctdbhfvjic.supabase.co/path" },
    { ...valid, databaseHost: "attacker.example" },
    { ...valid, databaseUser: "postgres.other-project" },
  ]) assert.throws(() => assertHostedProjectBinding(invalid));
});

test("release gate rejects tracked or untracked worktree changes and non-fast-forward origin/main", () => {
  assert.doesNotThrow(() => assertReleaseWorktreeClean(""));
  assert.throws(() => assertReleaseWorktreeClean(" M scripts/qa/file.ts\n"));
  assert.throws(() => assertReleaseWorktreeClean("?? untracked.txt\n"));
  assert.doesNotThrow(() => assertOriginMainIsAncestor(0));
  assert.throws(() => assertOriginMainIsAncestor(1));
});

test("release gate accepts only approved GitHub fetch and push remote URLs", () => {
  for (const url of [
    "https://github.com/U2NE/yum-review.git",
    "https://github.com/U2NE/yum-review",
    "git@github.com:U2NE/yum-review.git",
    "ssh://git@github.com/U2NE/yum-review.git",
  ]) assert.doesNotThrow(() => assertApprovedGitHubRemote([url], [url]));
  for (const url of [
    "https://attacker.test/U2NE/yum-review.git",
    " https://github.com/U2NE/yum-review.git",
    "https://github.com/U2NE/yum-review.evil.git",
    "https://user:secret@github.com/U2NE/yum-review.git",
    "git@evil.test:U2NE/yum-review.git",
    "ssh://user@github.com/U2NE/yum-review.git",
    "ssh://git@github.com/U2NE/other.git",
  ]) assert.throws(() => assertApprovedGitHubRemote([url], ["https://github.com/U2NE/yum-review.git"]));
  assert.throws(() => assertApprovedGitHubRemote(["https://github.com/U2NE/yum-review.git"], ["https://attacker.test/U2NE/yum-review.git"]));
  assert.throws(() => assertApprovedGitHubRemote([], []));
});

test("Auth redirect readback must preserve the full requested allowlist set", () => {
  const requested = ["https://yum-review.vercel.app/auth/callback", "https://example.test/auth/callback"];
  assert.doesNotThrow(() => assertExactRedirectAllowlist([...requested], requested));
  assert.throws(() => assertExactRedirectAllowlist([requested[0]], requested));
  assert.throws(() => assertExactRedirectAllowlist([...requested, "https://unexpected.test/callback"], requested));
});

test("Git child environment excludes Supabase, database, and Vercel credentials", () => {
  const env = gitChildEnvironment({ PATH: "safe-path", SystemRoot: "C:\\Windows", SUPABASE_SERVICE_KEY: "secret", SUPABASE_MANAGEMENT_TOKEN: "secret", PGPASSWORD: "secret", VERCEL_TOKEN: "secret" });
  assert.deepEqual(env, { PATH: "safe-path", SystemRoot: "C:\\Windows" });
});

test("hosted Auth release payload uses Supabase character classes for letters and digits", () => {
  const payload = buildHostedAuthSettingsPayload(["https://yum-review.vercel.app/auth/callback"]);
  assert.deepEqual(payload, {
    site_url: "https://yum-review.vercel.app",
    uri_allow_list: "https://yum-review.vercel.app/auth/callback",
    password_min_length: 8,
    password_required_characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  });
});

test("hosted release baseline requires exact inventory, bytes, and Gompocha counts", () => {
  const restaurants = [
    { id: 1, name: "곰포차" }, { id: 2, name: "식당 A" }, { id: 3, name: "식당 B" },
  ];
  const menus = Array.from({ length: 72 }, (_, index) => ({ id: index + 1, restaurantId: index < 40 ? 1 : index < 56 ? 2 : 3 }));
  const menuPhotos = Array.from({ length: 40 }, (_, index) => ({ restaurantId: 1, menuId: index + 1, objectPath: `menu/gompocha/${index}.webp`, bytes: Buffer.alloc(289_420 + (index < 11 ? 1 : 0)) }));
  const snapshot: CatalogSnapshot = { restaurants, menus, menuPhotos };
  const manifest = buildCatalogPreservationManifest(snapshot, Buffer.alloc(32, 3));
  assert.doesNotThrow(() => assertExpectedManifest(manifest, snapshot));
  const changedByteTotal = { ...manifest, counts: { ...manifest.counts, menuPhotoBytes: manifest.counts.menuPhotoBytes - 1 } };
  assert.throws(() => assertExpectedManifest(changedByteTotal, snapshot));
  const changedGompocha = { ...manifest, counts: { ...manifest.counts, gompocha: { ...manifest.counts.gompocha, menus: 39 } } };
  assert.throws(() => assertExpectedManifest(changedGompocha, snapshot));
});
