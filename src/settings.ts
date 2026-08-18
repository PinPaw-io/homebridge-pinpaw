/** Must match the "platform" value users put in Homebridge's config.json. */
export const PLATFORM_NAME = 'PinPaw';

/** Must match the package name on npm. */
export const PLUGIN_NAME = 'homebridge-pinpaw';

export const DEFAULT_BASE_URL = 'https://api.pinpaw.io';

/** A PinPaw personal access token always carries this prefix. */
export const TOKEN_PREFIX = 'ppw_pat_';

export const DEFAULT_POLL_INTERVAL = 60;

/**
 * Polling floor. The tracker reports on its own schedule, so asking the API
 * more often than this returns the same position with extra load.
 */
export const MIN_POLL_INTERVAL = 15;

/** Battery percentage below which HomeKit is told the battery is low. */
export const LOW_BATTERY_THRESHOLD = 20;

/** Default radius of the home zone, in metres, when the user gives none. */
export const DEFAULT_HOME_RADIUS = 100;
