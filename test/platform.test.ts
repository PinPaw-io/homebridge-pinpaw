import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { PinPawPlatform } from '../src/platform.js';
import { MOMENTARY_RESET_MS } from '../src/settings.js';
import type { Pet } from '../src/types.js';

/**
 * A hand-rolled stand-in for the slice of Homebridge and HAP this plugin
 * touches. Not an emulator: it records what the plugin asked HomeKit to do so
 * the wiring between a poll and a characteristic can be asserted on.
 */

const characteristic = (name: string, extra: Record<string, number> = {}) =>
  Object.assign({ name }, extra);

const FakeCharacteristic = {
  Manufacturer: characteristic('Manufacturer'),
  Model: characteristic('Model'),
  SerialNumber: characteristic('SerialNumber'),
  Name: characteristic('Name'),
  BatteryLevel: characteristic('BatteryLevel'),
  StatusLowBattery: characteristic('StatusLowBattery', {
    BATTERY_LEVEL_LOW: 1,
    BATTERY_LEVEL_NORMAL: 0,
  }),
  ChargingState: characteristic('ChargingState', { CHARGING: 1, NOT_CHARGING: 0 }),
  OccupancyDetected: characteristic('OccupancyDetected', {
    OCCUPANCY_DETECTED: 1,
    OCCUPANCY_NOT_DETECTED: 0,
  }),
  MotionDetected: characteristic('MotionDetected'),
  StatusActive: characteristic('StatusActive'),
  On: characteristic('On'),
};

const FakeService = {
  AccessoryInformation: { name: 'AccessoryInformation' },
  Battery: { name: 'Battery' },
  OccupancySensor: { name: 'OccupancySensor' },
  MotionSensor: { name: 'MotionSensor' },
  Switch: { name: 'Switch' },
  Lightbulb: { name: 'Lightbulb' },
};

type ServiceType = { name: string };

class StubService {
  readonly values = new Map<string, unknown>();
  /** onSet handlers, by characteristic name, so a tap can be simulated. */
  readonly setters = new Map<string, (value: unknown) => Promise<void>>();

  constructor(
    readonly type: ServiceType,
    readonly displayName: string,
    readonly subtype?: string,
  ) {}

  getCharacteristic(char: { name: string }) {
    return {
      onSet: (handler: (value: unknown) => Promise<void>) => {
        this.setters.set(char.name, handler);
      },
    };
  }

  /** Simulate the Home app writing a characteristic. */
  async set(name: string, value: unknown): Promise<void> {
    const handler = this.setters.get(name);
    assert.ok(handler, `no onSet handler for ${name} on ${this.displayName}`);
    await handler(value);
  }

  setCharacteristic(char: { name: string }, value: unknown): this {
    this.values.set(char.name, value);
    return this;
  }

  updateCharacteristic(char: { name: string }, value: unknown): this {
    this.values.set(char.name, value);
    return this;
  }

  get(name: string): unknown {
    return this.values.get(name);
  }
}

class StubAccessory {
  readonly services: StubService[] = [];
  context: Record<string, unknown> = {};

  constructor(
    public displayName: string,
    readonly UUID: string,
  ) {
    this.services.push(new StubService(FakeService.AccessoryInformation, displayName));
  }

  getService(type: ServiceType): StubService | undefined {
    return this.services.find((s) => s.type === type && s.subtype === undefined);
  }

  getServiceById(type: ServiceType, subtype: string): StubService | undefined {
    return this.services.find((s) => s.type === type && s.subtype === subtype);
  }

  addService(type: ServiceType, displayName: string, subtype?: string): StubService {
    const service = new StubService(type, displayName, subtype);
    this.services.push(service);
    return service;
  }

  removeService(service: StubService): void {
    const index = this.services.indexOf(service);
    if (index >= 0) {
      this.services.splice(index, 1);
    }
  }
}

class StubLog {
  readonly info: string[] = [];
  readonly warn: string[] = [];
  readonly error: string[] = [];
  readonly debug: string[] = [];

  private push(bucket: string[]) {
    return (...args: unknown[]) => {
      bucket.push(args.map(String).join(' '));
    };
  }

  get logger() {
    return {
      info: this.push(this.info),
      warn: this.push(this.warn),
      error: this.push(this.error),
      debug: this.push(this.debug),
      success: this.push(this.info),
      log: this.push(this.info),
    };
  }
}

