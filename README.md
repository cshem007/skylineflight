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
| Menu | Esc | — | exit VR |

## What is simulated

- **Assisted modes (C / N / S):** GPS hold, stick = target velocity, braking when you let go, tilt follows acceleration, gimbal keeps the horizon level, wind drift.
- **Manual mode (M, Avata 2 and Neo):** rate (acro) mode. Centre stick = hover thrust, quadratic drag tuned to each drone's top speed, full wind.
- **Obstacle braking** on Mini 4 Pro and Mavic 3 Pro in C / N (off in Sport, as on the real drones).
- **Battery** drains with throttle; low-battery warning at 20 %, automatic return to home at 15 %.
- **Crashes** from hard impacts; reset puts you back on the home pad.
- **Street circuit:** 32 m altitude limit and a geofence over the open blocks of the city model.
- **Real local time** drives sun and sky. Time and date are on every screen.

Drone specs (speeds, flight times, wind resistance) are DJI's published figures; force and rate values are tuning numbers.

## Develop

```bash
npm install
npm run dev
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Assets

`public/assets/city.glb` is the Sketchfab "City" model (Standard license), optimised with meshopt + WebP. The mesh names suggest it was extracted from another game, so it is used for development only; a properly licensed map replaces it before any public release.
