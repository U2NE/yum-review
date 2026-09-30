import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertValidCatalogPreservationManifest, type CatalogPreservationManifest } from "./catalog-preservation-manifest";

export const PURGE_TARGET_ORDER = [
  "supabase-review-storage",
  "supabase-db-auth",
  "legacy-review-media",
  "legacy-db",
] as const;

export type PurgeTarget = (typeof PURGE_TARGET_ORDER)[number];

export interface TargetCheckpointEvidence {
  removedRows: number;
  remainingRows: number;
  removedObjects: number;
  remainingObjects: number;
  retainedMenuPathHmac: string;
  retainedMenuBytesHmac: string;
  retainedMenuPhotoObjectSetHmac: string;
  retainedGompochaMenuPhotoObjectSetHmac: string;
  verifiedAt: string;
}

export interface StartedCheckpoint {
  status: "STARTED";
  startedAt: string;
}

export interface CommittedCheckpoint {
  status: "COMMITTED";
  startedAt: string;
  committedAt: string;
  evidence: TargetCheckpointEvidence;
}

export type TargetCheckpoint = StartedCheckpoint | CommittedCheckpoint;
export type PurgeCheckpoints = Partial<Record<PurgeTarget, TargetCheckpoint>>;

interface JournalDocument {
  schemaVersion: 1;
  runId: string;
  targetOrder: PurgeTarget[];
  checkpoints: PurgeCheckpoints;
  catalogBaseline?: CatalogPreservationManifest;
}

function now(): string {
  return new Date().toISOString();
}

function validRunId(runId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,80}$/i.test(runId);
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function validateEvidence(evidence: TargetCheckpointEvidence): void {
  if (!evidence || typeof evidence !== "object" || !exactKeys(evidence, [
    "removedRows", "remainingRows", "removedObjects", "remainingObjects", "retainedMenuPathHmac", "retainedMenuBytesHmac",
    "retainedMenuPhotoObjectSetHmac", "retainedGompochaMenuPhotoObjectSetHmac", "verifiedAt",
  ])) throw new Error("Purge evidence contains unsupported fields.");
  const counts = [evidence.removedRows, evidence.remainingRows, evidence.removedObjects, evidence.remainingObjects];
  if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Purge evidence counts are invalid.");
  if (evidence.remainingRows !== 0 || evidence.remainingObjects !== 0) throw new Error("A target cannot commit while personal rows or review objects remain.");
  if (!validDigest(evidence.retainedMenuPathHmac) || !validDigest(evidence.retainedMenuBytesHmac) ||
      !validDigest(evidence.retainedMenuPhotoObjectSetHmac) || !validDigest(evidence.retainedGompochaMenuPhotoObjectSetHmac)) {
    throw new Error("Purge evidence hashes are invalid.");
  }
  if (!validTimestamp(evidence.verifiedAt)) throw new Error("Purge evidence timestamp is invalid.");
}

function assertEvidenceMatchesCatalogBaseline(evidence: TargetCheckpointEvidence, baseline: CatalogPreservationManifest): void {
  if (evidence.retainedMenuPathHmac !== baseline.menuPhotoPaths.setHmac ||
      evidence.retainedMenuBytesHmac !== baseline.menuPhotoBytes.setHmac ||
      evidence.retainedMenuPhotoObjectSetHmac !== baseline.menuPhotoObjects.setHmac ||
      evidence.retainedGompochaMenuPhotoObjectSetHmac !== baseline.gompocha.menuPhotoObjects.setHmac) {
    throw new Error("Catalog preservation verification failed for purge target.");
  }
}

/** Rejects unknown runtime fields and copies only the durable, privacy-safe evidence projection. */
export function projectTargetCheckpointEvidence(value: unknown): TargetCheckpointEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Purge evidence is invalid.");
  const source = value as Record<string, unknown>;
  if (!exactKeys(source, [
    "removedRows", "remainingRows", "removedObjects", "remainingObjects", "retainedMenuPathHmac", "retainedMenuBytesHmac",
    "retainedMenuPhotoObjectSetHmac", "retainedGompochaMenuPhotoObjectSetHmac", "verifiedAt",
  ])) throw new Error("Purge evidence contains unsupported fields.");
  const evidence = {
    removedRows: source.removedRows,
    remainingRows: source.remainingRows,
    removedObjects: source.removedObjects,
    remainingObjects: source.remainingObjects,
    retainedMenuPathHmac: source.retainedMenuPathHmac,
    retainedMenuBytesHmac: source.retainedMenuBytesHmac,
    retainedMenuPhotoObjectSetHmac: source.retainedMenuPhotoObjectSetHmac,
    retainedGompochaMenuPhotoObjectSetHmac: source.retainedGompochaMenuPhotoObjectSetHmac,
    verifiedAt: source.verifiedAt,
  } as TargetCheckpointEvidence;
  validateEvidence(evidence);
  return evidence;
}