class StubHomebridge {
  readonly registered: StubAccessory[] = [];
  readonly unregistered: StubAccessory[] = [];
  private readonly handlers = new Map<string, (() => void)[]>();

  readonly hap = {
    Service: FakeService,
    Characteristic: FakeCharacteristic,
    uuid: { generate: (seed: string) => `uuid:${seed}` },
  };

  readonly platformAccessory = StubAccessory;

  on(event: string, handler: () => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler();
    }
  }

  registerPlatformAccessories(_p: string, _n: string, accessories: StubAccessory[]): void {
    this.registered.push(...accessories);
  }

  unregisterPlatformAccessories(_p: string, _n: string, accessories: StubAccessory[]): void {
    this.unregistered.push(...accessories);
  }
}

interface Request {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Swaps in a fetch that serves the scripted pets response and records every
 * call. Endpoints other than /api/pets answer 200 with no content, which is
 * what the control writes actually return, so a test only has to script the
 * pet list it wants and then assert on what the plugin sent.
 */
function serve(script: () => Response) {
  const original = globalThis.fetch;
  const requests: Request[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = String(url).replace('https://api.pinpaw.io', '');
    requests.push({
      method: init.method ?? 'GET',
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    if (path === '/api/pets') {
      return script();
    }
    if (path === '/api/device-states/my-pets') {
      return new Response(JSON.stringify(deviceStates), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** What /api/device-states/my-pets returns for the current test. */
let deviceStates: unknown[] = [];

const petsResponse = (pets: Pet[]) =>
  new Response(JSON.stringify(pets), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const BUREK: Pet = {
  id: 7,
  name: 'Burek',
  deviceStatus: 'online',
  latestPosition: {
    latitude: 52.2297,
    longitude: 21.0122,
    batteryLevel: 88,
    charging: false,
    online: true,
    motion: false,
  },
};

const HOME_CONFIG = {
  platform: 'PinPaw',
  apiToken: 'ppw_pat_test',
  home: { latitude: 52.2297, longitude: 21.0122, radius: 100 },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Boot a platform, run one poll cycle, and hand back everything to assert on. */
async function boot(config: Record<string, unknown>, script: () => Response) {
  const { requests, restore } = serve(script);
  const hb = new StubHomebridge();
  const log = new StubLog();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platform = new PinPawPlatform(log.logger as any, config as any, hb as any);
  hb.emit('didFinishLaunching');
  await settle();

  return {
    hb,
    log,
    platform,
    requests,
    teardown: () => {
      hb.emit('shutdown');
      restore();
    },
  };
}

describe('PinPawPlatform', () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    deviceStates = [];
  });

  it('registers one accessory per pet', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([BUREK]));
    teardown = boot_.teardown;

    assert.equal(boot_.hb.registered.length, 1);
    assert.equal(boot_.hb.registered[0]!.UUID, 'uuid:homebridge-pinpaw:7');
    assert.deepEqual(boot_.hb.registered[0]!.context, { petId: 7, name: 'Burek' });
  });

  it('publishes battery, occupancy and motion services', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([BUREK]));
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    const names = accessory.services.map((s) => s.type.name).sort();
    // Three Switch services: car mode, manual walk mode and walk recording are
    // backend state rather than device commands, so every tracker gets them.
    assert.deepEqual(names, [
      'AccessoryInformation',
      'Battery',
      'MotionSensor',
      'OccupancySensor',
      'Switch',
      'Switch',
      'Switch',
    ]);
  });

  it('pushes battery state into HomeKit', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([BUREK]));
    teardown = boot_.teardown;

    const battery = boot_.hb.registered[0]!.getService(FakeService.Battery)!;
    assert.equal(battery.get('BatteryLevel'), 88);
    assert.equal(battery.get('StatusLowBattery'), 0);
    assert.equal(battery.get('ChargingState'), 0);
  });

  it('flags a low battery and charging', async () => {
    const pet: Pet = {
      ...BUREK,
      latestPosition: { ...BUREK.latestPosition, batteryLevel: 8, charging: true },
    };
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([pet]));
    teardown = boot_.teardown;

    const battery = boot_.hb.registered[0]!.getService(FakeService.Battery)!;
    assert.equal(battery.get('BatteryLevel'), 8);
    assert.equal(battery.get('StatusLowBattery'), 1);
    assert.equal(battery.get('ChargingState'), 1);
  });

