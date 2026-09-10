import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { PinPawPlatform } from './platform.js';
import {
  CMD_DEFAULT_TRACKING,
  CMD_LED_OFF,
  CMD_LED_ON,
  CMD_LIVE_TRACKING,
  CMD_SAVING_TRACKING,
  CMD_SOUND_OFF,
  CMD_SOUND_ON,
  MOMENTARY_RESET_MS,
} from './settings.js';
import type { PetState } from './types.js';

/** What we persist on the cached accessory so it survives a restart. */
export interface PinPawAccessoryContext {
  petId: number;
  name: string;
}

const HOME_SUBTYPE = 'at-home';
const MOTION_SUBTYPE = 'motion';
const CAR_MODE_SUBTYPE = 'car-mode';
const MANUAL_WALK_SUBTYPE = 'manual-walk';
const WALK_ACTIVE_SUBTYPE = 'walk-active';
const LIVE_TRACKING_SUBTYPE = 'live-tracking';
const SLEEP_SUBTYPE = 'sleep';
const LED_SUBTYPE = 'led';
const SOUND_SUBTYPE = 'sound';

/** Every control subtype, so a disabled or unsupported one can be cleaned up. */
const CONTROL_SUBTYPES = [
  CAR_MODE_SUBTYPE,
  MANUAL_WALK_SUBTYPE,
  WALK_ACTIVE_SUBTYPE,
  LIVE_TRACKING_SUBTYPE,
  SLEEP_SUBTYPE,
  SOUND_SUBTYPE,
];

/**
 * One HomeKit accessory per pet.
 *
 * HomeKit has no location characteristic, so coordinates cannot be surfaced
 * directly and neither can distance -- HomeKit automations cannot trigger on a
 * numeric threshold anyway. What it does model well is the question people
 * actually automate on: is the pet home or not. That becomes an occupancy
 * sensor, which works as a trigger in the Home app with no extra tooling.
 */
export class PinPawAccessory {
  private readonly battery: Service;
  private readonly homeSensor: Service;
  private motionSensor: Service | undefined;

  /** Control services by subtype; only the ones this tracker supports exist. */
  private readonly controls = new Map<string, Service>();

  /** Latest snapshot, so a setter can consult state the write depends on. */
  private state: PetState;

  constructor(
    private readonly platform: PinPawPlatform,
    private readonly accessory: PlatformAccessory<PinPawAccessoryContext>,
    initial: PetState,
  ) {
    const { Service: S, Characteristic: C } = this.platform;
    const petName = this.accessory.context.name;
    this.state = initial;

    this.accessory
      .getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'PinPaw')
      .setCharacteristic(C.Model, 'GPS Pet Tracker')
      .setCharacteristic(C.SerialNumber, String(this.accessory.context.petId));

    this.battery =
      this.accessory.getService(S.Battery) ??
      this.accessory.addService(S.Battery, `${petName} Battery`);

    this.homeSensor =
      this.accessory.getServiceById(S.OccupancySensor, HOME_SUBTYPE) ??
      this.accessory.addService(S.OccupancySensor, `${petName} At Home`, HOME_SUBTYPE);

    if (this.platform.pluginConfig.exposeMotion) {
      this.motionSensor =
        this.accessory.getServiceById(S.MotionSensor, MOTION_SUBTYPE) ??
        this.accessory.addService(S.MotionSensor, `${petName} Motion`, MOTION_SUBTYPE);
    } else {
      // The user turned it off after it had already been published; drop it so
      // the Home app does not keep showing a sensor that never updates.
      const stale = this.accessory.getServiceById(S.MotionSensor, MOTION_SUBTYPE);
      if (stale) {
        this.accessory.removeService(stale);
      }
    }

    this.configureControls(initial);

