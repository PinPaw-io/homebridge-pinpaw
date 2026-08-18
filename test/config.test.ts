import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseConfig } from '../src/config.js';

const VALID_TOKEN = 'ppw_pat_abc123';

describe('parseConfig', () => {
  it('accepts a minimal valid config', () => {
    const { config, errors } = parseConfig({ apiToken: VALID_TOKEN });
    assert.deepEqual(errors, []);
    assert.ok(config);
    assert.equal(config.apiToken, VALID_TOKEN);
    assert.equal(config.baseUrl, 'https://api.pinpaw.io');
    assert.equal(config.pollInterval, 60);
    assert.equal(config.exposeMotion, true);
  });

  it('rejects a missing token', () => {
    const { config, errors } = parseConfig({});
    assert.equal(config, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /apiToken is missing/);
  });

  it('rejects a token with the wrong prefix', () => {
    const { config, errors } = parseConfig({ apiToken: 'not-a-pinpaw-token' });
    assert.equal(config, null);
    assert.match(errors[0]!, /ppw_pat_/);
  });

  it('trims the token', () => {
    const { config } = parseConfig({ apiToken: `  ${VALID_TOKEN}  ` });
    assert.equal(config?.apiToken, VALID_TOKEN);
  });

  it('clamps a too-short poll interval and says so', () => {
    const { config, warnings } = parseConfig({ apiToken: VALID_TOKEN, pollInterval: 2 });
    assert.equal(config?.pollInterval, 15);
    assert.ok(warnings.some((w) => w.includes('floor')));
  });

  it('floors a fractional poll interval', () => {
    const { config } = parseConfig({ apiToken: VALID_TOKEN, pollInterval: 42.7 });
    assert.equal(config?.pollInterval, 42);
  });

  it('ignores a non-numeric poll interval', () => {
    const { config } = parseConfig({ apiToken: VALID_TOKEN, pollInterval: 'often' });
    assert.equal(config?.pollInterval, 60);
  });

  it('accepts a home location', () => {
    const { config } = parseConfig({
      apiToken: VALID_TOKEN,
      home: { latitude: 52.2297, longitude: 21.0122, radius: 250 },
    });
    assert.deepEqual(config?.home, { latitude: 52.2297, longitude: 21.0122, radius: 250 });
  });

  it('defaults the home radius', () => {
    const { config } = parseConfig({
      apiToken: VALID_TOKEN,
      home: { latitude: 52.2297, longitude: 21.0122 },
    });
    assert.equal(config?.home?.radius, 100);
  });

  it('warns and skips home when coordinates are incomplete', () => {
    const { config, warnings } = parseConfig({
      apiToken: VALID_TOKEN,
      home: { latitude: 52.2297 },
    });
    assert.equal(config?.home, null);
    assert.ok(warnings.some((w) => w.includes('numeric latitude and longitude')));
  });

  it('rejects out-of-range coordinates', () => {
    const { config, warnings } = parseConfig({
      apiToken: VALID_TOKEN,
      home: { latitude: 191, longitude: 21.0122 },
    });
    assert.equal(config?.home, null);
    assert.ok(warnings.some((w) => w.includes('out of range')));
  });

  it('falls back on a non-positive radius', () => {
    const { config, warnings } = parseConfig({
      apiToken: VALID_TOKEN,
      home: { latitude: 52.2297, longitude: 21.0122, radius: 0 },
    });
    assert.equal(config?.home?.radius, 100);
    assert.ok(warnings.some((w) => w.includes('not positive')));
  });

  it('warns when no home is configured at all', () => {
    const { warnings } = parseConfig({ apiToken: VALID_TOKEN });
    assert.ok(warnings.some((w) => w.includes('No home location')));
  });

  it('honours exposeMotion: false but treats anything else as on', () => {
    assert.equal(parseConfig({ apiToken: VALID_TOKEN, exposeMotion: false }).config?.exposeMotion, false);
    assert.equal(parseConfig({ apiToken: VALID_TOKEN, exposeMotion: true }).config?.exposeMotion, true);
    assert.equal(parseConfig({ apiToken: VALID_TOKEN }).config?.exposeMotion, true);
  });

  it('strips a trailing slash from a custom base URL via the client', () => {
    const { config } = parseConfig({ apiToken: VALID_TOKEN, baseUrl: '  https://example.test/  ' });
    assert.equal(config?.baseUrl, 'https://example.test/');
  });

  it('survives a completely bogus config object', () => {
    const { config, errors } = parseConfig(null);
    assert.equal(config, null);
    assert.ok(errors.length > 0);
  });
});
