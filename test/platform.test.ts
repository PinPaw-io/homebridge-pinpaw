import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { PinPawPlatform } from '../src/platform.js';
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
};

const FakeService = {
  AccessoryInformation: { name: 'AccessoryInformation' },
  Battery: { name: 'Battery' },
  OccupancySensor: { name: 'OccupancySensor' },
  MotionSensor: { name: 'MotionSensor' },
};

type ServiceType = { name: string };

class StubService {
  readonly values = new Map<string, unknown>();

  constructor(
    readonly type: ServiceType,
    readonly displayName: string,
    readonly subtype?: string,
  ) {}

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

/** Swaps in a fetch that serves a scripted pets response. */
function serve(script: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => script()) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

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
  const restore = serve(script);
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
    assert.deepEqual(names, ['AccessoryInformation', 'Battery', 'MotionSensor', 'OccupancySensor']);
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
    assert.equal(boot_.hb.registered[0]!.services.length, 4);
  });
});
