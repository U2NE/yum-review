import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface FixtureRestaurant {
  id: string;
  name: string;
  fixtureRunId: string | null;
}

export interface FixtureMenu {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  priceKrw: number | null;
  active: boolean;
  photoId: string | null;
  fixtureRunId: string | null;
}

export interface FixturePhoto {
  id: string;
  menuId: string;
  bytes: Buffer;
  fixtureRunId: string | null;
}

export class LocalOwnerFixtureStore {
  readonly restaurants = new Map<string, FixtureRestaurant>();
  readonly menus = new Map<string, FixtureMenu>();
  readonly photos = new Map<string, FixturePhoto>();
  readonly owners = new Map<string, Set<string>>();

  seedBaselineRestaurant(row: FixtureRestaurant): void {
    if (row.fixtureRunId !== null || this.restaurants.has(row.id)) throw new Error("Baseline fixture row is invalid.");
    this.restaurants.set(row.id, structuredClone(row));
  }

  seedBaselineMenu(row: FixtureMenu): void {
    if (row.fixtureRunId !== null || this.menus.has(row.id)) throw new Error("Baseline fixture row is invalid.");
    this.menus.set(row.id, structuredClone(row));
  }
}

export interface NewMenuInput {
  name: string;
  description: string;
  priceKrw: number | null;
}

export class OwnerMenuFixture {
  readonly runId = randomUUID();
  readonly ownerId = `synthetic-owner-${randomUUID()}`;
  readonly otherOwnerId = `synthetic-owner-${randomUUID()}`;
  readonly restaurantId = randomUUID();
  readonly otherRestaurantId = randomUUID();

  private readonly createdRestaurants = new Set<string>();
  private readonly createdMenus = new Set<string>();
  private readonly createdPhotos = new Set<string>();
  private readonly createdOwnerLinks: Array<{ ownerId: string; restaurantId: string }> = [];
  private cleaned = false;

  private constructor(readonly store: LocalOwnerFixtureStore) {
    this.createRestaurant(this.ownerId, this.restaurantId);
    this.createRestaurant(this.otherOwnerId, this.otherRestaurantId);
    this.createMenu(this.otherOwnerId, this.otherRestaurantId, {
      name: "Other synthetic menu",
      description: "Other fixture only.",
      priceKrw: 1200,
    });
  }

  static create(store = new LocalOwnerFixtureStore()): OwnerMenuFixture {
    return new OwnerMenuFixture(store);
  }

  createMenu(actorId: string, restaurantId: string, input: NewMenuInput): FixtureMenu {
    this.assertFixtureOpen();
    this.assertOwner(actorId, restaurantId);
    this.validateMenu(input);
    const id = randomUUID();
    const row: FixtureMenu = {
      id,
      restaurantId,
      name: input.name,
      description: input.description,
      priceKrw: input.priceKrw,
      active: true,
      photoId: null,
      fixtureRunId: this.runId,
    };
    this.store.menus.set(id, row);
    this.createdMenus.add(id);
    return structuredClone(row);
  }

  editMenu(actorId: string, menuId: string, input: NewMenuInput): FixtureMenu {
    const row = this.getOwnedMenu(actorId, menuId);
    this.validateMenu(input);
    const updated = { ...row, name: input.name, description: input.description, priceKrw: input.priceKrw };
    this.store.menus.set(menuId, updated);
    return structuredClone(updated);
  }

  setActive(actorId: string, menuId: string, active: boolean): FixtureMenu {
    if (typeof active !== "boolean") throw new Error("Menu status is invalid.");
    const row = this.getOwnedMenu(actorId, menuId);
    const updated = { ...row, active };
    this.store.menus.set(menuId, updated);
    return structuredClone(updated);
  }

  addPhoto(actorId: string, menuId: string, bytes: Uint8Array): FixturePhoto {
    const menu = this.getOwnedMenu(actorId, menuId);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("Photo payload is invalid.");
    if (menu.photoId) throw new Error("A photo already exists; replace it explicitly.");
    const photo = this.createPhoto(menuId, Buffer.from(bytes));
    this.store.menus.set(menuId, { ...menu, photoId: photo.id });
    return structuredClone(photo);
  }

  replacePhoto(actorId: string, menuId: string, bytes: Uint8Array): FixturePhoto {
    const menu = this.getOwnedMenu(actorId, menuId);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("Photo payload is invalid.");
    if (menu.photoId) this.deleteCreatedPhoto(menu.photoId);
    const photo = this.createPhoto(menuId, Buffer.from(bytes));
    this.store.menus.set(menuId, { ...menu, photoId: photo.id });
    return structuredClone(photo);
  }

  removePhoto(actorId: string, menuId: string): void {
    const menu = this.getOwnedMenu(actorId, menuId);
    if (!menu.photoId) return;
    this.deleteCreatedPhoto(menu.photoId);
    this.store.menus.set(menuId, { ...menu, photoId: null });
  }

  cleanup(): void {
    if (this.cleaned) return;
    for (const photoId of this.createdPhotos) this.deleteCreatedPhoto(photoId);
    for (const menuId of this.createdMenus) {
      const row = this.store.menus.get(menuId);
      if (row?.fixtureRunId === this.runId) this.store.menus.delete(menuId);
    }
    for (const restaurantId of this.createdRestaurants) {
      const row = this.store.restaurants.get(restaurantId);
      if (row?.fixtureRunId === this.runId) this.store.restaurants.delete(restaurantId);
    }
    for (const link of this.createdOwnerLinks) {
      const restaurants = this.store.owners.get(link.ownerId);
      restaurants?.delete(link.restaurantId);
      if (restaurants?.size === 0) this.store.owners.delete(link.ownerId);
    }
    this.cleaned = true;
  }

