import assert from "node:assert/strict";
import test from "node:test";
import {
  forwardGeocodeAddress,
  parseVWorldPoint,
  reverseGeocodeCoordinates,
} from "@/lib/data/vworld-geocoder.server";

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
  const originalFetch = globalThis.fetch;
  process.env.VWORLD_API_KEY = "local-test-key";
  const seen: Array<{ url: URL; cache: RequestCache | undefined }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    seen.push({ url, cache: init?.cache });
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
    assert.equal(seen[0]?.url.searchParams.get("key"), "local-test-key");
    assert.equal(seen[1]?.url.searchParams.get("point"), "126.978,37.5665");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
  }
});

test("provider failures return generic forward and reverse errors without leaking coordinates or keys", async () => {
  const originalKey = process.env.VWORLD_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.VWORLD_API_KEY = "local-test-key";
  globalThis.fetch = async () => new Response("upstream details", { status: 503 });
  try {
    const forward = await forwardGeocodeAddress("서울 중구 세종대로 110");
    const reverse = await reverseGeocodeCoordinates(37.5665, 126.978);
    assert.equal(forward.success, false);
    assert.equal(reverse.success, false);
    assert.doesNotMatch(JSON.stringify(forward), /local-test-key|37\.5665|126\.978|upstream details/);
    assert.doesNotMatch(JSON.stringify(reverse), /local-test-key|37\.5665|126\.978|upstream details/);
  } finally {
    globalThis.fetch = originalFetch;
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
