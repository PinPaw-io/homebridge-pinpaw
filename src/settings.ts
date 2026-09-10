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

/**
 * Command types this plugin sends. The backend also exposes a `/sync` variant
 * that blocks for up to 30s waiting for the tracker to acknowledge; we use the
 * fire-and-forget endpoint instead and let the next poll carry the result.
 */
export const CMD_LIVE_TRACKING = 'LIVE_TRACKING';
export const CMD_DEFAULT_TRACKING = 'DEFAULT_TRACKING';
export const CMD_SAVING_TRACKING = 'SAVING_TRACKING';
export const CMD_LED_ON = 'LED_SWITCH_ON';
export const CMD_LED_OFF = 'LED_SWITCH_OFF';
export const CMD_SOUND_ON = 'SOUND_SWITCH_ON';
export const CMD_SOUND_OFF = 'SOUND_SWITCH_OFF';

/**
 * How long the momentary sleeping-mode switch stays lit before it snaps back.
 * Long enough that the tap registers visually, short enough not to read as a
 * state the tracker is in.
 */
export const MOMENTARY_RESET_MS = 1000;
