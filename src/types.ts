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

/** The reporting schedule a tracker is on. */
export type TrackingMode = 'TRACKING' | 'SAVING' | 'DAILY';

/** Whether walks are detected automatically or started by hand. */
export type WalkRecordingMode = 'AUTO' | 'MANUAL';

export interface Pet {
  id: number;
  name?: string | null;
  deviceStatus?: string | null;
  trackingInterval?: number | null;
  deviceLastUpdate?: string | number | null;
  latestPosition?: LatestPosition | null;
  trackingMode?: string | null;
  carMode?: boolean | null;
  walkRecordingMode?: string | null;
  walkActive?: boolean | null;
  lost?: boolean | null;
  deviceDisabled?: boolean | null;
  /** Command types the device's protocol has a template for. */
  availableCommands?: string[] | null;
}

/**
 * One row of GET /api/device-states/my-pets -- the tracker's last heartbeat.
 * It is the only place the light and sound state lives; /api/pets omits it.
 */
export interface DeviceState {
  petId?: number | null;
  lightSwitch?: boolean | null;
  soundSwitch?: boolean | null;
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
  trackingMode: TrackingMode | null;
  carMode: boolean | null;
  walkRecordingMode: WalkRecordingMode | null;
  walkActive: boolean | null;
  lost: boolean | null;
  deviceDisabled: boolean | null;
  led: boolean | null;
  sound: boolean | null;
  /** Which controls the tracker's protocol supports; drives which services exist. */
  availableCommands: string[];
}
