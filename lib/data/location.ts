export const DISTANCE_OPTIONS = ["all", "300", "500", "1000"] as const;
export type DistanceOption = (typeof DISTANCE_OPTIONS)[number];
export const RESTAURANT_LOCATION_CONSENT_VERSION = "restaurant-location-v1" as const;

// Kept empty until the personal-list pages migrate their legacy prop in the next approved task.
export const DANKOOK_JUKJEON: { label: string; latitude: number; longitude: number } | undefined = undefined;

export type PlaceSuggestion = {
  name: string;
  category: string;
  address: string;
  roadAddress: string;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
};

export type PlaceSearchResult = {
  configured: boolean;
  success: boolean;
  message: string | null;
  results: PlaceSuggestion[];
};
