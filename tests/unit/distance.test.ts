import assert from "node:assert/strict";
import test from "node:test";
import { hasValidCoordinates, haversineMeters, isWithinRadius } from "@/lib/location/distance";

test("coordinate validation includes legal extrema and rejects invalid pairs", () => {
  assert.equal(hasValidCoordinates(-90, -180), true);
  assert.equal(hasValidCoordinates(90, 180), true);
  assert.equal(hasValidCoordinates(90.001, 0), false);
  assert.equal(hasValidCoordinates(0, -180.001), false);
  assert.equal(hasValidCoordinates(Number.NaN, 0), false);
  assert.equal(hasValidCoordinates(0, Number.POSITIVE_INFINITY), false);
});

test("Haversine distance is zero for the same point and handles the date line", () => {
  assert.equal(haversineMeters({ latitude: 37.5, longitude: 127 }, { latitude: 37.5, longitude: 127 }), 0);
  const acrossDateLine = haversineMeters(
    { latitude: 0, longitude: 179.999 },
    { latitude: 0, longitude: -179.999 },
  );
  assert.ok(acrossDateLine !== null && acrossDateLine > 200 && acrossDateLine < 225);
});

test("radius filter includes its exact boundary and excludes a point beyond it", () => {
  const origin = { latitude: 37.5665, longitude: 126.978 };
  const destination = { latitude: 37.568, longitude: 126.978 };
  const boundary = haversineMeters(origin, destination);
  assert.ok(boundary !== null);
  assert.equal(isWithinRadius(origin, destination, boundary), true);
  assert.equal(isWithinRadius(origin, destination, boundary - 0.01), false);
  assert.equal(isWithinRadius(origin, destination, -1), false);
  assert.equal(isWithinRadius(origin, { latitude: 91, longitude: 0 }, 500), false);
});
