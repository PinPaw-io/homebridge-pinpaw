import { looksLikeToken } from './api.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_HOME_RADIUS,
  DEFAULT_POLL_INTERVAL,
  MIN_POLL_INTERVAL,
} from './settings.js';
import type { HomeLocation } from './types.js';

export interface PinPawConfig {
  apiToken: string;
  baseUrl: string;
  pollInterval: number;
  home: HomeLocation | null;
  exposeMotion: boolean;
}

export interface ParsedConfig {
  /** null when the config is unusable; `errors` then says why. */
  config: PinPawConfig | null;
  errors: string[];
  warnings: string[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Validate and normalise what the user wrote in config.json.
 *
 * Kept pure and free of Homebridge imports so the rules can be tested
 * directly. Errors are fatal; warnings mean the plugin runs with reduced
 * functionality, which is better than refusing to start over an optional field.
 */
export function parseConfig(raw: unknown): ParsedConfig {
  const source = asRecord(raw);
  const errors: string[] = [];
  const warnings: string[] = [];

  const apiToken = typeof source.apiToken === 'string' ? source.apiToken.trim() : '';
  if (apiToken === '') {
    errors.push('apiToken is missing. Create one in the PinPaw app under Settings > API tokens.');
  } else if (!looksLikeToken(apiToken)) {
    errors.push('apiToken does not look like a PinPaw token (it should start with "ppw_pat_").');
  }

  const baseUrl =
    typeof source.baseUrl === 'string' && source.baseUrl.trim() !== ''
      ? source.baseUrl.trim()
      : DEFAULT_BASE_URL;

  let pollInterval = asFiniteNumber(source.pollInterval) ?? DEFAULT_POLL_INTERVAL;
  if (pollInterval < MIN_POLL_INTERVAL) {
    warnings.push(
      `pollInterval ${pollInterval}s is below the ${MIN_POLL_INTERVAL}s floor; using ${MIN_POLL_INTERVAL}s.`,
    );
    pollInterval = MIN_POLL_INTERVAL;
  }
  pollInterval = Math.floor(pollInterval);

  const home = parseHome(source.home, warnings);
  if (!home) {
    warnings.push(
      'No home location configured, so the "At home" sensor stays unavailable. ' +
        'Set home.latitude and home.longitude to enable it.',
    );
  }

  const exposeMotion = source.exposeMotion !== false;

  return {
    config: errors.length > 0 ? null : { apiToken, baseUrl, pollInterval, home, exposeMotion },
    errors,
    warnings,
  };
}

function parseHome(raw: unknown, warnings: string[]): HomeLocation | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const source = asRecord(raw);
  const latitude = asFiniteNumber(source.latitude);
  const longitude = asFiniteNumber(source.longitude);

  if (latitude === null || longitude === null) {
    warnings.push('home needs numeric latitude and longitude; ignoring it.');
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    warnings.push('home coordinates are out of range; ignoring it.');
    return null;
  }

  const radius = asFiniteNumber(source.radius);
  if (radius !== null && radius <= 0) {
    warnings.push(`home.radius ${radius} is not positive; using ${DEFAULT_HOME_RADIUS}m.`);
  }

  return {
    latitude,
    longitude,
    radius: radius !== null && radius > 0 ? radius : DEFAULT_HOME_RADIUS,
  };
}
