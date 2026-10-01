import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const moduleLoader = require("node:module") as { _load: (...args: any[]) => any };
const nativeLoad = moduleLoader._load;
moduleLoader._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return nativeLoad.call(this, request, parent, isMain);
};
const { forwardGeocodeAddress, parseVWorldPoint, reverseGeocodeCoordinates } = require("../../lib/data/vworld-geocoder.server.ts");

test("VWorld point parser reads longitude as x and latitude as y", () => {
  assert.deepEqual(parseVWorldPoint({
    response: {
      status: "OK",
      result: { point: { x: "127.0276", y: "37.4979" } },
    },
  }), { latitude: 37.4979, longitude: 127.0276 });
});

test("VWorld point parser supports result arrays and rejects invalid coordinates", () => {
  assert.deepEqual(parseVWorldPoint({
    response: { status: "OK", result: [{ point: { x: 180, y: -90 } }] },
  }), { latitude: -90, longitude: 180 });
  assert.equal(parseVWorldPoint({
    response: { status: "OK", result: { point: { x: "180.01", y: 0 } } },
  }), null);
  assert.equal(parseVWorldPoint({
    response: { status: "ERROR", result: { point: { x: 127, y: 37 } } },
  }), null);
});

test("forward and reverse conversion send server-only no-store requests and parse mock results", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalFetch = globalThis.fetch;
  process.env.VWORLD_API_KEY = "local-test-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://yum-review.vercel.app";
  const seen: Array<{ url: URL; cache: RequestCache | undefined; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    seen.push({ url, cache: init?.cache, headers: new Headers(init?.headers) });
    const body = url.searchParams.get("request") === "getCoord"
      ? { response: { status: "OK", result: { text: "서울 중구 세종대로 110", point: { x: "126.978", y: "37.5665" } } } }
      : { response: { status: "OK", result: [{ type: "road", text: "서울 중구 세종대로 110" }] } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const forward = await forwardGeocodeAddress("서울 중구 세종대로 110");
    const reverse = await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(forward.success, true);
    assert.deepEqual([forward.results[0]?.latitude, forward.results[0]?.longitude], [37.5665, 126.978]);
    assert.equal(reverse.success, true);
    assert.equal(reverse.address, "서울 중구 세종대로 110");
    assert.equal(seen.length, 2);
    assert.ok(seen.every((request) => request.cache === "no-store"));
    assert.ok(seen.every((request) => request.url.hostname === "api.vworld.kr"));
    assert.ok(seen.every((request) => request.headers.get("referer") === "https://yum-review.vercel.app/"));
    assert.equal(seen[0]?.url.searchParams.get("key"), "local-test-key");
    assert.equal(seen[1]?.url.searchParams.get("point"), "126.978,37.5665");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

test("VWorld Referer rejects non-canonical site URLs", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalFetch = globalThis.fetch;
  process.env.VWORLD_API_KEY = "local-test-key";
  const seen: Headers[] = [];
  globalThis.fetch = async (_input, init) => {
    seen.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ response: { status: "OK", result: [] } }), { status: 200 });
  };
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://yum-review.vercel.app/path";
    await forwardGeocodeAddress("서울 중구 세종대로 110");
    process.env.NEXT_PUBLIC_SITE_URL = "http://yum-review.vercel.app";
    await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((headers) => headers.get("referer") === null));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

test("provider failures return generic forward and reverse errors without leaking coordinates or keys", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const diagnostics: unknown[][] = [];
  process.env.VWORLD_API_KEY = "local-test-key";
  console.warn = (...values: unknown[]) => { diagnostics.push(values); };
  globalThis.fetch = async () => new Response("upstream details", { status: 503 });
  try {
    const forward = await forwardGeocodeAddress("서울 중구 세종대로 110");
    const reverse = await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(forward.success, false);
    assert.equal(reverse.success, false);
    assert.doesNotMatch(JSON.stringify(forward), /local-test-key|37\.5665|126\.978|upstream details/);
    assert.doesNotMatch(JSON.stringify(reverse), /local-test-key|37\.5665|126\.978|upstream details/);
    assert.equal(diagnostics.length, 2);
    assert.ok(diagnostics.every(([label, detail]) => label === "VWorld geocoder request failed"
      && JSON.stringify(detail) === JSON.stringify({ category: "http", status: 503 })));
    assert.doesNotMatch(JSON.stringify(diagnostics), /local-test-key|37\.5665|126\.978|upstream details|api\.vworld\.kr/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
  }
});

test("JSON parse and body-read failures use sanitized diagnostics", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const diagnostics: unknown[][] = [];
  const sentinel = "secret-key address coordinate https://api.vworld.kr/full?key=secret";
  process.env.VWORLD_API_KEY = "local-test-key";
  console.warn = (...values: unknown[]) => { diagnostics.push(values); };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => {
        if (calls === 1) throw new SyntaxError("invalid upstream JSON");
        throw new Error(sentinel);
      },
    } as Response;
  };
  try {
    const forward = await forwardGeocodeAddress("서울 중구 세종대로 110");
    const reverse = await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(forward.success, false);
    assert.equal(reverse.success, false);
    assert.doesNotMatch(JSON.stringify([forward, reverse]), /local-test-key|37\.5665|126\.978|secret-key|api\.vworld\.kr/);
    assert.deepEqual(diagnostics, [
      ["VWorld geocoder request failed", { category: "invalid_json", status: 200 }],
      ["VWorld geocoder request failed", { category: "transport", status: 200 }],
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret-key|coordinate|api\.vworld\.kr|full\?/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
  }
});

test("provider status failures and malformed success payloads produce retry messages", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.VWORLD_API_KEY = "local-test-key";
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.searchParams.get("request") === "getCoord") {
      return new Response(JSON.stringify({ response: { status: "ERROR", result: [] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ response: { status: "OK", result: "invalid-shape" } }), { status: 200 });
  };
  try {
    const forward = await forwardGeocodeAddress("서울 중구 세종대로 110");
    const reverse = await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(forward.success, false);
    assert.equal(reverse.success, false);
    assert.match(forward.message ?? "", /다시 시도해 주세요/);
    assert.match(reverse.message ?? "", /다시 시도해 주세요/);
    assert.notEqual(forward.message, "해당 주소의 위치를 찾지 못했어요.");
    assert.notEqual(reverse.message, "현재 위치의 주소를 찾지 못했어요.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
  }
});

test("valid OK empty results remain distinct from upstream failures", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.VWORLD_API_KEY = "local-test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ response: { status: "OK", result: [] } }), { status: 200 });
  try {
    const forward = await forwardGeocodeAddress("서울 중구 세종대로 110");
    const reverse = await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(forward.success, false);
    assert.equal(reverse.success, false);
    assert.equal(forward.message, "해당 주소의 위치를 찾지 못했어요.");
    assert.equal(reverse.message, "현재 위치의 주소를 찾지 못했어요.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
  }
});
