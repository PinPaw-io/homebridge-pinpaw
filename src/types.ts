/** The position payload embedded in each pet by the PinPaw API. */
export interface LatestPosition {
  latitude?: number | null;
  longitude?: number | null;
  batteryLevel?: number | null;
  charging?: boolean | null;
  online?: boolean | null;
  motion?: boolean | null;
  address?: string | null;
  speed?: number | null;
  course?: number | null;
}

export interface Pet {
  id: number;
  name?: string | null;
  deviceStatus?: string | null;
  trackingInterval?: number | null;
  deviceLastUpdate?: string | number | null;
  latestPosition?: LatestPosition | null;
}

/** Where "home" is, for the at-home and distance calculations. */
export interface HomeLocation {
  latitude: number;
  longitude: number;
  radius: number;
}

/**
 * One pet flattened into exactly what the HomeKit services need.
 *
 * Every field is nullable on purpose: null means "the backend did not tell us
 * this time", and the accessory leaves the corresponding characteristic alone
 * rather than pushing a made-up default into HomeKit.
 */
export interface PetState {
  id: number;
  name: string;
  online: boolean | null;
  batteryLevel: number | null;
  charging: boolean | null;
  lowBattery: boolean | null;
  motion: boolean | null;
  atHome: boolean | null;
  distance: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}