  it('rounds and clamps the battery level HomeKit receives', async () => {
    const pet: Pet = {
      ...BUREK,
      latestPosition: { ...BUREK.latestPosition, batteryLevel: 104.6 },
    };
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([pet]));
    teardown = boot_.teardown;

    const battery = boot_.hb.registered[0]!.getService(FakeService.Battery)!;
    assert.equal(battery.get('BatteryLevel'), 100);
  });

  it('reports occupancy when the pet is home', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([BUREK]));
    teardown = boot_.teardown;

    const home = boot_.hb.registered[0]!.getServiceById(FakeService.OccupancySensor, 'at-home')!;
    assert.equal(home.get('OccupancyDetected'), 1);
    assert.equal(home.get('StatusActive'), true);
  });

  it('clears occupancy when the pet is away', async () => {
    const pet: Pet = {
      ...BUREK,
      latestPosition: { ...BUREK.latestPosition, latitude: 52.24 },
    };
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([pet]));
    teardown = boot_.teardown;

    const home = boot_.hb.registered[0]!.getServiceById(FakeService.OccupancySensor, 'at-home')!;
    assert.equal(home.get('OccupancyDetected'), 0);
  });

  it('marks sensors inactive when the tracker is offline', async () => {
    const pet: Pet = { ...BUREK, deviceStatus: 'offline' };
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([pet]));
    teardown = boot_.teardown;

    const home = boot_.hb.registered[0]!.getServiceById(FakeService.OccupancySensor, 'at-home')!;
    assert.equal(home.get('StatusActive'), false);
  });

  it('omits the motion sensor when it is switched off', async () => {
    const boot_ = await boot(
      { ...HOME_CONFIG, exposeMotion: false },
      () => petsResponse([BUREK]),
    );
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    assert.equal(accessory.getServiceById(FakeService.MotionSensor, 'motion'), undefined);
  });

  it('handles several pets independently', async () => {
    const reksio: Pet = {
      id: 9,
      name: 'Reksio',
      deviceStatus: 'online',
      latestPosition: { latitude: 52.24, longitude: 21.0122, batteryLevel: 40 },
    };
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([BUREK, reksio]));
    teardown = boot_.teardown;

    assert.equal(boot_.hb.registered.length, 2);
    const [burek, second] = boot_.hb.registered;
    assert.equal(burek!.getServiceById(FakeService.OccupancySensor, 'at-home')!.get('OccupancyDetected'), 1);
    assert.equal(second!.getServiceById(FakeService.OccupancySensor, 'at-home')!.get('OccupancyDetected'), 0);
  });

  it('leaves occupancy unset when no home is configured', async () => {
    const boot_ = await boot(
      { platform: 'PinPaw', apiToken: 'ppw_pat_test' },
      () => petsResponse([BUREK]),
    );
    teardown = boot_.teardown;

    const home = boot_.hb.registered[0]!.getServiceById(FakeService.OccupancySensor, 'at-home')!;
    assert.equal(home.get('OccupancyDetected'), undefined);
    assert.ok(boot_.log.warn.some((line) => line.includes('No home location')));
  });

  it('never polls when the token is missing', async () => {
    const boot_ = await boot({ platform: 'PinPaw' }, () => petsResponse([BUREK]));
    teardown = boot_.teardown;

    assert.equal(boot_.hb.registered.length, 0);
    assert.ok(boot_.log.error.some((line) => line.includes('apiToken is missing')));
  });

  it('stops polling when the token is rejected', async () => {
    const boot_ = await boot(HOME_CONFIG, () => new Response('', { status: 401 }));
    teardown = boot_.teardown;

    assert.equal(boot_.hb.registered.length, 0);
    assert.ok(boot_.log.error.some((line) => line.includes('Polling stopped')));
  });

  it('keeps existing accessories through a transient failure', async () => {
    let fail = false;
    const boot_ = await boot(HOME_CONFIG, () =>
      fail ? new Response('', { status: 500 }) : petsResponse([BUREK]),
    );
    teardown = boot_.teardown;

    assert.equal(boot_.hb.registered.length, 1);
    fail = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (boot_.platform as any).poll();

    assert.equal(boot_.hb.unregistered.length, 0);
    const battery = boot_.hb.registered[0]!.getService(FakeService.Battery)!;
    assert.equal(battery.get('BatteryLevel'), 88, 'last known reading survives');
  });

  it('unregisters a pet that left the account', async () => {
    let pets: Pet[] = [BUREK];
    const boot_ = await boot(HOME_CONFIG, () => petsResponse(pets));
    teardown = boot_.teardown;

    assert.equal(boot_.hb.registered.length, 1);
    pets = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (boot_.platform as any).poll();

    assert.equal(boot_.hb.unregistered.length, 1);
    assert.equal(boot_.hb.unregistered[0]!.UUID, 'uuid:homebridge-pinpaw:7');
  });

  it('does not duplicate accessories across polls', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([BUREK]));
    teardown = boot_.teardown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (boot_.platform as any).poll();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (boot_.platform as any).poll();

    assert.equal(boot_.hb.registered.length, 1);
    assert.equal(boot_.hb.registered[0]!.services.length, 7);
  });
});

