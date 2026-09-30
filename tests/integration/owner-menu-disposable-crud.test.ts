import assert from "node:assert/strict";
import test from "node:test";
import { createDisposableOwnerFixture } from "../fixtures/owner-menu-disposable";

test("disposable owner fixture covers menu CRUD, activation, and photo add/replace/remove", () => {
  const { fixture, store } = createDisposableOwnerFixture();
  try {
    const menu = fixture.createMenu(fixture.ownerId, fixture.restaurantId, { name: "Synthetic menu", description: "Created locally.", priceKrw: 1200 });
    const edited = fixture.editMenu(fixture.ownerId, menu.id, { name: "Updated synthetic menu", description: "Edited locally.", priceKrw: 1500 });
    assert.equal(edited.name, "Updated synthetic menu");
    assert.equal(fixture.setActive(fixture.ownerId, menu.id, false).active, false);
    assert.equal(fixture.setActive(fixture.ownerId, menu.id, true).active, true);

    const firstPhoto = fixture.addPhoto(fixture.ownerId, menu.id, Buffer.from("synthetic-photo-one"));
    assert.deepEqual(store.photos.get(firstPhoto.id)?.bytes, Buffer.from("synthetic-photo-one"));
    const replacement = fixture.replacePhoto(fixture.ownerId, menu.id, Buffer.from("synthetic-photo-two"));
    assert.equal(store.photos.has(firstPhoto.id), false);
    assert.deepEqual(store.photos.get(replacement.id)?.bytes, Buffer.from("synthetic-photo-two"));
    fixture.removePhoto(fixture.ownerId, menu.id);
    assert.equal(store.photos.has(replacement.id), false);
  } finally {
    fixture.cleanup();
  }
});

test("cross-owner menu and photo operations are denied", () => {
  const { fixture } = createDisposableOwnerFixture();
  try {
    const menu = fixture.createMenu(fixture.ownerId, fixture.restaurantId, { name: "Synthetic menu", description: "Fixture only.", priceKrw: 1000 });
    assert.throws(() => fixture.editMenu(fixture.otherOwnerId, menu.id, { name: "Attempt", description: "", priceKrw: 1 }), /Owner access denied/);
    assert.throws(() => fixture.setActive(fixture.otherOwnerId, menu.id, false), /Owner access denied/);
    assert.throws(() => fixture.addPhoto(fixture.otherOwnerId, menu.id, Buffer.from("x")), /Owner access denied/);
  } finally {
    fixture.cleanup();
  }
});

test("cleanup removes only rows created by this fixture", () => {
  const { fixture, store } = createDisposableOwnerFixture();
  const baselineRestaurant = structuredClone(store.restaurants.get("preexisting-local-restaurant"));
  const baselineMenu = structuredClone(store.menus.get("preexisting-local-menu"));
  fixture.createMenu(fixture.ownerId, fixture.restaurantId, { name: "Synthetic menu", description: "Fixture only.", priceKrw: null });
  fixture.cleanup();
  fixture.cleanup();
  assert.deepEqual(store.restaurants.get("preexisting-local-restaurant"), baselineRestaurant);
  assert.deepEqual(store.menus.get("preexisting-local-menu"), baselineMenu);
  assert.equal(store.restaurants.size, 1);
  assert.equal(store.menus.size, 1);
  assert.equal(store.photos.size, 0);
});

test("menu inputs cannot override owner scope or fixture cleanup markers", () => {
  const { fixture, store } = createDisposableOwnerFixture();
  const baselineRestaurant = structuredClone(store.restaurants.get("preexisting-local-restaurant"));
  const baselineMenu = structuredClone(store.menus.get("preexisting-local-menu"));
  const menu = fixture.createMenu(fixture.ownerId, fixture.restaurantId, { name: "Synthetic menu", description: "Fixture only.", priceKrw: 1000 });
  const createdCount = store.menus.size;

  assert.throws(() => fixture.createMenu(fixture.ownerId, fixture.restaurantId, {
    name: "Forged create", description: "Must be rejected.", priceKrw: 1000,
    restaurantId: fixture.otherRestaurantId,
    fixtureRunId: null,
  } as never), /unsupported fields/);
  assert.throws(() => fixture.editMenu(fixture.ownerId, menu.id, {
    name: "Forged edit", description: "Must be rejected.", priceKrw: 1200,
    restaurantId: fixture.otherRestaurantId,
    fixtureRunId: "another-run",
  } as never), /unsupported fields/);
  assert.deepEqual(store.menus.get(menu.id), menu);
  assert.equal(store.menus.size, createdCount);

  fixture.cleanup();
  assert.deepEqual(store.restaurants.get("preexisting-local-restaurant"), baselineRestaurant);
  assert.deepEqual(store.menus.get("preexisting-local-menu"), baselineMenu);
  assert.equal(store.restaurants.size, 1);
  assert.equal(store.menus.size, 1);
  assert.equal(store.photos.size, 0);
});