  aggregateCounts(): { restaurants: number; menus: number; photos: number } {
    return { restaurants: this.store.restaurants.size, menus: this.store.menus.size, photos: this.store.photos.size };
  }

  private createRestaurant(ownerId: string, restaurantId: string): void {
    const row: FixtureRestaurant = { id: restaurantId, name: "Synthetic local restaurant", fixtureRunId: this.runId };
    this.store.restaurants.set(restaurantId, row);
    this.createdRestaurants.add(restaurantId);
    let restaurantIds = this.store.owners.get(ownerId);
    if (!restaurantIds) {
      restaurantIds = new Set();
      this.store.owners.set(ownerId, restaurantIds);
    }
    restaurantIds.add(restaurantId);
    this.createdOwnerLinks.push({ ownerId, restaurantId });
  }

  private createPhoto(menuId: string, bytes: Buffer): FixturePhoto {
    const id = randomUUID();
    const photo: FixturePhoto = { id, menuId, bytes, fixtureRunId: this.runId };
    this.store.photos.set(id, photo);
    this.createdPhotos.add(id);
    return photo;
  }

  private getOwnedMenu(actorId: string, menuId: string): FixtureMenu {
    this.assertFixtureOpen();
    const row = this.store.menus.get(menuId);
    if (!row || row.fixtureRunId !== this.runId || !this.store.owners.get(actorId)?.has(row.restaurantId)) {
      throw new Error("Owner access denied.");
    }
    return structuredClone(row);
  }

  private assertOwner(actorId: string, restaurantId: string): void {
    if (!this.store.owners.get(actorId)?.has(restaurantId)) throw new Error("Owner access denied.");
  }

  private validateMenu(input: NewMenuInput): void {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) ||
        JSON.stringify(Reflect.ownKeys(input).sort()) !== JSON.stringify(["description", "name", "priceKrw"])) {
      throw new Error("Menu input contains unsupported fields.");
    }
    if (!input || typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 160) throw new Error("Menu name is invalid.");
    if (typeof input.description !== "string" || input.description.length > 1000) throw new Error("Menu description is invalid.");
    if (input.priceKrw !== null && (!Number.isSafeInteger(input.priceKrw) || input.priceKrw < 0)) throw new Error("Menu price is invalid.");
  }

  private deleteCreatedPhoto(photoId: string): void {
    if (!this.createdPhotos.has(photoId)) return;
    const photo = this.store.photos.get(photoId);
    if (photo?.fixtureRunId === this.runId) this.store.photos.delete(photoId);
    this.createdPhotos.delete(photoId);
  }

  private assertFixtureOpen(): void {
    if (this.cleaned) throw new Error("Disposable fixture has been cleaned up.");
  }
}

export function runOwnerMenuFixtureSelfTest(): void {
  const fixture = OwnerMenuFixture.create();
  const menu = fixture.createMenu(fixture.ownerId, fixture.restaurantId, { name: "Synthetic menu", description: "Local fixture only.", priceKrw: 1500 });
  const edited = fixture.editMenu(fixture.ownerId, menu.id, { name: "Edited synthetic menu", description: "Updated locally.", priceKrw: 1750 });
  if (edited.priceKrw !== 1750) throw new Error("Owner fixture CRUD self-test failed.");
  if (fixture.setActive(fixture.ownerId, menu.id, false).active !== false) throw new Error("Owner fixture status self-test failed.");
  if (fixture.setActive(fixture.ownerId, menu.id, true).active !== true) throw new Error("Owner fixture status self-test failed.");
  const firstPhoto = fixture.addPhoto(fixture.ownerId, menu.id, Buffer.from("synthetic photo v1"));
  const secondPhoto = fixture.replacePhoto(fixture.ownerId, menu.id, Buffer.from("synthetic photo v2"));
  if (fixture.store.photos.has(firstPhoto.id) || !fixture.store.photos.has(secondPhoto.id)) throw new Error("Owner fixture photo replacement self-test failed.");
  fixture.removePhoto(fixture.ownerId, menu.id);
  if (fixture.store.photos.has(secondPhoto.id)) throw new Error("Owner fixture photo removal self-test failed.");
  let denied = false;
  try { fixture.createMenu(fixture.otherOwnerId, fixture.restaurantId, { name: "Denied", description: "", priceKrw: 1 }); } catch { denied = true; }
  if (!denied) throw new Error("Owner fixture cross-owner self-test failed.");
  fixture.cleanup();
  if (fixture.aggregateCounts().restaurants !== 0 || fixture.aggregateCounts().menus !== 0 || fixture.aggregateCounts().photos !== 0) {
    throw new Error("Owner fixture cleanup self-test failed.");
  }
  process.stdout.write("owner-menu disposable fixture self-test PASS\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv.includes("--self-test")) {
  try {
    runOwnerMenuFixtureSelfTest();
  } catch {
    process.stderr.write("owner-menu disposable fixture self-test failed.\n");
    process.exitCode = 1;
  }
}
