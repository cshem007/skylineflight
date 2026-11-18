# Skyline FPV

FPV drone simulator for **Meta Quest 3 / 3S** (WebXR) and **PC**, built with three.js and Rapier physics.

## Fly it

Open the GitHub Pages link in the Quest browser or on a PC. The app detects the device:

- **Quest:** pick a drone, press **Enter VR**. You get a fixed FPV goggles screen in front of you. Squeeze both grips to recenter it.
- **PC:** press **Fly on this screen**. Plug in a gamepad any time; it switches automatically.

| Action | Keyboard | Gamepad | Quest |
|---|---|---|---|
| Throttle / yaw (Mode 2) | W S / A D | left stick | left stick |
| Pitch / roll | arrow keys | right stick | right stick |
| Take off · land · reset | Enter | A | A |
| Return to home | H | B | B |
| Flight mode | M | X | X |
| Camera tilt | R / F | LB / RB | grip L / R |
| Back to cockpit | Esc | Esc | exit VR |

## Flight setup (cockpit console)

| Row | Options |
|---|---|
| **View** | **FPV goggles** (a fixed goggles screen, comfortable) · **Line of sight** (you stand on the street with a remote) · **Immersive 360** (Avata 2 and Neo, VR only) |
| **Control** | **Regular sticks** · **Motion control** (one-hand, Quest controllers) |
| **Start in** | Normal · Sport · Manual (acro; Avata 2 and Neo) |

**Immersive 360:** your head is the drone's camera. With a stabilised mode (N / S) the drone turns where you look and the yaw stick turns your frame of reference. In Manual the camera is a 360 camera on an acro drone: the drone rotates from your sticks and you can look around freely. Squeeze both grips to recenter.

**Motion control (right controller):** hold the trigger to fly, release to brake and hover. The drone flies where you point (point up to climb, down to dive) and turns when you turn your wrist away from where you pulled the trigger. Tilt your wrist to strafe. Left stick: altitude and strafe. In **Manual** mode the controller's tilt is the pitch/roll stick (nose down = forward), and the left stick is throttle and yaw.

**Remote screen** size (Standard / Large / Huge) is in Settings.

## How a session flows

1. **Cockpit lobby** (360°, VR or PC): pick a drone on the left display, a mission on the right board, plan a route on the holographic city table (click to add, drag pins, drag the arrow for height, planner panel for speed/action), choose FPV or line of sight, lift the red cover and press LAUNCH.
2. **Pre-flight briefing:** the drone turning on a pad, its capabilities and modes, the mission objective, your controls, and the pre-flight checks.
3. **Flight** with the mission running: objective box, target pointer, 3D markers in the world.
4. **Results** card with score and your best (saved per mission and drone in this browser). A / Enter returns to the cockpit. Esc leaves a flight early.

## Missions

| Mission | Goal | Score |
|---|---|---|
| Free ride | Fly anywhere; land to log the flight | distance flown |
| Gate run | Rings in order along the streets (course built from the street map, 8–12 gates) | time (lower is better) |
| Photo hunt | Frame 5 rooftop beacons in the centre of the shot and hold still until the shutter fires | framing + steadiness |
| Line of sight | Controller view only; touch 5 checkpoints while keeping the drone visible; 10 s out of sight fails | time + sight penalty |
| Last 10 % | Start 200+ m out with 12 % battery and strong gusts; land on the home pad | battery left + landing accuracy |
| My route | Fly the waypoints planned in the lobby; Hover / Photo points need you to hold position | accuracy + time |

## What is simulated

- **Assisted modes (C / N / S):** GPS hold, stick = target velocity, braking when you let go, tilt follows acceleration, gimbal keeps the horizon level, wind drift.
- **Manual mode (M, Avata 2 and Neo):** rate (acro) mode. Centre stick = hover thrust, quadratic drag tuned to each drone's top speed, full wind.
- **Obstacle braking** on Mini 4 Pro and Mavic 3 Pro in C / N (off in Sport, as on the real drones).
- **Battery** drains with throttle; low-battery warning at 20 %, automatic return to home at 15 %.
- **Crashes** from hard impacts; reset puts you back on the home pad.
- **Street circuit:** 32 m altitude limit and a geofence over the open blocks of the city model.
- **Real local time** drives sun and sky. Time and date are on every screen.

- **Battery voltage:** per-cell model (Avata 2 / Mavic 3 Pro 4S, Mini 4 Pro / Neo 2S). Voltage sags under load and more when nearly empty; available power drops with it, so a tired pack climbs slower and needs more stick to hover.
- **Air:** gusts plus turbulence; sheltered low between buildings, stronger above the rooftops. Ground effect near the floor, and prop-wash wobble when you drop fast on the throttle (manual).
- **Sound and feel:** motors, wind past the airframe, low-battery beeps (faster when critical), gate chime, camera shutter, crash; controller vibration on Quest controllers and gamepads.

## Settings

In the cockpit, turn around to your left. Saved in this browser.

Stick mode (1 / 2) · stick expo · acro rates · FPV uptilt · wind strength · goggles screen size · volume · graphics (Auto / Low / Medium / High) · FPS counter.

Graphics *Auto* picks Low on Quest 3S (72 Hz, strong foveation, 1280×720 camera feed, no shadows), Medium on Quest 3 and High on PC.

Drone specs (speeds, flight times, wind resistance) are DJI's published figures; force and rate values are tuning numbers.

## Develop

```bash
npm install
npm run dev
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Assets

`public/assets/city.glb` is the Sketchfab "City" model (Standard license), optimised with meshopt + WebP. The mesh names suggest it was extracted from another game, so it is used for development only; a properly licensed map replaces it before any public release.
