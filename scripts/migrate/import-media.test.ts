import assert from "node:assert/strict";
import test from "node:test";
import { menuFromFilename } from "./import-media";

test("preserves thousands-separated prices and the full menu name", () => {
  assert.deepEqual(menuFromFilename("곰포차 메뉴/파인애플샤베트, 6,900원.jpg"), { menuName: "파인애플샤베트", priceKrw: 6900 });
  assert.deepEqual(menuFromFilename("육회, 12,900원.png"), { menuName: "육회", priceKrw: 12900 });
});

test("allows a comma in the menu name while taking the complete numeric suffix", () => {
  assert.deepEqual(menuFromFilename("매콤, 달콤 치킨, 19,900원.webp"), { menuName: "매콤, 달콤 치킨", priceKrw: 19900 });
});

test("also accepts ungrouped prices and zero", () => {
  assert.deepEqual(menuFromFilename("공깃밥, 1000원.jpeg"), { menuName: "공깃밥", priceKrw: 1000 });
  assert.deepEqual(menuFromFilename("물, 0원.jpg"), { menuName: "물", priceKrw: 0 });
});

test("does not turn malformed price grouping or missing units into valid menu data", () => {
  for (const filename of ["메뉴, 6,90원.jpg", "메뉴, 01,900원.jpg", "메뉴, 6900.jpg", "메뉴, -1000원.jpg"]) {
    assert.deepEqual(menuFromFilename(filename), { menuName: null, priceKrw: null });
  }
});
