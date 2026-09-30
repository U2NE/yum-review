import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { Client, type QueryResult } from "pg";

const DEFAULT_LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_DATABASE_URL = process.env.SUPABASE_LOCAL_DB_URL ?? DEFAULT_LOCAL_DATABASE_URL;
const LOCATION_WRITE_SQL = `
  SELECT public.server_set_restaurant_location(
    $1::bigint, $2::uuid, 'local race fixture', 1, 2, 'restaurant-location-v1'
  ) AS location_saved
`;

type Fixture = { ownerId: string; restaurantId: string };
type QueryOutcome =
  | { result: QueryResult; error?: never }
  | { result?: never; error: Error & { code?: string } };

function requireLoopbackDatabaseUrl(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("SUPABASE_LOCAL_DB_URL must be a valid local database URL");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  assert.ok(
    ["127.0.0.1", "localhost", "::1"].includes(hostname),
    "The owner-revocation race test accepts loopback database hosts only",
  );
}

async function createFixture(client: Client): Promise<Fixture> {
  const ownerId = randomUUID();
  let restaurantId: string | undefined;

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO auth.users
        (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ($1::uuid, 'authenticated', 'authenticated', $2, '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now())`,
      [ownerId, `local-location-${ownerId}@example.invalid`],
    );
    const restaurant = await client.query<{ id: string }>(
      "INSERT INTO public.restaurants (name) VALUES ($1) RETURNING id",
      [`Disposable owner revocation fixture ${ownerId}`],
    );
    restaurantId = restaurant.rows[0].id;
    await client.query(
      "INSERT INTO private.restaurant_owners (user_id, restaurant_id) VALUES ($1::uuid, $2::bigint)",
      [ownerId, restaurantId],
    );
    await client.query("COMMIT");
    return { ownerId, restaurantId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function cleanupFixture(client: Client, fixture: Fixture): Promise<void> {
  await client.query("DELETE FROM private.restaurant_owners WHERE user_id = $1::uuid AND restaurant_id = $2::bigint", [
    fixture.ownerId,
    fixture.restaurantId,
  ]);
  await client.query("DELETE FROM public.restaurants WHERE id = $1::bigint", [fixture.restaurantId]);
  await client.query("DELETE FROM auth.users WHERE id = $1::uuid", [fixture.ownerId]);
}

async function backendPid(client: Client): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid");
  return result.rows[0].pid;
}

async function configureServiceRoleClaim(client: Client): Promise<void> {
  await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true)");
}

function captureQuery(promise: Promise<QueryResult>): Promise<QueryOutcome> {
  return promise.then(
    (result) => ({ result }),
    (error: unknown) => ({ error: error as Error & { code?: string } }),
  );
}

async function isBlockedBy(probe: Client, waiterPid: number, blockerPid: number): Promise<boolean> {
  const result = await probe.query<{ blocked: boolean }>(
    "SELECT $2::integer = ANY(pg_catalog.pg_blocking_pids($1::integer)) AS blocked",
    [waiterPid, blockerPid],
  );
  return result.rows[0].blocked;
}

async function waitForBlock(
  probe: Client,
  waiterPid: number,
  blockerPid: number,
  operationSettled: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await isBlockedBy(probe, waiterPid, blockerPid)) return true;
    if (operationSettled()) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isBlockedBy(probe, waiterPid, blockerPid);
}