/**
 * The mode and hardware controls. Which ones exist is decided per tracker from
 * `availableCommands`, so most of these boot a pet that advertises a specific
 * set and then assert on the services and on what a tap actually sent.
 */
describe('PinPawPlatform controls', () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    deviceStates = [];
  });

  const ALL_COMMANDS = [
    'LIVE_TRACKING',
    'DEFAULT_TRACKING',
    'SAVING_TRACKING',
    'LED_SWITCH_ON',
    'LED_SWITCH_OFF',
    'SOUND_SWITCH_ON',
    'SOUND_SWITCH_OFF',
  ];

  const equipped = (overrides: Partial<Pet> = {}): Pet => ({
    ...BUREK,
    availableCommands: ALL_COMMANDS,
    carMode: false,
    walkRecordingMode: 'MANUAL',
    walkActive: false,
    trackingMode: 'DAILY',
    ...overrides,
  });

  const control = (accessory: StubAccessory, subtype: string) =>
    accessory.getServiceById(FakeService.Switch, subtype) ??
    accessory.getServiceById(FakeService.Lightbulb, subtype);

  it('publishes a control per supported command', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    for (const subtype of [
      'car-mode',
      'manual-walk',
      'walk-active',
      'live-tracking',
      'sleep',
      'led',
      'sound',
    ]) {
      assert.ok(control(accessory, subtype), `expected a ${subtype} control`);
    }
  });

  it('omits the controls a tracker does not advertise', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped({ availableCommands: [] })]));
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    for (const subtype of ['live-tracking', 'sleep', 'led', 'sound']) {
      assert.equal(control(accessory, subtype), undefined, `${subtype} should not exist`);
    }
    // The three that are backend state, not device commands, survive.
    assert.ok(control(accessory, 'car-mode'));
    assert.ok(control(accessory, 'manual-walk'));
    assert.ok(control(accessory, 'walk-active'));
  });

  it('drops every control when exposeControls is off', async () => {
    const boot_ = await boot({ ...HOME_CONFIG, exposeControls: false }, () =>
      petsResponse([equipped()]),
    );
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    const names = accessory.services.map((s) => s.type.name).sort();
    assert.deepEqual(names, [
      'AccessoryInformation',
      'Battery',
      'MotionSensor',
      'OccupancySensor',
    ]);
  });

  it('pushes the reported modes into the switches', async () => {
    const pet = equipped({
      carMode: true,
      walkRecordingMode: 'MANUAL',
      walkActive: true,
      trackingMode: 'TRACKING',
    });
    deviceStates = [{ petId: 7, lightSwitch: true, soundSwitch: false }];

    const boot_ = await boot(HOME_CONFIG, () => petsResponse([pet]));
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    assert.equal(control(accessory, 'car-mode')!.get('On'), true);
    assert.equal(control(accessory, 'manual-walk')!.get('On'), true);
    assert.equal(control(accessory, 'walk-active')!.get('On'), true);
    assert.equal(control(accessory, 'live-tracking')!.get('On'), true);
    assert.equal(control(accessory, 'led')!.get('On'), true);
    assert.equal(control(accessory, 'sound')!.get('On'), false);
  });

  it('reads automatic walk mode as the manual switch being off', async () => {
    const boot_ = await boot(HOME_CONFIG, () =>
      petsResponse([equipped({ walkRecordingMode: 'AUTO' })]),
    );
    teardown = boot_.teardown;

    assert.equal(control(boot_.hb.registered[0]!, 'manual-walk')!.get('On'), false);
  });

  it('leaves a switch alone when the backend reported no mode', async () => {
    const boot_ = await boot(HOME_CONFIG, () =>
      petsResponse([equipped({ carMode: null, trackingMode: null })]),
    );
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    assert.equal(control(accessory, 'car-mode')!.get('On'), undefined);
    assert.equal(control(accessory, 'live-tracking')!.get('On'), undefined);
  });

  it('skips the device-state request when nothing advertises light or sound', async () => {
    const boot_ = await boot(HOME_CONFIG, () =>
      petsResponse([equipped({ availableCommands: ['LIVE_TRACKING', 'DEFAULT_TRACKING'] })]),
    );
    teardown = boot_.teardown;

    assert.equal(
      boot_.requests.some((r) => r.path === '/api/device-states/my-pets'),
      false,
    );
  });

  it('sends car mode to its own endpoint', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    await control(boot_.hb.registered[0]!, 'car-mode')!.set('On', true);

    assert.deepEqual(
      boot_.requests.find((r) => r.path === '/api/pets/7/car-mode'),
      { method: 'PUT', path: '/api/pets/7/car-mode', body: { enabled: true } },
    );
  });

  it('sends the walk recording mode by name', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    await control(boot_.hb.registered[0]!, 'manual-walk')!.set('On', false);

    assert.deepEqual(
      boot_.requests.find((r) => r.path === '/api/pets/7/walk-recording-mode')!.body,
      { mode: 'AUTO' },
    );
  });

  it('starts a walk in manual mode', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    await control(boot_.hb.registered[0]!, 'walk-active')!.set('On', true);

    assert.deepEqual(
      boot_.requests.find((r) => r.path === '/api/pets/7/walk-active')!.body,
      { enabled: true },
    );
  });

  it('refuses to start a walk in automatic mode instead of sending a doomed write', async () => {
    const boot_ = await boot(HOME_CONFIG, () =>
      petsResponse([equipped({ walkRecordingMode: 'AUTO' })]),
    );
    teardown = boot_.teardown;

    await assert.rejects(() => control(boot_.hb.registered[0]!, 'walk-active')!.set('On', true));

    assert.equal(
      boot_.requests.some((r) => r.path === '/api/pets/7/walk-active'),
      false,
    );
    assert.match(boot_.log.warn.join('\n'), /only manual mode/);
  });

  it('maps the live tracking switch onto the two tracking commands', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    const live = control(boot_.hb.registered[0]!, 'live-tracking')!;
    await live.set('On', true);
    await live.set('On', false);

    const sent = boot_.requests.filter((r) => r.method === 'POST').map((r) => r.path);
    assert.deepEqual(sent, [
      '/api/pets/7/commands/LIVE_TRACKING',
      '/api/pets/7/commands/DEFAULT_TRACKING',
    ]);
  });

  it('sends sleeping mode once and ignores switching it back off', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    const sleep = control(boot_.hb.registered[0]!, 'sleep')!;
    await sleep.set('On', true);
    await sleep.set('On', false);

    const sent = boot_.requests.filter((r) => r.method === 'POST').map((r) => r.path);
    assert.deepEqual(sent, ['/api/pets/7/commands/SAVING_TRACKING']);
  });

  it('snaps the sleeping switch back off, because the mode cannot be left', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    const sleep = control(boot_.hb.registered[0]!, 'sleep')!;
    await sleep.set('On', true);
    await new Promise((resolve) => setTimeout(resolve, MOMENTARY_RESET_MS + 50));

    assert.equal(sleep.get('On'), false);
  });

  it('sends the light and sound commands', async () => {
    const boot_ = await boot(HOME_CONFIG, () => petsResponse([equipped()]));
    teardown = boot_.teardown;

    const accessory = boot_.hb.registered[0]!;
    await control(accessory, 'led')!.set('On', true);
    await control(accessory, 'sound')!.set('On', false);

    const sent = boot_.requests.filter((r) => r.method === 'POST').map((r) => r.path);
    assert.deepEqual(sent, [
      '/api/pets/7/commands/LED_SWITCH_ON',
      '/api/pets/7/commands/SOUND_SWITCH_OFF',
    ]);
  });
});
