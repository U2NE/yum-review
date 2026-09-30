import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertProductionExecutionSourceTrusted, assertProductionTargetSafe, assertSuiteMatchesSource, deriveBrowserMatrix } from "../../scripts/qa/run-browser-matrix";
import type { BrowserMatrixSuite } from "../../scripts/qa/run-browser-matrix";

test("source UI matrix expands to 57 families and 394 unique executions", async () => {
  const markdown = await readFile("docs/migration/ui-qa-matrix.md", "utf8");
  const suite = deriveBrowserMatrix(markdown);
  assert.equal(suite.familyCount, 57);
  assert.equal(suite.executionCount, 394);
  assert.equal(new Set(suite.cases.map(item => item.caseId)).size, 394);
  const row53 = suite.families.find(item => item.sourceRow === 53);
  assert.deepEqual(row53?.roles, ["guest", "member", "owner", "server-admin"]);
  assert.deepEqual(row53?.viewports, [360, 1440]);
});

test("checked-in suite exactly matches the source matrix expansion", async () => {
  const markdown = await readFile("docs/migration/ui-qa-matrix.md", "utf8");
  const checkedIn = JSON.parse(await readFile("docs/migration/browser-qa-57.json", "utf8")) as BrowserMatrixSuite;
  assertSuiteMatchesSource(checkedIn, deriveBrowserMatrix(markdown));
});

test("production target refuses catalog, menu, and menu-photo mutation cases", () => {
  assert.throws(() => assertProductionTargetSafe("production", [{ mutationSurface: "catalog-menu" }]), /prohibited/);
  assert.throws(() => assertProductionTargetSafe("production", [{ mutationSurface: "menu-photo" }]), /prohibited/);
  assert.doesNotThrow(() => assertProductionTargetSafe("production", [{ mutationSurface: "read-only" }, { mutationSurface: "personal-data" }]));
  assert.doesNotThrow(() => assertProductionTargetSafe("local", [{ mutationSurface: "catalog-menu" }, { mutationSurface: "menu-photo" }]));
});

test("production execution trusts only the canonical matrix source while dry-run remains source-flexible", () => {
  assert.throws(
    () => assertProductionExecutionSourceTrusted("production", true, "custom/relabelled-matrix.md"),
    /trusted canonical matrix source/,
  );
  assert.doesNotThrow(() => assertProductionExecutionSourceTrusted("production", true, "docs/migration/ui-qa-matrix.md"));
  assert.doesNotThrow(() => assertProductionExecutionSourceTrusted("production", false, "custom/source.md"));
  assert.doesNotThrow(() => assertProductionExecutionSourceTrusted("local", true, "custom/source.md"));
});