async function revocationSerializesFirst(connectionString: string, probe: Client): Promise<void> {
  const fixture = await createFixture(probe);
  const revoker = new Client({ connectionString, application_name: "local-owner-revocation-first" });
  const writer = new Client({ connectionString, application_name: "local-location-write-after-revocation" });
  let revokerConnected = false;
  let writerConnected = false;
  let revokerInTransaction = false;
  let writerInTransaction = false;
  let writeOutcome: Promise<QueryOutcome> | undefined;
  let writeSettled = false;

  try {
    await revoker.connect();
    revokerConnected = true;
    await writer.connect();
    writerConnected = true;

    await revoker.query("BEGIN");
    revokerInTransaction = true;
    const revokerPid = await backendPid(revoker);
    const removal = await revoker.query(
      "DELETE FROM private.restaurant_owners WHERE user_id = $1::uuid AND restaurant_id = $2::bigint RETURNING 1",
      [fixture.ownerId, fixture.restaurantId],
    );
    assert.equal(removal.rowCount, 1, "the disposable owner assignment is marked for removal");

    await writer.query("BEGIN");
    writerInTransaction = true;
    await configureServiceRoleClaim(writer);
    const writerPid = await backendPid(writer);
    writeOutcome = captureQuery(
      writer.query(LOCATION_WRITE_SQL, [fixture.restaurantId, fixture.ownerId]).finally(() => { writeSettled = true; }),
    );

    const blocked = await waitForBlock(probe, writerPid, revokerPid, () => writeSettled);
    assert.ok(blocked, "the location write waits for the earlier owner removal to commit");
    await revoker.query("COMMIT");
    revokerInTransaction = false;

    const outcome = await writeOutcome;
    assert.ok(outcome.error, "a write serialized after owner revocation is denied");
    assert.equal(outcome.error.code, "42501");
    await writer.query("ROLLBACK");
    writerInTransaction = false;

    const state = await probe.query<{ assignment_exists: boolean; location_is_null: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM private.restaurant_owners WHERE user_id = $1::uuid AND restaurant_id = $2::bigint) AS assignment_exists,
         (SELECT location_consent_at IS NULL FROM public.restaurants WHERE id = $2::bigint) AS location_is_null`,
      [fixture.ownerId, fixture.restaurantId],
    );
    assert.equal(state.rows[0].assignment_exists, false);
    assert.equal(state.rows[0].location_is_null, true);
  } finally {
    if (revokerInTransaction) await revoker.query("ROLLBACK").catch(() => undefined);
    if (writeOutcome) await writeOutcome;
    if (writerInTransaction) await writer.query("ROLLBACK").catch(() => undefined);
    if (writerConnected) await writer.end();
    if (revokerConnected) await revoker.end();
    await cleanupFixture(probe, fixture);
  }
}

async function writeSerializesFirst(connectionString: string, probe: Client): Promise<void> {
  const fixture = await createFixture(probe);
  const writer = new Client({ connectionString, application_name: "local-location-write-first" });
  const revoker = new Client({ connectionString, application_name: "local-owner-revocation-after-write" });
  let writerConnected = false;
  let revokerConnected = false;
  let writerInTransaction = false;
  let revokerInTransaction = false;
  let removalOutcome: Promise<QueryOutcome> | undefined;

  try {
    await writer.connect();
    writerConnected = true;
    await revoker.connect();
    revokerConnected = true;

    await writer.query("BEGIN");
    writerInTransaction = true;
    await configureServiceRoleClaim(writer);
    const writerPid = await backendPid(writer);
    const write = await writer.query(LOCATION_WRITE_SQL, [fixture.restaurantId, fixture.ownerId]);
    assert.equal(write.rows[0].location_saved, true, "the assigned owner write succeeds while holding its transaction");

    await revoker.query("BEGIN");
    revokerInTransaction = true;
    const revokerPid = await backendPid(revoker);
    let removalSettled = false;
    removalOutcome = captureQuery(
      revoker
        .query(
          "DELETE FROM private.restaurant_owners WHERE user_id = $1::uuid AND restaurant_id = $2::bigint RETURNING 1",
          [fixture.ownerId, fixture.restaurantId],
        )
        .finally(() => { removalSettled = true; }),
    );

    const blocked = await waitForBlock(probe, revokerPid, writerPid, () => removalSettled);
    assert.ok(blocked, "owner removal waits for the earlier location write to commit");
    await writer.query("COMMIT");
    writerInTransaction = false;

    const removal = await removalOutcome;
    assert.ok(removal.result, "owner removal continues after the location write commits");
    assert.equal(removal.result.rowCount, 1);
    await revoker.query("COMMIT");
    revokerInTransaction = false;

    const state = await probe.query<{ assignment_exists: boolean; location_is_saved: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM private.restaurant_owners WHERE user_id = $1::uuid AND restaurant_id = $2::bigint) AS assignment_exists,
         (SELECT location_consent_at IS NOT NULL FROM public.restaurants WHERE id = $2::bigint) AS location_is_saved`,
      [fixture.ownerId, fixture.restaurantId],
    );
    assert.equal(state.rows[0].assignment_exists, false);
    assert.equal(state.rows[0].location_is_saved, true);
  } finally {
    if (writerInTransaction) await writer.query("ROLLBACK").catch(() => undefined);
    if (removalOutcome) await removalOutcome;
    if (revokerInTransaction) await revoker.query("ROLLBACK").catch(() => undefined);
    if (revokerConnected) await revoker.end();
    if (writerConnected) await writer.end();
    await cleanupFixture(probe, fixture);
  }
}

test("restaurant location writes serialize with owner revocation in local Supabase", async (context: TestContext) => {
  requireLoopbackDatabaseUrl(LOCAL_DATABASE_URL);
  const probe = new Client({ connectionString: LOCAL_DATABASE_URL, connectionTimeoutMillis: 1_000 });
  try {
    await probe.connect();
  } catch {
    context.skip("Disposable local Supabase is unavailable; no hosted database was contacted");
    await probe.end().catch(() => undefined);
    return;
  }

  try {
    const migration = await probe.query<{ writer_exists: boolean; owner_table_exists: boolean }>(
      `SELECT
         to_regprocedure('public.server_set_restaurant_location(bigint,uuid,text,numeric,numeric,text)') IS NOT NULL AS writer_exists,
         to_regclass('private.restaurant_owners') IS NOT NULL AS owner_table_exists`,
    );
    assert.equal(migration.rows[0].writer_exists, true, "the consented location migration is applied locally");
    assert.equal(migration.rows[0].owner_table_exists, true, "the local owner-assignment fixture is available");

    await context.test("revocation serializes first and denies the pending location write", async () => {
      await revocationSerializesFirst(LOCAL_DATABASE_URL, probe);
    });
    await context.test("location write serializes first and commits before owner removal", async () => {
      await writeSerializesFirst(LOCAL_DATABASE_URL, probe);
    });
  } finally {
    await probe.end();
  }
});
