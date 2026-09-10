import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPetState } from '../src/state.js';
import type { HomeLocation, Pet } from '../src/types.js';

const HOME: HomeLocation = { latitude: 52.2297, longitude: 21.0122, radius: 100 };

const pet = (overrides: Partial<Pet> = {}): Pet => ({
  id: 7,
  name: 'Burek',
  deviceStatus: 'online',
  trackingInterval: 60,
  latestPosition: {
    latitude: 52.2297,
    longitude: 21.0122,
    batteryLevel: 88,
    charging: false,
    online: true,
    motion: false,
    address: 'Marszalkowska 1, Warszawa',
  },
  ...overrides,
});

describe('buildPetState', () => {
  it('maps the straightforward fields', () => {
    const state = buildPetState(pet(), HOME);
    assert.equal(state.id, 7);
    assert.equal(state.name, 'Burek');
    assert.equal(state.batteryLevel, 88);
    assert.equal(state.charging, false);
    assert.equal(state.motion, false);
    assert.equal(state.address, 'Marszalkowska 1, Warszawa');
  });

  it('falls back to a generated name', () => {
    assert.equal(buildPetState(pet({ name: null }), HOME).name, 'Pet 7');
    assert.equal(buildPetState(pet({ name: '   ' }), HOME).name, 'Pet 7');
  });

  it('prefers deviceStatus over latestPosition.online', () => {
    const state = buildPetState(
      pet({ deviceStatus: 'offline', latestPosition: { online: true } }),
      HOME,
    );
    assert.equal(state.online, false);
  });

  it('falls back to latestPosition.online when deviceStatus is absent', () => {
    const state = buildPetState(
      pet({ deviceStatus: null, latestPosition: { online: false } }),
      HOME,
    );
    assert.equal(state.online, false);
  });

  it('reports null online when neither source is present', () => {
    const state = buildPetState(pet({ deviceStatus: null, latestPosition: {} }), HOME);
    assert.equal(state.online, null);
  });

  it('flags a low battery below the threshold', () => {
    assert.equal(buildPetState(pet({ latestPosition: { batteryLevel: 19 } }), HOME).lowBattery, true);
    assert.equal(buildPetState(pet({ latestPosition: { batteryLevel: 20 } }), HOME).lowBattery, false);
    assert.equal(buildPetState(pet({ latestPosition: { batteryLevel: 88 } }), HOME).lowBattery, false);
  });

  it('leaves lowBattery null when the level is unknown', () => {
    const state = buildPetState(pet({ latestPosition: {} }), HOME);
    assert.equal(state.batteryLevel, null);
    assert.equal(state.lowBattery, null);
  });

  it('detects the pet at home', () => {
    const state = buildPetState(pet(), HOME);
    assert.equal(state.atHome, true);
    assert.ok(state.distance !== null && state.distance < 1);
  });

  it('detects the pet away, with a distance', () => {
    const state = buildPetState(
      pet({ latestPosition: { latitude: 52.24, longitude: 21.0122 } }),
      HOME,
    );
    assert.equal(state.atHome, false);
    assert.ok(state.distance !== null && Math.abs(state.distance - 1145) < 60, `got ${state.distance}`);
  });

  it('honours the configured radius', () => {
    const wide: HomeLocation = { ...HOME, radius: 2000 };
    const state = buildPetState(
      pet({ latestPosition: { latitude: 52.24, longitude: 21.0122 } }),
      wide,
    );
    assert.equal(state.atHome, true);
  });

  it('leaves at-home unknown without a home location', () => {
    const state = buildPetState(pet(), null);
    assert.equal(state.atHome, null);
    assert.equal(state.distance, null);
  });

  it('leaves at-home unknown without coordinates', () => {
    const state = buildPetState(pet({ latestPosition: { batteryLevel: 50 } }), HOME);
    assert.equal(state.atHome, null);
    assert.equal(state.distance, null);
  });

  it('rejects non-numeric coordinates instead of trusting them', () => {
    const state = buildPetState(
      pet({ latestPosition: { latitude: Number.NaN, longitude: 21.0122 } }),
      HOME,
    );
    assert.equal(state.latitude, null);
    assert.equal(state.atHome, null);
  });

  it('normalises an empty address to null', () => {
    assert.equal(buildPetState(pet({ latestPosition: { address: '' } }), HOME).address, null);
  });

  it('carries the modes through', () => {
    const state = buildPetState(
      pet({
        trackingMode: 'SAVING',
        carMode: true,
        walkRecordingMode: 'MANUAL',
        walkActive: true,
        lost: false,
        deviceDisabled: false,
      }),
      HOME,
    );
    assert.equal(state.trackingMode, 'SAVING');
    assert.equal(state.carMode, true);
    assert.equal(state.walkRecordingMode, 'MANUAL');
    assert.equal(state.walkActive, true);
    assert.equal(state.lost, false);
    assert.equal(state.deviceDisabled, false);
  });

  it('treats a mode it does not recognise as unreported', () => {
    // A value added server-side must not make a switch claim a state it cannot
    // reason about; null leaves the characteristic untouched.
    const state = buildPetState(
      pet({ trackingMode: 'HIBERNATING', walkRecordingMode: 'SEMI' }),
      HOME,
    );
    assert.equal(state.trackingMode, null);
    assert.equal(state.walkRecordingMode, null);
  });

  it('leaves the modes null when the backend omits them', () => {
    const state = buildPetState(pet(), HOME);
    assert.equal(state.trackingMode, null);
    assert.equal(state.carMode, null);
    assert.equal(state.walkActive, null);
    assert.deepEqual(state.availableCommands, []);
  });

  it('takes light and sound from the device state, not the pet', () => {
    const state = buildPetState(pet(), HOME, { petId: 7, lightSwitch: true, soundSwitch: false });
    assert.equal(state.led, true);
    assert.equal(state.sound, false);
  });

  it('reports light and sound unknown without a device state', () => {
    const state = buildPetState(pet(), HOME);
    assert.equal(state.led, null);
    assert.equal(state.sound, null);
  });

  it('keeps only string entries from availableCommands', () => {
    const state = buildPetState(
      pet({ availableCommands: ['LED_SWITCH_ON', 7, null] as unknown as string[] }),
      HOME,
    );
    assert.deepEqual(state.availableCommands, ['LED_SWITCH_ON']);
  });
});
