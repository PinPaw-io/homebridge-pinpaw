import type { PlatformAccessory, Service } from 'homebridge';

import type { PinPawPlatform } from './platform.js';
import type { PetState } from './types.js';

/** What we persist on the cached accessory so it survives a restart. */
export interface PinPawAccessoryContext {
  petId: number;
  name: string;
}

const HOME_SUBTYPE = 'at-home';
const MOTION_SUBTYPE = 'motion';

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

  constructor(
    private readonly platform: PinPawPlatform,
    private readonly accessory: PlatformAccessory<PinPawAccessoryContext>,
  ) {
    const { Service: S, Characteristic: C } = this.platform;
    const petName = this.accessory.context.name;

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

    // Renaming a pet in the PinPaw app should rename it in the Home app too.
    this.battery.setCharacteristic(C.Name, `${petName} Battery`);
    this.homeSensor.setCharacteristic(C.Name, `${petName} At Home`);
    this.motionSensor?.setCharacteristic(C.Name, `${petName} Motion`);
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

    // An unreachable tracker keeps its last known reading, but the sensors are
    // flagged inactive so the Home app shows the value is not live rather than
    // implying the pet is standing still at its last position.
    const active = state.online ?? true;
    this.homeSensor.updateCharacteristic(C.StatusActive, active);
    this.motionSensor?.updateCharacteristic(C.StatusActive, active);
  }
}
