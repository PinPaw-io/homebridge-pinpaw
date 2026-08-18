import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PinPawAccessory, type PinPawAccessoryContext } from './accessory.js';
import { PinPawApi, PinPawAuthError } from './api.js';
import { parseConfig, type PinPawConfig } from './config.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { buildPetState } from './state.js';
import type { Pet } from './types.js';

/** Consecutive failures tolerated before the log stops being polite about it. */
const FAILURES_BEFORE_ERROR = 3;

export class PinPawPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public pluginConfig!: PinPawConfig;

  private readonly cached = new Map<string, PlatformAccessory<PinPawAccessoryContext>>();
  private readonly handlers = new Map<string, PinPawAccessory>();

  private client: PinPawApi | undefined;
  private timer: NodeJS.Timeout | undefined;
  private failures = 0;
  private started = false;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    const { config: parsed, errors, warnings } = parseConfig(config);
    warnings.forEach((warning) => this.log.warn(warning));

    if (!parsed) {
      // Fatal misconfiguration. Log it and simply never start polling, rather
      // than throwing and taking the whole Homebridge instance down with us.
      errors.forEach((error) => this.log.error(error));
      this.log.error('PinPaw is disabled until the configuration is fixed.');
      return;
    }

    this.pluginConfig = parsed;
    this.client = new PinPawApi(parsed.baseUrl, parsed.apiToken);

    this.api.on('didFinishLaunching', () => void this.start());
    this.api.on('shutdown', () => this.stop());
  }

  /** Homebridge replays every accessory it cached for us before launching. */
  configureAccessory(accessory: PlatformAccessory<PinPawAccessoryContext>): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    await this.poll();

    this.timer = setInterval(() => void this.poll(), this.pluginConfig.pollInterval * 1000);
    this.log.info(`Polling PinPaw every ${this.pluginConfig.pollInterval}s.`);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const pets = await this.client.getPets();
      this.failures = 0;
      this.sync(pets);
    } catch (error) {
      if (error instanceof PinPawAuthError) {
        this.stop();
        this.log.error(
          `${error.message}. Polling stopped -- check apiToken, then restart Homebridge.`,
        );
        return;
      }

      this.failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      // One dropped request is noise; a run of them is worth an error.
      if (this.failures >= FAILURES_BEFORE_ERROR) {
        this.log.error(`PinPaw unreachable (${this.failures} attempts): ${message}`);
      } else {
        this.log.debug(`PinPaw poll failed: ${message}`);
      }
    }
  }

  private sync(pets: Pet[]): void {
    const seen = new Set<string>();

    for (const pet of pets) {
      const state = buildPetState(pet, this.pluginConfig.home);
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${pet.id}`);
      seen.add(uuid);

      let accessory = this.cached.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory<PinPawAccessoryContext>(
          state.name,
          uuid,
        );
        accessory.context = { petId: state.id, name: state.name };
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cached.set(uuid, accessory);
        this.log.info(`Added ${state.name}.`);
      } else {
        accessory.context = { petId: state.id, name: state.name };
      }

      let handler = this.handlers.get(uuid);
      if (!handler) {
        handler = new PinPawAccessory(this, accessory);
        this.handlers.set(uuid, handler);
      }
      handler.update(state);
    }

    this.prune(seen);
  }

  /** Drop accessories for pets that are no longer on the account. */
  private prune(seen: Set<string>): void {
    for (const [uuid, accessory] of this.cached) {
      if (seen.has(uuid)) {
        continue;
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.cached.delete(uuid);
      this.handlers.delete(uuid);
      this.log.info(`Removed ${accessory.displayName}, no longer on the account.`);
    }
  }
}