    // Renaming a pet in the PinPaw app should rename it in the Home app too.
    this.battery.setCharacteristic(C.Name, `${petName} Battery`);
    this.homeSensor.setCharacteristic(C.Name, `${petName} At Home`);
    this.motionSensor?.setCharacteristic(C.Name, `${petName} Motion`);
  }

  /**
   * Publish one switch per mode the tracker actually supports.
   *
   * Which controls exist is decided from `availableCommands`, which is per
   * device protocol: a tracker with no LED template gets no light tile rather
   * than one that fails on every tap. Car mode and walk recording are backend
   * state rather than device commands, so they are always available.
   */
  private configureControls(state: PetState): void {
    const { Service: S, Characteristic: C } = this.platform;
    const petName = this.accessory.context.name;
    const has = (command: string) => state.availableCommands.includes(command);

    if (!this.platform.pluginConfig.exposeControls) {
      this.removeControls([...CONTROL_SUBTYPES, LED_SUBTYPE]);
      return;
    }

    const control = (
      type: typeof S.Switch,
      subtype: string,
      label: string,
      onSet: (value: boolean) => Promise<void>,
    ) => {
      const service =
        this.accessory.getServiceById(type, subtype) ??
        this.accessory.addService(type, `${petName} ${label}`, subtype);
      service.setCharacteristic(C.Name, `${petName} ${label}`);
      service.getCharacteristic(C.On).onSet(async (value: CharacteristicValue) => {
        await onSet(value === true);
      });
      this.controls.set(subtype, service);
    };

    control(S.Switch, CAR_MODE_SUBTYPE, 'Car Mode', (on) =>
      this.platform.control(`car mode ${on ? 'on' : 'off'} for ${petName}`, (client) =>
        client.setCarMode(this.state.id, on),
      ),
    );

    control(S.Switch, MANUAL_WALK_SUBTYPE, 'Manual Walk Mode', (on) =>
      this.platform.control(
        `walk recording set to ${on ? 'manual' : 'automatic'} for ${petName}`,
        (client) => client.setWalkRecordingMode(this.state.id, on ? 'MANUAL' : 'AUTO'),
      ),
    );

    control(S.Switch, WALK_ACTIVE_SUBTYPE, 'Walk Recording', async (on) => {
      // The backend answers 400 in automatic mode, where recording is always on
      // and not the user's to control. Say why rather than forwarding a 400.
      if (this.state.walkRecordingMode !== 'MANUAL') {
        this.platform.log.warn(
          `PinPaw: ignoring walk recording for ${petName} -- only manual mode can start ` +
            'and stop a walk. Turn on Manual Walk Mode first.',
        );
        throw new Error('walk recording is only controllable in manual mode');
      }
      await this.platform.control(`walk ${on ? 'started' : 'stopped'} for ${petName}`, (client) =>
        client.setWalkActive(this.state.id, on),
      );
    });

    if (has(CMD_LIVE_TRACKING) && has(CMD_DEFAULT_TRACKING)) {
      control(S.Switch, LIVE_TRACKING_SUBTYPE, 'Live Tracking', (on) =>
        this.platform.control(
          `${on ? 'live' : 'default'} tracking for ${petName}`,
          (client) =>
            client.sendCommand(this.state.id, on ? CMD_LIVE_TRACKING : CMD_DEFAULT_TRACKING),
        ),
      );
    }

    if (has(CMD_SAVING_TRACKING)) {
      // Momentary on purpose: sleeping mode is one-way. Waking a sleeping
      // tracker happens over Bluetooth with the phone next to it and never
      // through the API, so a switch that stayed on would offer an "off" that
      // silently does nothing.
      control(S.Switch, SLEEP_SUBTYPE, 'Sleeping Mode', async (on) => {
        if (!on) {
          return;
        }
        try {
          await this.platform.control(`sleeping mode for ${petName}`, (client) =>
            client.sendCommand(this.state.id, CMD_SAVING_TRACKING),
          );
        } finally {
          setTimeout(() => this.resetSleepSwitch(), MOMENTARY_RESET_MS).unref?.();
        }
      });
    }

    if (has(CMD_LED_ON) && has(CMD_LED_OFF)) {
      control(S.Lightbulb, LED_SUBTYPE, 'Light', (on) =>
        this.platform.control(`light ${on ? 'on' : 'off'} for ${petName}`, (client) =>
          client.sendCommand(this.state.id, on ? CMD_LED_ON : CMD_LED_OFF),
        ),
      );
    }

    if (has(CMD_SOUND_ON) && has(CMD_SOUND_OFF)) {
      control(S.Switch, SOUND_SUBTYPE, 'Sound', (on) =>
        this.platform.control(`sound ${on ? 'on' : 'off'} for ${petName}`, (client) =>
          client.sendCommand(this.state.id, on ? CMD_SOUND_ON : CMD_SOUND_OFF),
        ),
      );
    }

    // A tracker that lost a capability, or a user who turned the controls off,
    // should not keep a tile in the Home app that no longer does anything.
    this.removeControls(
      [...CONTROL_SUBTYPES, LED_SUBTYPE].filter((subtype) => !this.controls.has(subtype)),
    );
  }

  private removeControls(subtypes: string[]): void {
    const { Service: S } = this.platform;
    for (const subtype of subtypes) {
      const stale =
        this.accessory.getServiceById(S.Switch, subtype) ??
        this.accessory.getServiceById(S.Lightbulb, subtype);
      if (stale) {
        this.accessory.removeService(stale);
      }
    }
  }

  private resetSleepSwitch(): void {
    this.controls
      .get(SLEEP_SUBTYPE)
      ?.updateCharacteristic(this.platform.Characteristic.On, false);
  }

  /**
   * Push one poll's snapshot into HomeKit.
   *
   * A null field means the backend did not report it this round, and the
   * matching characteristic is left untouched rather than being reset to a
   * default -- a missing battery reading must not look like a flat battery.
   */
  update(state: PetState): void {
    const C = this.platform.Characteristic;
    this.state = state;

    if (state.batteryLevel !== null) {
      const level = Math.max(0, Math.min(100, Math.round(state.batteryLevel)));
      this.battery.updateCharacteristic(C.BatteryLevel, level);
    }
    if (state.lowBattery !== null) {
      this.battery.updateCharacteristic(
        C.StatusLowBattery,
        state.lowBattery
          ? C.StatusLowBattery.BATTERY_LEVEL_LOW
          : C.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
    }
    if (state.charging !== null) {
      this.battery.updateCharacteristic(
        C.ChargingState,
        state.charging ? C.ChargingState.CHARGING : C.ChargingState.NOT_CHARGING,
      );
    }

    if (state.atHome !== null) {
      this.homeSensor.updateCharacteristic(
        C.OccupancyDetected,
        state.atHome
          ? C.OccupancyDetected.OCCUPANCY_DETECTED
          : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    }

    if (state.motion !== null && this.motionSensor) {
      this.motionSensor.updateCharacteristic(C.MotionDetected, state.motion);
    }

    this.updateControl(CAR_MODE_SUBTYPE, state.carMode);
    this.updateControl(
      MANUAL_WALK_SUBTYPE,
      state.walkRecordingMode === null ? null : state.walkRecordingMode === 'MANUAL',
    );
    this.updateControl(WALK_ACTIVE_SUBTYPE, state.walkActive);
    this.updateControl(
      LIVE_TRACKING_SUBTYPE,
      state.trackingMode === null ? null : state.trackingMode === 'TRACKING',
    );
    this.updateControl(LED_SUBTYPE, state.led);
    this.updateControl(SOUND_SUBTYPE, state.sound);

    // An unreachable tracker keeps its last known reading, but the sensors are
    // flagged inactive so the Home app shows the value is not live rather than
    // implying the pet is standing still at its last position.
    const active = state.online ?? true;
    this.homeSensor.updateCharacteristic(C.StatusActive, active);
    this.motionSensor?.updateCharacteristic(C.StatusActive, active);
  }

  private updateControl(subtype: string, value: boolean | null): void {
    if (value === null) {
      return;
    }
    this.controls.get(subtype)?.updateCharacteristic(this.platform.Characteristic.On, value);
  }
}
