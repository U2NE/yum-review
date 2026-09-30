import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCatalogPreservationManifest, type CatalogSnapshot } from "../../scripts/qa/catalog-preservation-manifest";
import { runForwardPurge, type PurgeCoordinatorPorts, type PurgeFinalVerification } from "../../scripts/qa/personal-data-purge";
import { PurgeJournal, PURGE_TARGET_ORDER, type TargetCheckpointEvidence } from "../../scripts/qa/purge-journal";

function evidenceForCatalog(manifest: ReturnType<typeof buildCatalogPreservationManifest>): TargetCheckpointEvidence {
  return {
    removedRows: 3,
    remainingRows: 0,
    removedObjects: 2,
    remainingObjects: 0,
    retainedMenuPathHmac: manifest.menuPhotoPaths.setHmac,
    retainedMenuBytesHmac: manifest.menuPhotoBytes.setHmac,
    retainedMenuPhotoObjectSetHmac: manifest.menuPhotoObjects.setHmac,
    retainedGompochaMenuPhotoObjectSetHmac: manifest.gompocha.menuPhotoObjects.setHmac,
    verifiedAt: "2026-09-29T00:00:00.000Z",
  };
}

const manifestKey = Buffer.alloc(32, 4);
function sampleCatalog(): CatalogSnapshot {
  return {
    restaurants: [{ id: "synthetic-r1", name: "Synthetic restaurant" }],
    menus: [{ id: "synthetic-m1", restaurantId: "synthetic-r1", name: "Synthetic menu" }],
    menuPhotos: [{ restaurantId: "synthetic-r1", menuId: "synthetic-m1", objectPath: "menu/synthetic.webp", bytes: Buffer.from([1, 2]) }],
  };
}

function finalVerification(catalogAfter: ReturnType<typeof buildCatalogPreservationManifest>): PurgeFinalVerification {
  return {
    remainingAccounts: 0,
    remainingLegacyAccounts: 0,
    remainingProfiles: 0,
    remainingAdmins: 0,
    remainingReviews: 0,
    remainingLikes: 0,
    remainingFavorites: 0,
    remainingRoleMappings: 0,
    remainingOwnerMappings: 0,
    remainingReviewPhotoAssociations: 0,
    remainingReviewMedia: 0,
    remainingLegacyReviewMediaFiles: 0,
    remainingUtilityAccounts: 0,
    remainingAllowlistEntries: 0,
    catalogAfter,
    evidenceHmac: "c".repeat(64),
    verifiedAt: "2026-09-29T00:00:00.000Z",
  };
}

