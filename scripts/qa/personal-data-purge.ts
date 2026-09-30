import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { assertCatalogPreserved, type CatalogPreservationManifest } from "./catalog-preservation-manifest";
import { projectTargetCheckpointEvidence, PURGE_TARGET_ORDER, PurgeJournal, type PurgeTarget, type TargetCheckpointEvidence } from "./purge-journal";

export interface PurgeFinalVerification {
  remainingAccounts: number;
  remainingLegacyAccounts: number;
  remainingProfiles: number;
  remainingAdmins: number;
  remainingReviews: number;
  remainingLikes: number;
  remainingFavorites: number;
  remainingRoleMappings: number;
  remainingOwnerMappings: number;
  remainingReviewPhotoAssociations: number;
  remainingReviewMedia: number;
  remainingLegacyReviewMediaFiles: number;
  remainingUtilityAccounts: number;
  remainingAllowlistEntries: number;
  catalogAfter: CatalogPreservationManifest;
  evidenceHmac: string;
  verifiedAt: string;
}

export interface PurgeCoordinatorPorts {
  assertExactApprovalIsCurrent(): Promise<void>;
  assertQaCleanupLedgerComplete(): Promise<void>;
  preflightFreezeControls(): Promise<{ controlsReady: boolean; reachableTargetCount: number; expectedTargetCount: number }>;
  activateAndVerifyCrossTargetFreeze(): Promise<{ frozen: boolean; directBypassProbesFailed: boolean }>;
  captureCatalogManifest(): Promise<CatalogPreservationManifest>;
  executeTarget(target: PurgeTarget): Promise<TargetCheckpointEvidence>;
  verifyFinalZeroCountsAndCatalog(): Promise<PurgeFinalVerification>;
  persistFinalEvidence(evidence: Omit<PurgeFinalVerification, "catalogAfter"> & { catalogBefore: CatalogPreservationManifest; catalogAfter: CatalogPreservationManifest }): Promise<void>;
  reopenSupportedWrites(): Promise<void>;
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function projectFinalVerification(value: unknown): PurgeFinalVerification {
  const keys = [
    "remainingAccounts", "remainingLegacyAccounts", "remainingProfiles", "remainingAdmins", "remainingReviews",
    "remainingLikes", "remainingFavorites", "remainingRoleMappings", "remainingOwnerMappings",
    "remainingReviewPhotoAssociations", "remainingReviewMedia", "remainingLegacyReviewMediaFiles",
    "remainingUtilityAccounts", "remainingAllowlistEntries", "catalogAfter", "evidenceHmac", "verifiedAt",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error("Final purge evidence contains unsupported fields.");
  }
  const source = value as Record<string, unknown>;
  return {
    remainingAccounts: source.remainingAccounts as number,
    remainingLegacyAccounts: source.remainingLegacyAccounts as number,
    remainingProfiles: source.remainingProfiles as number,
    remainingAdmins: source.remainingAdmins as number,
    remainingReviews: source.remainingReviews as number,
    remainingLikes: source.remainingLikes as number,
    remainingFavorites: source.remainingFavorites as number,
    remainingRoleMappings: source.remainingRoleMappings as number,
    remainingOwnerMappings: source.remainingOwnerMappings as number,
    remainingReviewPhotoAssociations: source.remainingReviewPhotoAssociations as number,
    remainingReviewMedia: source.remainingReviewMedia as number,
    remainingLegacyReviewMediaFiles: source.remainingLegacyReviewMediaFiles as number,
    remainingUtilityAccounts: source.remainingUtilityAccounts as number,
    remainingAllowlistEntries: source.remainingAllowlistEntries as number,
    catalogAfter: structuredClone(source.catalogAfter) as CatalogPreservationManifest,
    evidenceHmac: source.evidenceHmac as string,
    verifiedAt: source.verifiedAt as string,
  };
}

function assertZeroCounts(result: PurgeFinalVerification): void {
  const zeroCounts = [
    result.remainingAccounts,
    result.remainingLegacyAccounts,
    result.remainingProfiles,
    result.remainingAdmins,
    result.remainingReviews,
    result.remainingLikes,
    result.remainingFavorites,
    result.remainingRoleMappings,
    result.remainingOwnerMappings,
    result.remainingReviewPhotoAssociations,
    result.remainingReviewMedia,
    result.remainingLegacyReviewMediaFiles,
    result.remainingUtilityAccounts,
    result.remainingAllowlistEntries,
  ];
  if (zeroCounts.some(value => !Number.isSafeInteger(value) || value !== 0)) throw new Error("Final personal-data verification did not reach zero counts.");
  if (!validDigest(result.evidenceHmac) || !Number.isFinite(Date.parse(result.verifiedAt))) throw new Error("Final purge evidence is invalid.");
}

/**
 * Runs only through explicitly supplied target ports. This module contains no database,
 * Auth, Storage, hosted-service, or legacy-app connector of its own.
 */
export async function runForwardPurge(journal: PurgeJournal, ports: PurgeCoordinatorPorts): Promise<void> {
  await ports.assertExactApprovalIsCurrent();
  await ports.assertQaCleanupLedgerComplete();

  // Freeze readiness is checked before any data-count snapshot is requested.
  const preflight = await ports.preflightFreezeControls();
  if (!preflight.controlsReady || preflight.expectedTargetCount < 1 || preflight.reachableTargetCount !== preflight.expectedTargetCount) {
    throw new Error("Purge freeze preflight is incomplete; no purge target was started.");
  }
  const freeze = await ports.activateAndVerifyCrossTargetFreeze();
  if (!freeze.frozen || !freeze.directBypassProbesFailed) throw new Error("Cross-target write-freeze verification failed; keep reached targets frozen.");

  let catalogBefore = await journal.catalogBaseline();
  if (!catalogBefore) catalogBefore = await journal.recordCatalogBaseline(await ports.captureCatalogManifest());
  const originalCatalogBaseline = catalogBefore;
  for (const target of PURGE_TARGET_ORDER) {
    await journal.withTargetClaim(target, async claim => {
      const evidence = projectTargetCheckpointEvidence(await ports.executeTarget(target));
      if (evidence.retainedMenuPathHmac !== originalCatalogBaseline.menuPhotoPaths.setHmac ||
          evidence.retainedMenuBytesHmac !== originalCatalogBaseline.menuPhotoBytes.setHmac ||
          evidence.retainedMenuPhotoObjectSetHmac !== originalCatalogBaseline.menuPhotoObjects.setHmac ||
          evidence.retainedGompochaMenuPhotoObjectSetHmac !== originalCatalogBaseline.gompocha.menuPhotoObjects.setHmac) {
        throw new Error("Catalog preservation verification failed for purge target.");
      }
      await claim.commit(evidence);
    });
  }

  const final = projectFinalVerification(await ports.verifyFinalZeroCountsAndCatalog());
  assertZeroCounts(final);
  assertCatalogPreserved(originalCatalogBaseline, final.catalogAfter);
  await ports.persistFinalEvidence({
    remainingAccounts: final.remainingAccounts,
    remainingLegacyAccounts: final.remainingLegacyAccounts,
    remainingProfiles: final.remainingProfiles,
    remainingAdmins: final.remainingAdmins,
    remainingReviews: final.remainingReviews,
    remainingLikes: final.remainingLikes,
    remainingFavorites: final.remainingFavorites,
    remainingRoleMappings: final.remainingRoleMappings,
    remainingOwnerMappings: final.remainingOwnerMappings,
    remainingReviewPhotoAssociations: final.remainingReviewPhotoAssociations,
    remainingReviewMedia: final.remainingReviewMedia,
    remainingLegacyReviewMediaFiles: final.remainingLegacyReviewMediaFiles,
    remainingUtilityAccounts: final.remainingUtilityAccounts,
    remainingAllowlistEntries: final.remainingAllowlistEntries,
    evidenceHmac: final.evidenceHmac,
    verifiedAt: final.verifiedAt,
    catalogBefore: structuredClone(originalCatalogBaseline),
    catalogAfter: structuredClone(final.catalogAfter),
  });

  // Reopening writes is deliberately the final operation in the success path.
  await ports.reopenSupportedWrites();
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help")) {
    process.stdout.write("This command is a fail-closed purge coordinator. It does not connect to hosted or live targets.\n");
    return;
  }
  throw new Error("No run-bound local purge adapter is configured; no target was contacted or modified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("Purge command stopped before target access.\n");
    process.exitCode = 1;
  });
}
