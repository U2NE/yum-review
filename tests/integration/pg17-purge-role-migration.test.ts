import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test, { before } from "node:test";

let migration = "";

type Membership = {
  grantedRole: string;
  memberRole: string;
  admin: boolean;
  inherit: boolean;
  set: boolean;
  grantor?: string;
};

const expectedMemberships: Membership[] = [
  { grantedRole: "purge_guard_owner", memberRole: "postgres", admin: true, inherit: false, set: false },
  { grantedRole: "purge_guard_owner", memberRole: "postgres", admin: false, inherit: false, set: true },
  { grantedRole: "purge_identity", memberRole: "postgres", admin: true, inherit: false, set: false },
];

function exactMembershipSet(rows: Membership[]) {
  const tuple = (row: Membership) => [row.grantedRole, row.memberRole, row.admin, row.inherit, row.set];
  return rows.length === expectedMemberships.length
    && expectedMemberships.every(expected => rows.filter(row =>
      JSON.stringify(tuple(row)) === JSON.stringify(tuple(expected))).length === 1)
    && rows.every(row => expectedMemberships.some(expected =>
      JSON.stringify(tuple(row)) === JSON.stringify(tuple(expected))));
}

before(async () => {
  const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260928115000_personal_data_write_freeze.sql",
  );
  migration = await readFile(migrationPath, "utf8");
});

function section(start: string, end: string) {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return migration.slice(from, to);
}

test("PG17 role bootstrap enables self-grant only while creating purge_guard_owner", () => {
  const roles = section("DO $roles$", "$roles$;");
  const ownerCreate = roles.indexOf("CREATE ROLE purge_guard_owner");
  const identityCreate = roles.indexOf("CREATE ROLE purge_identity");
  const enable = roles.indexOf("createrole_self_grant = 'set'");
  const reset = roles.indexOf("createrole_self_grant = ''");

  assert.ok(enable >= 0 && enable < ownerCreate);
  assert.ok(ownerCreate < reset && reset < identityCreate);
  assert.equal((roles.match(/createrole_self_grant/g) ?? []).length, 2);
  assert.doesNotMatch(roles, /createrole_self_grant\s*=\s*'(?:none|off)'/);
  assert.match(roles, /rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls OR rolcanlogin/);
  assert.match(roles, /rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls OR NOT rolcanlogin/);
  assert.match(roles, /pg_has_role\('postgres', 'purge_guard_owner', 'SET'\)/);
});

test("PG17 membership guard accepts only the three exact postgres edges and options", () => {
  const roles = section("DO $roles$", "$roles$;");
  assert.match(roles, /count\(\*\)[\s\S]*?<> 3/);
  assert.equal((roles.match(/\) <> 1/g) ?? []).length, 3, "each allowed tuple must occur exactly once");
  assert.match(roles, /granted_role = 'purge_guard_owner' AND actual\.member_role = 'postgres'[\s\S]*?actual\.admin_option AND NOT actual\.inherit_option AND NOT actual\.set_option/);
  assert.match(roles, /granted_role = 'purge_guard_owner' AND actual\.member_role = 'postgres'[\s\S]*?NOT actual\.admin_option AND NOT actual\.inherit_option AND actual\.set_option/);
  assert.match(roles, /granted_role = 'purge_identity' AND actual\.member_role = 'postgres'[\s\S]*?actual\.admin_option AND NOT actual\.inherit_option AND NOT actual\.set_option/);
  assert.equal((roles.match(/granted_role = '/g) ?? []).length, 3);
  assert.match(roles, /WHERE NOT \([\s\S]*?\)\s*\) THEN/);
  assert.match(roles, /unexpected PostgreSQL membership edges or options/);
});

test("membership tuple contract rejects a duplicate edge replacing a missing edge", () => {
  assert.equal(exactMembershipSet(expectedMemberships), true);
  const duplicateForDifferentGrantor = { ...expectedMemberships[0], grantor: "other_operator" };
  const duplicateAndMissing = [expectedMemberships[0], duplicateForDifferentGrantor, expectedMemberships[1]];
  assert.equal(exactMembershipSet(duplicateAndMissing), false);
});

test("temporary schema CREATE brackets all owner transfers and is revoked with a residual check", () => {
  const firstTransfer = migration.indexOf("ALTER FUNCTION private.personal_data_write_is_frozen() OWNER TO purge_guard_owner;");
  const lastTransfer = migration.indexOf("ALTER FUNCTION private.purge_guard_row_is_allowlisted(text, text, text[]) OWNER TO purge_guard_owner;");
  const grant = migration.indexOf("GRANT CREATE ON SCHEMA private, public TO purge_guard_owner;");
  const revoke = migration.indexOf("REVOKE CREATE ON SCHEMA private, public FROM purge_guard_owner;");
  const check = migration.indexOf("has_schema_privilege('purge_guard_owner', 'private', 'CREATE')");

  assert.ok(grant >= 0 && grant < firstTransfer);
  assert.ok(firstTransfer < lastTransfer && lastTransfer < revoke && revoke < check);
  assert.match(migration.slice(grant, revoke), /ALTER FUNCTION [^;]+ OWNER TO purge_guard_owner;/);
  assert.match(migration.slice(revoke, revoke + 600), /has_schema_privilege\('purge_guard_owner', 'public', 'CREATE'\)/);
});
