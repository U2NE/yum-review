import { LocalOwnerFixtureStore, OwnerMenuFixture } from "../../scripts/qa/owner-menu-fixture";

export function createDisposableOwnerFixture() {
  const store = new LocalOwnerFixtureStore();
  store.seedBaselineRestaurant({ id: "preexisting-local-restaurant", name: "Synthetic baseline", fixtureRunId: null });
  store.seedBaselineMenu({
    id: "preexisting-local-menu",
    restaurantId: "preexisting-local-restaurant",
    name: "Synthetic baseline menu",
    description: "Outside the fixture.",
    priceKrw: 900,
    active: true,
    photoId: null,
    fixtureRunId: null,
  });
  const fixture = OwnerMenuFixture.create(store);
  return { fixture, store };
}