function validateDocument(value: unknown, runId: string): JournalDocument {
  if (!value || typeof value !== "object") throw new Error("Purge journal is invalid.");
  const doc = value as Partial<JournalDocument>;
  const keys = Object.keys(value as object).sort();
  const hasBaseKeys = exactKeys(value as object, ["schemaVersion", "runId", "targetOrder", "checkpoints"]);
  const hasBaselineKeys = exactKeys(value as object, ["schemaVersion", "runId", "targetOrder", "checkpoints", "catalogBaseline"]);
  if ((!hasBaseKeys && !hasBaselineKeys) || doc.schemaVersion !== 1 || doc.runId !== runId || !Array.isArray(doc.targetOrder) || !isDeepStrictEqual(doc.targetOrder, PURGE_TARGET_ORDER)) {
    throw new Error("Purge journal identity or target order does not match.");
  }
  if (keys.includes("catalogBaseline")) assertValidCatalogPreservationManifest(doc.catalogBaseline);
  if (!doc.checkpoints || typeof doc.checkpoints !== "object" || Array.isArray(doc.checkpoints)) throw new Error("Purge journal checkpoints are invalid.");
  for (const [target, checkpoint] of Object.entries(doc.checkpoints)) {
    if (!PURGE_TARGET_ORDER.includes(target as PurgeTarget) || !checkpoint || typeof checkpoint !== "object") throw new Error("Purge journal checkpoint is invalid.");
    const entry = checkpoint as TargetCheckpoint;
    if (entry.status === "STARTED") {
      if (!exactKeys(entry, ["status", "startedAt"]) || !validTimestamp(entry.startedAt)) throw new Error("Purge journal checkpoint is invalid.");
    } else if (entry.status === "COMMITTED") {
      if (!exactKeys(entry, ["status", "startedAt", "committedAt", "evidence"]) || !validTimestamp(entry.startedAt) || !validTimestamp(entry.committedAt)) throw new Error("Purge journal checkpoint is invalid.");
      validateEvidence(entry.evidence);
      if (doc.catalogBaseline) assertEvidenceMatchesCatalogBaseline(entry.evidence, doc.catalogBaseline);
    } else {
      throw new Error("Purge journal checkpoint is invalid.");
    }
  }
  const checkpoints = doc.checkpoints as PurgeCheckpoints;
  if (Object.keys(checkpoints).length > 0 && !doc.catalogBaseline) throw new Error("Purge journal is missing its original catalog baseline after target work began.");
  let foundIncomplete = false;
  for (const target of PURGE_TARGET_ORDER) {
    const entry = checkpoints[target];
    if (!entry) {
      foundIncomplete = true;
      continue;
    }
    if (foundIncomplete) throw new Error("Purge journal is not forward-only.");
    if (entry.status === "STARTED") foundIncomplete = true;
  }
  return {
    schemaVersion: 1,
    runId,
    targetOrder: [...PURGE_TARGET_ORDER],
    checkpoints,
    ...(doc.catalogBaseline ? { catalogBaseline: structuredClone(doc.catalogBaseline) } : {}),
  };
}

async function readDocument(path: string, runId: string): Promise<JournalDocument> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return validateDocument(parsed, runId);
}

