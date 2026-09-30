import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectFile = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

test("authenticated Account area links to both personal list routes", async () => {
  const source = await projectFile("app/account/page.tsx");

  assert.match(source, /requireSignedIn\("\/account"\)/);
  assert.match(source, /<Link className=\{styles\.button\} href="\/my-reviews"/);
  assert.match(source, /<Link className=\{styles\.secondaryButton\} href="\/wishlist"/);
});

test("home ignores personal-list URL filters and does not render their controls", async () => {
  const source = await projectFile("app/page.tsx");

  assert.match(source, /mineReviews:\s*false/);
  assert.match(source, /wishlistedOnly:\s*false/);
  assert.match(source, /showPersonalFilters=\{false\}/);
});

test("dedicated personal lists retain signed-in guards and list-specific filters", async () => {
  const [reviews, wishlist] = await Promise.all([
    projectFile("app/my-reviews/page.tsx"),
    projectFile("app/wishlist/page.tsx"),
  ]);

  assert.match(reviews, /requireSignedIn\("\/my-reviews"\)/);
  assert.match(reviews, /mineReviews:\s*true/);
  assert.match(reviews, /\.eq\("user_id",\s*userId\)/);
  assert.match(wishlist, /requireSignedIn\("\/wishlist"\)/);
  assert.match(wishlist, /wishlistedOnly:\s*true/);
});
