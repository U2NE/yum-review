import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalUrl,
  createLocalAdminClient,
  inspectTargetState,
  listLocalAuthUsers,
  mediaAssociationStage,
  planCounts,
  readImportArtifact,
  TASK07_MEDIA_CONTRACT,
} from "./import-supabase.ts";

type VerifyOptions = {
  inputPath: string;
  databaseUrlEnv: string;
  supabaseUrlEnv: string;
  serviceKeyEnv: string;
};

function parseArgs(argv: string[]): VerifyOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      process.stdout.write("Usage: npm run migrate:verify -- --input <private-export> --database-url-env <ENV> --supabase-url-env <ENV> --service-key-env <ENV>\n");
      process.exit(0);
    }
    if (!key?.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Verifier arguments are invalid.");
    if (values.has(key)) throw new Error("Duplicate verifier option.");
    values.set(key, argv[index + 1]); index += 1;
  }
  const expected = ["--input", "--database-url-env", "--supabase-url-env", "--service-key-env"];
  if (values.size !== expected.length || expected.some((key) => !values.has(key))) throw new Error("Verifier requires explicit private input and local target variables.");
  for (const key of expected.slice(1)) if (!/^[A-Z_][A-Z0-9_]*$/.test(values.get(key)!)) throw new Error("Verifier target options must name environment variables.");
  return {
    inputPath: path.resolve(values.get("--input")!), databaseUrlEnv: values.get("--database-url-env")!,
    supabaseUrlEnv: values.get("--supabase-url-env")!, serviceKeyEnv: values.get("--service-key-env")!,
  };
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`The explicitly named target variable ${name} is not set.`);
  return value;
}

function actionCounts(plan: Awaited<ReturnType<typeof inspectTargetState>>) {
  const result: Record<string, { exact: number; missing: number; deferred: number; conflict: number }> = {};
  for (const [entity, actions] of Object.entries(plan.actions)) {
    const counts = { exact: 0, missing: 0, deferred: 0, conflict: 0 };
    for (const action of actions.values()) {
      if (action === "exact_skip") counts.exact += 1;
      else if (action === "insert") counts.missing += 1;
      else if (action === "deferred") counts.deferred += 1;
      else counts.conflict += 1;
    }
    result[entity] = counts;
  }
  return result;
}

async function readOrphanCounts(client: Client) {
  const result = await client.query<{ relation: string; count: string }>(`SELECT 'menus_without_restaurant' AS relation,
      COUNT(*)::text AS count FROM public.menus m LEFT JOIN public.restaurants r ON r.id = m.restaurant_id WHERE r.id IS NULL
    UNION ALL SELECT 'reviews_without_user_or_menu', COUNT(*)::text FROM public.reviews rv
      LEFT JOIN auth.users u ON u.id = rv.user_id LEFT JOIN public.menus m ON m.id = rv.menu_id
      WHERE u.id IS NULL OR m.id IS NULL
    UNION ALL SELECT 'owners_without_user_or_restaurant', COUNT(*)::text FROM private.restaurant_owners o
      LEFT JOIN auth.users u ON u.id = o.user_id LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
      WHERE u.id IS NULL OR r.id IS NULL
    UNION ALL SELECT 'review_photos_without_review_or_media', COUNT(*)::text FROM public.review_photos rp
      LEFT JOIN public.reviews r ON r.id = rp.review_id LEFT JOIN public.media_assets a ON a.id = rp.media_id
      WHERE r.id IS NULL OR a.id IS NULL
    UNION ALL SELECT 'menu_photo_without_active_storage_object', COUNT(*)::text FROM public.menus m
      LEFT JOIN public.media_assets a ON a.id = m.photo_media_id
      WHERE m.photo_media_id IS NOT NULL AND (a.id IS NULL OR a.lifecycle_status IS DISTINCT FROM 'ACTIVE'
        OR a.activated_at IS NULL OR NOT EXISTS (
          SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path))
    UNION ALL SELECT 'review_photo_without_active_storage_object', COUNT(*)::text FROM public.review_photos rp
      LEFT JOIN public.media_assets a ON a.id = rp.media_id
      WHERE a.id IS NULL OR a.lifecycle_status IS DISTINCT FROM 'ACTIVE' OR a.activated_at IS NULL OR NOT EXISTS (
        SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path)
    UNION ALL SELECT 'legacy_user_maps_without_auth_user', COUNT(*)::text FROM private.legacy_user_identity li
      LEFT JOIN auth.users u ON u.id = li.auth_user_id WHERE u.id IS NULL
    UNION ALL SELECT 'legacy_media_maps_without_asset', COUNT(*)::text FROM private.legacy_media_asset_identity li
      LEFT JOIN public.media_assets a ON a.id = li.media_id WHERE a.id IS NULL`);
  return Object.fromEntries(result.rows.map((row) => [row.relation, Number(row.count)]));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const artifact = await readImportArtifact(options.inputPath);
  const databaseUrl = getEnv(options.databaseUrlEnv);
  const supabaseUrl = getEnv(options.supabaseUrlEnv);
  const serviceKey = getEnv(options.serviceKeyEnv);
  assertLocalUrl(databaseUrl, "postgres");
  const admin = createLocalAdminClient(supabaseUrl, serviceKey);
  const client = new Client({ connectionString: databaseUrl, application_name: "yum-review-local-import-verifier", statement_timeout: 60_000 });
  let connected = false;
  try {
    await client.connect(); connected = true;
    const authUsers = await listLocalAuthUsers(admin);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const plan = await inspectTargetState(client, authUsers, artifact);
    const orphans = await readOrphanCounts(client);
    await client.query("COMMIT");
    const counts = planCounts(plan);
    const orphanTotal = Object.values(orphans).reduce((sum, count) => sum + count, 0);
    const report = {
      ok: counts.plannedRows === 0 && counts.conflicts === 0 && orphanTotal === 0,
      linksComplete: mediaAssociationStage(plan) === "complete",
      target: "local-disposable",
      sourceCounts: artifact.manifest.counts,
      targetMatches: actionCounts(plan),
      targetPlan: counts,
      orphanCounts: orphans,
      identityMappings: {
        legacyUsers: actionCounts(plan).users?.exact ?? 0,
        unconfirmedAuthUsers: actionCounts(plan).users?.exact ?? 0,
        mediaAssetRows: actionCounts(plan).mediaAssets?.exact ?? 0,
        privateMediaRights: actionCounts(plan).legacyMediaRights?.exact ?? 0,
      },
      verifiedLinks: {
        menuPhotos: actionCounts(plan).menuPhotos?.exact ?? 0,
        reviewPhotos: actionCounts(plan).reviewPhotos?.exact ?? 0,
      },
      preservedNullConsentRows: artifact.data.reviews.filter((review) => review.nonEventReviewConsent === null).length,
      deferred_media: plan.deferredMedia,
      deferred_links: plan.deferredLinks,
      media_association_stage: mediaAssociationStage(plan),
      task07_contract: TASK07_MEDIA_CONTRACT,
    };
    process.stdout.write(JSON.stringify(report) + "\n");
    if (!report.ok) process.exitCode = 2;
  } catch {
    if (connected) await client.query("ROLLBACK").catch(() => undefined);
    process.stderr.write("Verification failed. Sensitive values and Auth/database response details were withheld.\n");
    process.exitCode = 1;
  } finally {
    if (connected) await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("Verification failed. Sensitive values and response details were withheld.\n");
    process.exitCode = 1;
  });
}