async function persistDocument(path: string, document: JournalDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export class PurgeJournal {
  private constructor(private readonly filePath: string, private readonly runId: string) {}

  static async open(filePath: string, runId: string): Promise<PurgeJournal> {
    if (!validRunId(runId)) throw new Error("Purge run ID is invalid.");
    const path = resolve(filePath);
    await mkdir(dirname(path), { recursive: true });
    const lockPath = `${path}.lock`;
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch {
      throw new Error("Purge journal is busy or requires manual lock reconciliation.");
    }
    try {
      try {
        await readDocument(path, runId);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw new Error("Existing purge journal could not be safely resumed.");
        await persistDocument(path, { schemaVersion: 1, runId, targetOrder: [...PURGE_TARGET_ORDER], checkpoints: {} });
      }
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
    return new PurgeJournal(path, runId);
  }

  async snapshot(): Promise<PurgeCheckpoints> {
    const document = await readDocument(this.filePath, this.runId);
    return structuredClone(document.checkpoints);
  }

  async catalogBaseline(): Promise<CatalogPreservationManifest | undefined> {
    const document = await readDocument(this.filePath, this.runId);
    return document.catalogBaseline ? structuredClone(document.catalogBaseline) : undefined;
  }

  async recordCatalogBaseline(baseline: CatalogPreservationManifest): Promise<CatalogPreservationManifest> {
    assertValidCatalogPreservationManifest(baseline);
    return this.mutate(async document => {
      if (document.catalogBaseline) {
        if (!isDeepStrictEqual(document.catalogBaseline, baseline)) throw new Error("Original catalog baseline cannot be changed.");
        return document.catalogBaseline;
      }
      if (Object.keys(document.checkpoints).length > 0) throw new Error("Cannot add a catalog baseline after target work began.");
      document.catalogBaseline = structuredClone(baseline);
      return document.catalogBaseline;
    });
  }

  async checkpoint(target: PurgeTarget): Promise<TargetCheckpoint | undefined> {
    const document = await readDocument(this.filePath, this.runId);
    const checkpoint = document.checkpoints[target];
    return checkpoint ? structuredClone(checkpoint) : undefined;
  }

  async recordStarted(target: PurgeTarget): Promise<StartedCheckpoint | CommittedCheckpoint> {
    return this.mutate(async document => {
      if (!document.catalogBaseline) throw new Error("The original catalog baseline must be persisted before a target starts.");
      const existing = document.checkpoints[target];
      if (existing?.status === "COMMITTED") return existing;
      this.assertCurrentTarget(document, target);
      if (existing?.status === "STARTED") return existing;
      const checkpoint: StartedCheckpoint = { status: "STARTED", startedAt: now() };
      document.checkpoints[target] = checkpoint;
      return checkpoint;
    });
  }

  async recordCommitted(target: PurgeTarget, evidence: TargetCheckpointEvidence): Promise<CommittedCheckpoint> {
    const safeEvidence = projectTargetCheckpointEvidence(evidence);
    return this.mutate(async document => {
      const existing = document.checkpoints[target];
      if (existing?.status === "COMMITTED") {
        if (!isDeepStrictEqual(existing.evidence, safeEvidence)) throw new Error("Committed purge checkpoints cannot be changed.");
        return existing;
      }
      this.assertCurrentTarget(document, target);
      if (!existing || existing.status !== "STARTED") throw new Error("A target must be STARTED before it can be COMMITTED.");
      if (!document.catalogBaseline) throw new Error("The original catalog baseline must be persisted before a target can commit.");
      assertEvidenceMatchesCatalogBaseline(safeEvidence, document.catalogBaseline);
      const checkpoint: CommittedCheckpoint = {
        status: "COMMITTED",
        startedAt: existing.startedAt,
        committedAt: now(),
        evidence: safeEvidence,
      };
      document.checkpoints[target] = checkpoint;
      return checkpoint;
    });
  }

  /**
   * Holds the inter-process journal lock across STARTED persistence, adapter execution,
   * verification, and COMMITTED persistence. A thrown callback leaves STARTED durable.
   */
  async withTargetClaim(
    target: PurgeTarget,
    operation: (claim: { startedAt: string; commit(evidence: unknown): Promise<CommittedCheckpoint> }) => Promise<void>,
  ): Promise<boolean> {
    if (!PURGE_TARGET_ORDER.includes(target)) throw new Error("Purge target is invalid.");
    return this.withExclusiveLock(async () => {
      const document = await readDocument(this.filePath, this.runId);
      if (!document.catalogBaseline) throw new Error("The original catalog baseline must be persisted before a target starts.");

      const existing = document.checkpoints[target];
      if (existing?.status === "COMMITTED") {
        assertEvidenceMatchesCatalogBaseline(existing.evidence, document.catalogBaseline);
        return false;
      }
      this.assertCurrentTarget(document, target);

      let started = existing;
      if (!started) {
        started = { status: "STARTED", startedAt: now() };
        document.checkpoints[target] = started;
        await persistDocument(this.filePath, document);
      }

      let committed = false;
      const commit = async (rawEvidence: unknown): Promise<CommittedCheckpoint> => {
        if (committed) throw new Error("A target claim can commit only once.");
        const evidence = projectTargetCheckpointEvidence(rawEvidence);
        assertEvidenceMatchesCatalogBaseline(evidence, document.catalogBaseline!);
        const current = document.checkpoints[target];
        if (!current || current.status !== "STARTED") throw new Error("A target must be STARTED before it can be COMMITTED.");
        this.assertCurrentTarget(document, target);
        const checkpoint: CommittedCheckpoint = {
          status: "COMMITTED",
          startedAt: current.startedAt,
          committedAt: now(),
          evidence,
        };
        document.checkpoints[target] = checkpoint;
        await persistDocument(this.filePath, document);
        committed = true;
        return structuredClone(checkpoint);
      };

      await operation({ startedAt: started.startedAt, commit });
      if (!committed) throw new Error("A target claim completed without a COMMITTED checkpoint.");
      return true;
    });
  }

  private assertCurrentTarget(document: JournalDocument, target: PurgeTarget): void {
    const next = PURGE_TARGET_ORDER.find(item => document.checkpoints[item]?.status !== "COMMITTED");
    if (next !== target) throw new Error("Purge journal only permits the next forward target.");
  }

  private async mutate<T>(operation: (document: JournalDocument) => Promise<T>): Promise<T> {
    return this.withExclusiveLock(async () => {
      const document = await readDocument(this.filePath, this.runId);
      const result = await operation(document);
      await persistDocument(this.filePath, document);
      return structuredClone(result);
    });
  }

  private async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch {
      throw new Error("Purge journal is busy or requires manual lock reconciliation.");
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}
