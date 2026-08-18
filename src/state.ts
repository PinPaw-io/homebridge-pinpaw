import { distanceMetres } from './geo.js';
import { LOW_BATTERY_THRESHOLD } from './settings.js';
import type { HomeLocation, Pet, PetState } from './types.js';

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

/**
 * Flatten one pet from the API into the shape the accessory consumes.
 *
 * Pure on purpose: all the interesting decisions live here, so they can be
 * tested without a HomeKit bridge in the loop.
 */
export function buildPetState(pet: Pet, home: HomeLocation | null): PetState {
  const position = pet.latestPosition ?? {};

  const latitude = asNumber(position.latitude);
  const longitude = asNumber(position.longitude);
  const batteryLevel = asNumber(position.batteryLevel);

  // deviceStatus is authoritative when the backend sends it; the flag inside
  // latestPosition is the fallback. Matches the Home Assistant integration.
  let online: boolean | null;
  if (typeof pet.deviceStatus === 'string') {
    online = pet.deviceStatus === 'online';
  } else {
    online = asBoolean(position.online);
  }

  let atHome: boolean | null = null;
  let distance: number | null = null;
  if (home && latitude !== null && longitude !== null) {
    distance = distanceMetres(home.latitude, home.longitude, latitude, longitude);
    atHome = distance <= home.radius;
  }

  return {
    id: pet.id,
    name: pet.name?.trim() || `Pet ${pet.id}`,
    online,
    batteryLevel,
    charging: asBoolean(position.charging),
    lowBattery: batteryLevel === null ? null : batteryLevel < LOW_BATTERY_THRESHOLD,
    motion: asBoolean(position.motion),
    atHome,
    distance,
    latitude,
    longitude,
    address: typeof position.address === 'string' && position.address !== ''
      ? position.address
      : null,
  };
}
