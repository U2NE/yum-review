import assert from "node:assert/strict";
import test from "node:test";
import { assertExactPendingMigrations, assertExactStoragePaths, buildApplyArgs, buildDryRunArgs, normalizeHostedRestaurantRow, safeCliFailure } from "../../scripts/qa/hosted-catalog-manifest";

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
