# homebridge-pinpaw

[Homebridge](https://homebridge.io) plugin for the [PinPaw](https://pinpaw.io)
GPS pet tracker. Puts each of your pets into HomeKit as a battery, an at-home
sensor and a motion sensor, so the Home app can show them and automations can
trigger on them.

Companion to the [Home Assistant integration](https://github.com/PinPaw-io/homeassistant-pinpaw)
and the [Fibaro HC3 QuickApp](https://github.com/PinPaw-io/fibaro-pinpaw).

> **Status: experimental. Not yet verified against a live Homebridge install.**
> The API client, config handling, state mapping and the HomeKit wiring are
> covered by 65 automated tests, including a stubbed HAP layer that checks which
> characteristics get pushed. It has not yet been run against a real Homebridge
> instance paired to a real Home app. Please report what you hit.

## What shows up in HomeKit

One accessory per pet, with three services:

| Service | What it reports |
| --- | --- |
| Battery | Level in percent, charging state, and a low-battery warning below 20% |
| Occupancy sensor "At Home" | Occupancy detected while the pet is inside the home radius |
| Motion sensor | The tracker's own motion flag; can be switched off |

When the tracker goes offline the last known values stay put, but the sensors
are marked inactive so the Home app does not imply the reading is live.

### Why there is no map or distance

HomeKit has no location characteristic, so coordinates cannot be published to
the Home app at all, and a raw distance in metres would be equally useless
there because HomeKit automations cannot trigger on a numeric threshold. What
people actually automate on is "did the pet leave", which is exactly what an
occupancy sensor expresses. The plugin does the distance maths internally and
publishes the answer, not the number.

If you want the coordinates themselves, use the Home Assistant integration,
where the pet is a proper `device_tracker` with a map.

## Installation

> Not published to npm yet, so the plugin browser in the Homebridge UI will not
> find it and `npm install -g homebridge-pinpaw` will not resolve. Until it is
> published, install from source:

```bash
git clone https://github.com/PinPaw-io/homebridge-pinpaw.git
cd homebridge-pinpaw
npm install && npm run build && npm link
```

Once it is on npm, the usual `npm install -g homebridge-pinpaw` or a search for
**PinPaw** in the Homebridge UI plugin browser will be the way in.

### Getting a token

Requires PinPaw app **1.6.0 or newer**: **Settings > API tokens > Create
token**. It is shown once and starts with `ppw_pat_`.

## Configuration

The Homebridge UI renders a form for all of this. The raw block looks like:

```json
{
  "platforms": [
    {
      "platform": "PinPaw",
      "name": "PinPaw",
      "apiToken": "ppw_pat_your_token_here",
      "pollInterval": 60,
      "home": {
        "latitude": 52.2297,
        "longitude": 21.0122,
        "radius": 100
      },
      "exposeMotion": true
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `apiToken` | *(required)* | PinPaw personal access token |
| `pollInterval` | `60` | Seconds between polls; anything below 15 is raised to 15 |
| `home.latitude` | *(none)* | Home coordinates. Without them the At Home sensor stays blank |
| `home.longitude` | *(none)* | |
| `home.radius` | `100` | How many metres from those coordinates still counts as home |
| `exposeMotion` | `true` | Set to `false` to drop the per-pet motion sensor |
| `baseUrl` | `https://api.pinpaw.io` | Only change if you were told to |

A missing or malformed token is a fatal config error: the plugin logs what is
wrong and stays idle instead of retrying against a credential that cannot work.
The same happens if the API rejects the token with `401` or `403`. Everything
else, including a flaky network, is treated as transient and retried on the
next poll, keeping the last known readings in place.

Unlike the Home Assistant and Fibaro integrations, the home location has to be
typed in here. Home Assistant has Zones and Fibaro HC3 has a location panel to
read it from; Homebridge has no equivalent, so there is nothing to inherit.

## Development

```bash
npm install
npm test          # 65 tests, no network and no Homebridge needed
npm run lint
npm run build
```

`test/platform.test.ts` runs the real platform against a hand-rolled stand-in
for Homebridge and HAP, so the path from an API response to a HomeKit
characteristic is exercised end to end. It is not an emulator, which is why the
hardware caveat at the top still stands.

```
src/api.ts         REST client; 401/403 raise a distinct error
src/config.ts      config.json validation and normalisation
src/geo.ts         Haversine distance
src/state.ts       One pet flattened into what the services need
src/accessory.ts   HomeKit services for a single pet
src/platform.ts    Discovery, polling, accessory lifecycle
```

## Licence

MIT. See [LICENSE](LICENSE).
