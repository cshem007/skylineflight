// Drone definitions. Speeds/times are DJI's published figures; the force and
// rate numbers are tuning values chosen so each airframe feels distinct.

export type ModeKind = 'assisted' | 'manual';

export interface FlightMode {
  id: string;          // letter shown on the HUD
  name: string;
  kind: ModeKind;
  vmax: number;        // horizontal speed cap, m/s
  vUp: number;         // climb speed, m/s
  vDown: number;       // descent speed, m/s
  yawRate: number;     // deg/s at full stick
  accel: number;       // max horizontal acceleration, m/s^2 (assisted)
  stabilisedCam: boolean; // horizon kept level (gimbal / electronic)
}

export interface Drone {
  id: string;
  name: string;
  cls: string;
  mass: number;          // kg
  radius: number;        // collision sphere, m
  flightTimeMin: number; // hover-ish endurance
  windResist: number;    // m/s
  vfov: number;          // camera vertical FOV, deg (rectilinear stand-in)
  camTilt: number;       // default camera uptilt in manual, deg
  twr: number;           // thrust-to-weight in manual
  maxRate: number;       // deg/s at full stick in manual
  avoidance: boolean;    // obstacle braking in C/N modes
  modes: FlightMode[];
}

const A = (id: string, name: string, vmax: number, vUp: number, vDown: number, yawRate: number, accel: number): FlightMode =>
  ({ id, name, kind: 'assisted', vmax, vUp, vDown, yawRate, accel, stabilisedCam: true });

export const DRONES: Drone[] = [
  {
    id: 'avata2', name: 'Avata 2', cls: 'FPV · Cinewhoop', mass: 0.377, radius: 0.13,
    flightTimeMin: 23, windResist: 10.7, vfov: 95, camTilt: 18, twr: 4.2, maxRate: 720, avoidance: false,
    modes: [
      A('N', 'Normal', 8, 6, 6, 120, 7),
      A('S', 'Sport', 16, 9, 9, 180, 12),
      { id: 'M', name: 'Manual', kind: 'manual', vmax: 27, vUp: 0, vDown: 0, yawRate: 0, accel: 0, stabilisedCam: false }
    ]
  },
  {
    id: 'mini4pro', name: 'Mini 4 Pro', cls: 'Camera · sub-250 g', mass: 0.249, radius: 0.16,
    flightTimeMin: 34, windResist: 10.7, vfov: 52, camTilt: 0, twr: 2.6, maxRate: 300, avoidance: true,
    modes: [A('C', 'Cine', 5, 3, 3, 40, 3), A('N', 'Normal', 10, 5, 5, 90, 6), A('S', 'Sport', 16, 5, 5, 150, 9)]
  },
  {
    id: 'mavic3pro', name: 'Mavic 3 Pro', cls: 'Camera · Pro', mass: 0.958, radius: 0.22,
    flightTimeMin: 43, windResist: 12, vfov: 54, camTilt: 0, twr: 2.4, maxRate: 250, avoidance: true,
    modes: [A('C', 'Cine', 5, 3, 3, 40, 2.5), A('N', 'Normal', 15, 6, 6, 90, 5), A('S', 'Sport', 21, 8, 6, 150, 7.5)]
  },
  {
    id: 'neo', name: 'Neo', cls: 'Micro · Palm', mass: 0.135, radius: 0.1,
    flightTimeMin: 18, windResist: 8, vfov: 72, camTilt: 10, twr: 3.2, maxRate: 600, avoidance: false,
    modes: [
      A('N', 'Normal', 8, 2, 2, 90, 5),
      A('S', 'Sport', 12, 4, 4, 140, 8),
      { id: 'M', name: 'Manual', kind: 'manual', vmax: 16, vUp: 0, vDown: 0, yawRate: 0, accel: 0, stabilisedCam: false }
    ]
  }
];
