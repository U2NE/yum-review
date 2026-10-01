import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const supabaseUrl = "https://example.supabase.co";
const ip = "198.51.100.24";

// Next resolves this marker at build time. Stub its side-effect-only import for
// the repository's direct Node/tsx test runner.
const require = createRequire(import.meta.url);
const moduleLoader = require("node:module") as { _load: (...args: any[]) => any };
const nativeLoad = moduleLoader._load;
moduleLoader._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return nativeLoad.call(this, request, parent, isMain);
};

function saveEnv() {
  return {
    nodeEnv: process.env.NODE_ENV,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    secret: process.env.SUPABASE_SECRET_KEY,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function restoreEnv(saved: ReturnType<typeof saveEnv>) {
  if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = saved.nodeEnv;
  if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  if (saved.secret === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = saved.secret;
  if (saved.serviceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.serviceRole;
}

async function consume(header: string | null) {
  const { consumeLocationSearchQuota } = await import("@/lib/security/location-rate-limit.server");
  return consumeLocationSearchQuota(header);
}

test("production rejects absent or invalid trusted IP without contacting Supabase", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("quota RPC must not run without a valid x-real-ip");
  };
  try {
    assert.deepEqual(await consume(null), { status: "unavailable" });
    assert.deepEqual(await consume("not-an-ip"), { status: "unavailable" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("valid IP is SHA-256 hashed and only the hash is sent to the service RPC", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-be-used";
  let sentBody = "";
  let sentHeaders: HeadersInit | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `${supabaseUrl}/rest/v1/rpc/consume_location_search_quota`);
    sentBody = String(init?.body);
    sentHeaders = init?.headers;
    return new Response(JSON.stringify([{ allowed: true, remaining: 19, retry_after_seconds: 0 }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    assert.deepEqual(await consume(ip), { status: "allowed", remaining: 19 });
    const expectedHash = createHash("sha256").update(ip).digest("hex");
    assert.deepEqual(JSON.parse(sentBody), { p_ip_hash: expectedHash });
    assert.doesNotMatch(sentBody, new RegExp(ip.replaceAll(".", "\\.")));
    const headers = new Headers(sentHeaders);
    assert.equal(headers.get("apikey"), "test-only-service-key");
    assert.equal(headers.get("apikey")?.includes("must-not-be-used"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("quota returns limited state and clamps retry-after to one minute", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  globalThis.fetch = async () => new Response(JSON.stringify([
    { allowed: false, remaining: null, retry_after_seconds: 94 },
  ]), { status: 200 });
  try {
    assert.deepEqual(await consume(ip), { status: "limited", retryAfterSeconds: 60 });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("missing credentials and RPC failures fail closed as unavailable", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  process.env.NODE_ENV = "production";
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("database error", { status: 500 });
  };
  try {
    assert.deepEqual(await consume(ip), { status: "unavailable" });
    assert.equal(calls, 0);
    process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
    assert.deepEqual(await consume(ip), { status: "unavailable" });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("non-production falls back to localhost for an absent client IP", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  process.env.NODE_ENV = "test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  let body = "";
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify([{ allowed: true, remaining: 18, retry_after_seconds: 0 }]), { status: 200 });
  };
  try {
    assert.deepEqual(await consume(null), { status: "allowed", remaining: 18 });
    assert.deepEqual(JSON.parse(body), { p_ip_hash: createHash("sha256").update("::1").digest("hex") });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});
