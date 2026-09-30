export type Coordinates = {
  latitude: number;
  longitude: number;
};

export function hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}

export function haversineMeters(origin: Coordinates, destination: Coordinates): number | null {
  if (!hasValidCoordinates(origin.latitude, origin.longitude)
      || !hasValidCoordinates(destination.latitude, destination.longitude)) return null;

  const radians = (degrees: number) => degrees * (Math.PI / 180);
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(origin.latitude))
      * Math.cos(radians(destination.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  const boundedArc = Math.min(1, Math.max(0, arc));
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(boundedArc), Math.sqrt(1 - boundedArc));
}

export function isWithinRadius(
  origin: Coordinates,
  destination: Coordinates,
  radiusMeters: number,
): boolean {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) return false;
  const distance = haversineMeters(origin, destination);
  return distance !== null && distance <= radiusMeters;
}
