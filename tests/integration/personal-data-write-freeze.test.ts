import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  APPROVED_PLAN_HASH,
  APPROVED_SPEC_HASH,
  AUTHORIZATION_SIGNAL,
  EXACT_RUN_ID,
  EXPECTED_AUTHORIZATION,
  hasExactAuthorization,
  parseOperation,
  parseVolumeMap,
  scanVolume,
} from "../../scripts/qa/purge-write-freeze";
import { toggleReviewLike } from "@/lib/data/likes";
import { attachMenuPhoto, attachReviewPhoto, queueDetachedMediaCleanup } from "@/lib/data/media";
import { deleteReview, saveReview } from "@/lib/data/reviews";
import { toggleMenuWishlist } from "@/lib/data/wishlists";

function frozenClient() {
  const calls: string[] = [];
  const client = {
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { data: true, error: null };
    },
    from(name: string) {
      calls.push(`from:${name}`);
      throw new Error("mutation query should not be constructed while frozen");
    },
  };
  return { client: client as never, calls };
}

const blockedMutations: Array<[string, (client: never) => Promise<unknown>]> = [
  ["review like", (client) => toggleReviewLike(client, 12, "owner", "viewer", false)],
  ["wishlist", (client) => toggleMenuWishlist(client, 12, "viewer", false)],
  ["review save", (client) => saveReview(client, "viewer", {
    menuId: 12,
    overallScore: 4,
    tasteScore: null,
    valueScore: null,
    portionScore: null,
    comment: "fixture",
  })],
  ["review delete", (client) => deleteReview(client, 12, "viewer")],
  ["menu photo attachment", (client) => attachMenuPhoto(client, 12, "00000000-0000-4000-8000-000000000012")],
  ["review photo attachment", (client) => attachReviewPhoto(client, 12, "00000000-0000-4000-8000-000000000012")],
  ["media cleanup request", (client) => queueDetachedMediaCleanup(client, "00000000-0000-4000-8000-000000000012")],
];

for (const [label, invoke] of blockedMutations) {
  test(`${label} fails closed before issuing a PostgREST write when the freeze is active`, async () => {
    const { client, calls } = frozenClient();
    await assert.rejects(invoke(client), /개인정보 변경을 잠시 중단했습니다/);
    assert.deepEqual(calls, ["rpc:personal_data_write_is_frozen"]);
  });
}

test("purge/write-freeze modes require the exact approved run and reject duplicate flags", () => {
  assert.deepEqual(parseOperation(["--preflight", "--run-id", EXACT_RUN_ID]), {
    mode: "--preflight",
    runId: EXACT_RUN_ID,
  });
  assert.ok("usageError" in parseOperation(["--release", "--run-id", "other"]));
  assert.ok("usageError" in parseOperation(["--release", "--run-id", EXACT_RUN_ID, "--run-id", EXACT_RUN_ID]));
  assert.equal(EXPECTED_AUTHORIZATION,
    "run=" + EXACT_RUN_ID + ";spec=" + APPROVED_SPEC_HASH + ";plan=" + APPROVED_PLAN_HASH);
});

test("purge/write-freeze authorization binds the approved run, SPEC, and PLAN", () => {
  assert.equal(hasExactAuthorization({ [AUTHORIZATION_SIGNAL]: EXPECTED_AUTHORIZATION }), true);
  assert.equal(hasExactAuthorization({ [AUTHORIZATION_SIGNAL]: "present" }), false);
  assert.equal(hasExactAuthorization({
    [AUTHORIZATION_SIGNAL]: "run=" + EXACT_RUN_ID + ";spec=" + APPROVED_SPEC_HASH + ";plan=wrong",
  }), false);
});

test("media volume map rejects unsafe or empty enumeration", () => {
  assert.throws(() => parseVolumeMap(undefined), /is required/);
  assert.throws(() => parseVolumeMap("{}"), /at least one volume/);
  assert.throws(() => parseVolumeMap(JSON.stringify({ volumeA: "../media" })), /invalid stable ID or unsafe root/);
});

test("volume scan matches the Spring inventory and returns opaque digests", async t => {
  const parent = await mkdtemp(join(tmpdir(), "purge-freeze-"));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "media");
  await mkdir(join(root, "tmp"), { recursive: true });
  await writeFile(join(root, "review-00000000-0000-4000-8000-000000000001.webp"), Buffer.from([1, 2, 3]));
  await writeFile(join(root, "menu-00000000-0000-4000-8000-000000000002.webp"), Buffer.from([4, 5]));
  await writeFile(join(root, "tmp", "yum-stage-fixture123.part"), Buffer.from([6]));

  const result = await scanVolume("local-media-1", root);
  assert.equal(result.reviewCount, 1);
  assert.equal(result.temporaryCount, 1);
  assert.equal(result.menuCount, 1);
  assert.match(result.reviewDigests[0], /^[0-9a-f]{64}$/);
  assert.match(result.temporaryDigests[0], /^[0-9a-f]{64}$/);
  assert.match(result.menuDigests[0], /^[0-9a-f]{64}$/);
});

test("volume scan rejects unknown entries before a trusted checkpoint can be recorded", async t => {
  const parent = await mkdtemp(join(tmpdir(), "purge-freeze-"));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "media");
  await mkdir(join(root, "tmp"), { recursive: true });
  await writeFile(join(root, "unknown.bin"), Buffer.from([1]));
  await assert.rejects(scanVolume("local-media-1", root), /unknown entry/);
});