async function temporaryJournal(t: test.TestContext, runId: string) {
  const root = await mkdtemp(join(tmpdir(), "yum-purge-journal-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { root, journal: await PurgeJournal.open(join(root, "journal.json"), runId) };
}

test("journal persists STARTED then COMMITTED and resumes forward after restart", async t => {
  const { root, journal } = await temporaryJournal(t, "run-journal-test");
  const baseline = buildCatalogPreservationManifest(sampleCatalog(), manifestKey);
  const evidence = evidenceForCatalog(baseline);
  await journal.recordCatalogBaseline(baseline);
  const started = await journal.recordStarted(PURGE_TARGET_ORDER[0]);
  assert.equal(started.status, "STARTED");
  assert.deepEqual(await journal.recordStarted(PURGE_TARGET_ORDER[0]), started);
  await assert.rejects(journal.recordStarted(PURGE_TARGET_ORDER[1]), /next forward target/);

  const committed = await journal.recordCommitted(PURGE_TARGET_ORDER[0], evidence);
  assert.equal(committed.status, "COMMITTED");
  assert.deepEqual(await journal.recordCommitted(PURGE_TARGET_ORDER[0], evidence), committed);
  await assert.rejects(journal.recordCommitted(PURGE_TARGET_ORDER[0], { ...evidence, removedRows: 4 }), /cannot be changed/);

  const restarted = await PurgeJournal.open(join(root, "journal.json"), "run-journal-test");
  assert.equal((await restarted.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "COMMITTED");
  assert.equal((await restarted.recordStarted(PURGE_TARGET_ORDER[0])).status, "COMMITTED");
  assert.equal((await restarted.recordStarted(PURGE_TARGET_ORDER[1])).status, "STARTED");
  const document = JSON.parse(await readFile(join(root, "journal.json"), "utf8")) as { checkpoints: Record<string, { status: string }> };
  assert.equal(document.checkpoints[PURGE_TARGET_ORDER[0]].status, "COMMITTED");
  assert.equal(document.checkpoints[PURGE_TARGET_ORDER[1]].status, "STARTED");
});

test("journal refuses incomplete targets, unsupported evidence fields, and run mismatch", async t => {
  const { root, journal } = await temporaryJournal(t, "run-journal-guards");
  const baseline = buildCatalogPreservationManifest(sampleCatalog(), manifestKey);
  const evidence = evidenceForCatalog(baseline);
  await assert.rejects(journal.recordCommitted(PURGE_TARGET_ORDER[0], evidence), /STARTED/);
  await journal.recordCatalogBaseline(baseline);
  await journal.recordStarted(PURGE_TARGET_ORDER[0]);
  await assert.rejects(journal.recordCommitted(PURGE_TARGET_ORDER[0], { ...evidence, remainingObjects: 1 }), /remain/);
  await assert.rejects(journal.recordCommitted(PURGE_TARGET_ORDER[0], { ...evidence, rawPath: "menu/private/id.webp" } as TargetCheckpointEvidence), /unsupported fields/);
  await assert.rejects(PurgeJournal.open(join(root, "journal.json"), "different-run-id"), /safely resumed/);
});

test("journal stores one immutable opaque catalog baseline before target checkpoints", async t => {
  const { journal } = await temporaryJournal(t, "run-baseline-test");
  const baseline = buildCatalogPreservationManifest(sampleCatalog(), manifestKey);
  assert.deepEqual(await journal.recordCatalogBaseline(baseline), baseline);
  assert.deepEqual(await journal.recordCatalogBaseline(baseline), baseline);
  await assert.rejects(journal.recordCatalogBaseline({ ...baseline, counts: { ...baseline.counts, menus: 2 } }), /cannot be changed/);
  await journal.recordStarted(PURGE_TARGET_ORDER[0]);
  assert.deepEqual(await journal.catalogBaseline(), baseline);
});

test("journal refuses a missing or malformed original baseline after target work began", async t => {
  const { root, journal } = await temporaryJournal(t, "run-missing-baseline-test");
  await journal.recordCatalogBaseline(buildCatalogPreservationManifest(sampleCatalog(), manifestKey));
  await journal.recordStarted(PURGE_TARGET_ORDER[0]);
  const path = join(root, "journal.json");
  const document = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  delete document.catalogBaseline;
  await writeFile(path, JSON.stringify(document), "utf8");
  await assert.rejects(PurgeJournal.open(path, "run-missing-baseline-test"), /safely resumed/);

  document.catalogBaseline = { schemaVersion: 1 };
  await writeFile(path, JSON.stringify(document), "utf8");
  await assert.rejects(PurgeJournal.open(path, "run-missing-baseline-test"), /safely resumed/);
});

test("resumed purge compares final catalog with the first run baseline", async t => {
  const { root, journal } = await temporaryJournal(t, "run-resume-catalog-baseline");
  let liveCatalog = sampleCatalog();
  let captureCount = 0;
  let failAfterFirstTarget = true;
  const ports: PurgeCoordinatorPorts = {
    assertExactApprovalIsCurrent: async () => {},
    assertQaCleanupLedgerComplete: async () => {},
    preflightFreezeControls: async () => ({ controlsReady: true, reachableTargetCount: 1, expectedTargetCount: 1 }),
    activateAndVerifyCrossTargetFreeze: async () => ({ frozen: true, directBypassProbesFailed: true }),
    captureCatalogManifest: async () => {
      captureCount++;
      return buildCatalogPreservationManifest(liveCatalog, manifestKey);
    },
    executeTarget: async target => {
      if (failAfterFirstTarget && target === PURGE_TARGET_ORDER[1]) {
        failAfterFirstTarget = false;
        throw new Error("injected interruption after first committed target");
      }
      return evidenceForCatalog(buildCatalogPreservationManifest(liveCatalog, manifestKey));
    },
    verifyFinalZeroCountsAndCatalog: async () => finalVerification(buildCatalogPreservationManifest(liveCatalog, manifestKey)),
    persistFinalEvidence: async () => {},
    reopenSupportedWrites: async () => {},
  };

  await assert.rejects(runForwardPurge(journal, ports), /injected interruption/);
  assert.equal((await journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "COMMITTED");
  liveCatalog.restaurants[0].name = "Changed between purge attempts";
  await assert.rejects(runForwardPurge(await PurgeJournal.open(join(root, "journal.json"), "run-resume-catalog-baseline"), ports), /Catalog preservation verification failed/);
  assert.equal(captureCount, 1, "resume must reuse the original manifest instead of capturing a new baseline");
});

test("target claim serializes concurrent purge calls and skips committed targets on retry", async t => {
  const { journal } = await temporaryJournal(t, "run-concurrent-target-claim");
  const initialManifest = buildCatalogPreservationManifest(sampleCatalog(), manifestKey);
  let releaseFirstTarget!: () => void;
  let notifyFirstTarget!: () => void;
  const firstTargetStarted = new Promise<void>(resolve => { notifyFirstTarget = resolve; });
  const holdFirstTarget = new Promise<void>(resolve => { releaseFirstTarget = resolve; });
  const executions: string[] = [];
  const ports: PurgeCoordinatorPorts = {
    assertExactApprovalIsCurrent: async () => {},
    assertQaCleanupLedgerComplete: async () => {},
    preflightFreezeControls: async () => ({ controlsReady: true, reachableTargetCount: 1, expectedTargetCount: 1 }),
    activateAndVerifyCrossTargetFreeze: async () => ({ frozen: true, directBypassProbesFailed: true }),
    captureCatalogManifest: async () => initialManifest,
    executeTarget: async target => {
      executions.push(target);
      if (executions.length === 1) {
        notifyFirstTarget();
        await holdFirstTarget;
      }
      return evidenceForCatalog(initialManifest);
    },
    verifyFinalZeroCountsAndCatalog: async () => finalVerification(initialManifest),
    persistFinalEvidence: async () => {},
    reopenSupportedWrites: async () => {},
  };

  const first = runForwardPurge(journal, ports);
  await firstTargetStarted;
  await assert.rejects(runForwardPurge(journal, ports), /busy or requires manual lock reconciliation/);
  releaseFirstTarget();
  await first;
  assert.deepEqual(executions, [...PURGE_TARGET_ORDER]);

  await runForwardPurge(journal, ports);
  assert.deepEqual(executions, [...PURGE_TARGET_ORDER], "committed targets must never execute again");
});

test("target evidence must match the persisted menu baseline and interruption leaves STARTED", async t => {
  const { journal } = await temporaryJournal(t, "run-target-baseline-guard");
  const baseline = buildCatalogPreservationManifest(sampleCatalog(), manifestKey);
  let matchBaseline = false;
  const ports: PurgeCoordinatorPorts = {
    assertExactApprovalIsCurrent: async () => {},
    assertQaCleanupLedgerComplete: async () => {},
    preflightFreezeControls: async () => ({ controlsReady: true, reachableTargetCount: 1, expectedTargetCount: 1 }),
    activateAndVerifyCrossTargetFreeze: async () => ({ frozen: true, directBypassProbesFailed: true }),
    captureCatalogManifest: async () => baseline,
    executeTarget: async () => matchBaseline
      ? evidenceForCatalog(baseline)
      : { ...evidenceForCatalog(baseline), retainedMenuBytesHmac: "0".repeat(64) },
    verifyFinalZeroCountsAndCatalog: async () => finalVerification(baseline),
    persistFinalEvidence: async () => {},
    reopenSupportedWrites: async () => {},
  };

  await assert.rejects(runForwardPurge(journal, ports), /Catalog preservation verification failed/);
  assert.equal((await journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "STARTED");
  matchBaseline = true;
  await runForwardPurge(journal, ports);
  assert.equal((await journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "COMMITTED");
});

test("per-target commit rejects reassociated photos when independent path and byte sets still match", async t => {
  const catalogBefore: CatalogSnapshot = {
    restaurants: [{ id: "synthetic-gompocha", name: "곰포차 synthetic" }],
    menus: [
      { id: "synthetic-m1", restaurantId: "synthetic-gompocha", name: "Synthetic menu one" },
      { id: "synthetic-m2", restaurantId: "synthetic-gompocha", name: "Synthetic menu two" },
    ],
    menuPhotos: [
      { restaurantId: "synthetic-gompocha", menuId: "synthetic-m1", objectPath: "menu/synthetic-one.webp", bytes: Buffer.from([1, 2]) },
      { restaurantId: "synthetic-gompocha", menuId: "synthetic-m2", objectPath: "menu/synthetic-two.webp", bytes: Buffer.from([3, 4]) },
    ],
  };
  const catalogReassociated = structuredClone(catalogBefore);
  catalogReassociated.menuPhotos[0].menuId = "synthetic-m2";
  catalogReassociated.menuPhotos[0].bytes = Buffer.from([3, 4]);
  catalogReassociated.menuPhotos[1].menuId = "synthetic-m1";
  catalogReassociated.menuPhotos[1].bytes = Buffer.from([1, 2]);

  const baseline = buildCatalogPreservationManifest(catalogBefore, manifestKey);
  const reassociated = buildCatalogPreservationManifest(catalogReassociated, manifestKey);
  assert.deepEqual(reassociated.menuPhotoPaths, baseline.menuPhotoPaths);
  assert.deepEqual(reassociated.menuPhotoBytes, baseline.menuPhotoBytes);
  assert.notEqual(reassociated.menuPhotoObjects.setHmac, baseline.menuPhotoObjects.setHmac);
  assert.notEqual(reassociated.gompocha.menuPhotoObjects.setHmac, baseline.gompocha.menuPhotoObjects.setHmac);

  const directJournal = await temporaryJournal(t, "run-reassociated-photo-direct-commit");
  await directJournal.journal.recordCatalogBaseline(baseline);
  await directJournal.journal.recordStarted(PURGE_TARGET_ORDER[0]);
  await assert.rejects(directJournal.journal.recordCommitted(PURGE_TARGET_ORDER[0], evidenceForCatalog(reassociated)), /Catalog preservation verification failed/);
  assert.equal((await directJournal.journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "STARTED");

  const { journal } = await temporaryJournal(t, "run-reassociated-photo-target-claim");
  const ports: PurgeCoordinatorPorts = {
    assertExactApprovalIsCurrent: async () => {},
    assertQaCleanupLedgerComplete: async () => {},
    preflightFreezeControls: async () => ({ controlsReady: true, reachableTargetCount: 1, expectedTargetCount: 1 }),
    activateAndVerifyCrossTargetFreeze: async () => ({ frozen: true, directBypassProbesFailed: true }),
    captureCatalogManifest: async () => baseline,
    executeTarget: async () => evidenceForCatalog(reassociated),
    verifyFinalZeroCountsAndCatalog: async () => finalVerification(baseline),
    persistFinalEvidence: async () => {},
    reopenSupportedWrites: async () => {},
  };
  await assert.rejects(runForwardPurge(journal, ports), /Catalog preservation verification failed/);
  assert.equal((await journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "STARTED");
});

test("final and adapter evidence reject unknown runtime fields before persistence", async t => {
  const { journal } = await temporaryJournal(t, "run-unknown-purge-fields");
  const baseline = buildCatalogPreservationManifest(sampleCatalog(), manifestKey);
  const ports: PurgeCoordinatorPorts = {
    assertExactApprovalIsCurrent: async () => {},
    assertQaCleanupLedgerComplete: async () => {},
    preflightFreezeControls: async () => ({ controlsReady: true, reachableTargetCount: 1, expectedTargetCount: 1 }),
    activateAndVerifyCrossTargetFreeze: async () => ({ frozen: true, directBypassProbesFailed: true }),
    captureCatalogManifest: async () => baseline,
    executeTarget: async () => ({ ...evidenceForCatalog(baseline), rawPath: "must-not-persist" }) as TargetCheckpointEvidence,
    verifyFinalZeroCountsAndCatalog: async () => finalVerification(baseline),
    persistFinalEvidence: async () => {},
    reopenSupportedWrites: async () => {},
  };
  await assert.rejects(runForwardPurge(journal, ports), /unsupported fields/);
  assert.equal((await journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "STARTED");

  const validPorts = {
    ...ports,
    executeTarget: async () => evidenceForCatalog(baseline),
    verifyFinalZeroCountsAndCatalog: async () => ({ ...finalVerification(baseline), rawPath: "must-not-persist" }) as PurgeFinalVerification,
  } satisfies PurgeCoordinatorPorts;
  await assert.rejects(runForwardPurge(journal, validPorts), /Final purge evidence contains unsupported fields/);
  assert.equal((await journal.checkpoint(PURGE_TARGET_ORDER[0]))?.status, "COMMITTED");
});
