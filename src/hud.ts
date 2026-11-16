import type { Objective, Result } from './missions';

export interface Extras { objective?: Objective | null; target?: { x: number; y: number; on: boolean; dist: number } | null; flash?: number; result?: Result | null; resultKey?: string }

// One HUD renderer, drawn into a 2D canvas. On PC that canvas sits over the
// 3D view; in VR it is a texture on the goggles screen.

export interface HudState {
  hs: number; vs: number; alt: number; agl: number; home: number; heading: number;
  battery: number; flightTime: number; mode: string; modeName: string; manual: boolean;
  phase: string; roll: number; pitch: number; drone: string; input: string;
  warnings: string[]; banner: string | null; wind: number; signal: number; camTilt: number;
  extras?: Extras;
  voltage?: number; cellV?: number; fps?: number | null;
}

const MONO = '"JetBrains Mono", ui-monospace, monospace', SANS = '"Space Grotesk", system-ui, sans-serif';
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function drawHud(g: CanvasRenderingContext2D, W: number, H: number, s: HudState) {
  const u = H / 1080; // design units: 1920x1080
  g.clearRect(0, 0, W, H);
  g.save(); g.scale(u, u); const w = W / u, h = 1080;
  g.lineJoin = 'round'; g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 6;
  const T = (t: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight = 700, font = MONO) => {
    g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y);
  };
  const cx = w / 2, cy = h / 2;

  // compass tape
  g.save(); g.beginPath(); g.rect(cx - 330, 20, 660, 60); g.clip();
  const pxDeg = 5.5;
  for (let d = Math.floor(s.heading - 70); d <= s.heading + 70; d++) {
    if (d % 5) continue; const x = cx + (d - s.heading) * pxDeg, dd = ((d % 360) + 360) % 360;
    g.fillStyle = '#fff'; g.fillRect(x - 1, 62, 2, dd % 15 ? 8 : 16);
    if (dd % 45 === 0) T(({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' } as Record<number, string>)[dd], x, 52, 24, dd === 0 ? '#FFB020' : '#fff', 'center');
    else if (dd % 15 === 0) T(String(dd), x, 50, 16, 'rgba(255,255,255,.75)', 'center', 500);
  }
  g.restore();
  g.fillStyle = '#3FD0FF'; g.beginPath(); g.moveTo(cx - 9, 92); g.lineTo(cx + 9, 92); g.lineTo(cx, 80); g.fill();
  T(`${Math.round(s.heading).toString().padStart(3, '0')}°`, cx, 124, 24, '#fff', 'center');

  // attitude: horizon bar relative to the camera, plus centre reticle
  g.save(); g.translate(cx, cy); g.rotate(s.roll); g.translate(0, s.pitch * 600);
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(-300, 0); g.lineTo(-90, 0); g.moveTo(90, 0); g.lineTo(300, 0); g.stroke();
  g.restore();
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 18, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - 46, cy); g.lineTo(cx - 24, cy); g.moveTo(cx + 24, cy); g.lineTo(cx + 46, cy); g.stroke();

  // left: speed
  T('H.S', 300, cy - 70, 22, 'rgba(255,255,255,.8)', 'left', 500);
  T(s.hs.toFixed(1), 300, cy - 10, 64);
  T(`m/s · ${Math.round(s.hs * 3.6)} km/h`, 300, cy + 22, 20, 'rgba(255,255,255,.8)', 'left', 500);
  T('V.S', 300, cy + 78, 22, 'rgba(255,255,255,.8)', 'left', 500);
  T(`${s.vs >= 0 ? '+' : ''}${s.vs.toFixed(1)}`, 300, cy + 118, 38);

  // right: altitude + home
  T('ALT', w - 300, cy - 70, 22, 'rgba(255,255,255,.8)', 'right', 500);
  T(s.alt.toFixed(1), w - 300, cy - 10, 64, s.warnings.includes('ALTITUDE LIMIT') ? '#FFB020' : '#fff', 'right');
  T(`m · AGL ${s.agl.toFixed(1)}`, w - 300, cy + 22, 20, 'rgba(255,255,255,.8)', 'right', 500);
  T('HOME', w - 300, cy + 78, 22, 'rgba(255,255,255,.8)', 'right', 500);
  T(`${Math.round(s.home)} m`, w - 300, cy + 118, 38, '#fff', 'right');

  // top-left status
  g.shadowBlur = 0; g.fillStyle = s.manual ? '#FF5A4E' : '#FFB020'; g.beginPath(); g.roundRect(40, 30, 54, 40, 6); g.fill();
  T(s.mode, 67, 60, 26, '#05080C', 'center'); g.shadowBlur = 6;
  T(s.modeName.toUpperCase(), 108, 58, 20, '#fff', 'left', 600);
  const bars = Math.round(s.signal * 5); for (let i = 0; i < 5; i++) { g.fillStyle = i < bars ? '#fff' : 'rgba(255,255,255,.25)'; g.fillRect(260 + i * 10, 62 - i * 6 - 8, 6, i * 6 + 8); }
  T('GPS 18', 330, 60, 20, '#fff', 'left', 600);
  T(`WIND ${s.wind.toFixed(1)}`, 440, 60, 20, s.wind > 8 ? '#FFB020' : '#fff', 'left', 600);
  T(`${s.drone} · ${s.input}`, 40, 100, 18, 'rgba(255,255,255,.75)', 'left', 500);

  // top-right clock (every screen shows real time/date)
  const now = new Date();
  T(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), w - 40, 62, 30, '#fff', 'right');
  T(now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }), w - 40, 92, 18, 'rgba(255,255,255,.8)', 'right', 500);

  // bottom-left battery + time
  const bc = s.battery > 0.3 ? '#5BE38C' : s.battery > 0.15 ? '#FFB020' : '#FF5A4E';
  T('BATTERY', 40, h - 112, 20, 'rgba(255,255,255,.8)', 'left', 500);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(40, h - 96, 160, 26); g.fillStyle = '#fff'; g.fillRect(200, h - 89, 6, 12);
  g.fillStyle = bc; g.fillRect(44, h - 92, 152 * s.battery, 18);
  T(`${Math.round(s.battery * 100)}%`, 220, h - 74, 30, bc);
  if (s.voltage !== undefined) T(`${s.voltage.toFixed(1)} V · ${(s.cellV ?? 0).toFixed(2)} V/cell`, 290, h - 74, 20, (s.cellV ?? 4) < 3.5 ? '#FFB020' : 'rgba(255,255,255,.85)', 'left', 600);
  if (s.fps) T(`${Math.round(s.fps)} FPS`, w - 40, 124, 18, s.fps < 60 ? '#FFB020' : '#5BE38C', 'right', 600);
  T(`FLIGHT ${fmt(s.flightTime)}`, 40, h - 36, 22, '#fff', 'left', 600);
  T(`CAM ${s.camTilt >= 0 ? '+' : ''}${Math.round(s.camTilt)}°`, 250, h - 36, 22, 'rgba(255,255,255,.8)', 'left', 600);

  // warnings + banner
  s.warnings.forEach((wn, i) => {
    g.shadowBlur = 0; g.font = `700 24px ${MONO}`; const tw = g.measureText(wn).width + 40;
    g.fillStyle = wn === 'LOW BATTERY' || wn === 'CRASHED' ? 'rgba(255,90,78,.9)' : 'rgba(255,176,32,.92)';
    g.beginPath(); g.roundRect(cx - tw / 2, 150 + i * 48, tw, 38, 8); g.fill(); T(wn, cx, 178 + i * 48, 24, '#05080C', 'center');
  });
  g.shadowBlur = 6;
  if (s.banner) {
    g.shadowBlur = 0; g.fillStyle = 'rgba(4,8,12,.72)'; g.font = `600 28px ${SANS}`; const tw = Math.max(520, g.measureText(s.banner).width + 60);
    g.beginPath(); g.roundRect(cx - tw / 2, h - 170, tw, 64, 12); g.fill(); g.strokeStyle = 'rgba(63,208,255,.6)'; g.lineWidth = 2; g.stroke();
    T(s.banner, cx, h - 128, 28, '#fff', 'center', 600, SANS);
  }
  if (s.extras) drawExtras(g, w, h, s.extras, 40, 132);
  g.restore();
}

/** Mission objective box, target pointer, camera flash and results card. Coordinates in 1080p design units. */
function drawExtras(g: CanvasRenderingContext2D, w: number, h: number, e: Extras, ox: number, oy: number) {
  const T = (t: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight = 700, font = MONO) => { g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
  g.save(); g.shadowBlur = 0;
  if (e.objective && !e.result) {
    const o = e.objective; g.font = `600 22px ${SANS}`; const bw = Math.max(320, g.measureText(o.detail).width + 40);
    g.fillStyle = 'rgba(4,8,12,.62)'; g.beginPath(); g.roundRect(ox, oy, bw, o.progress !== undefined ? 92 : 78, 10); g.fill();
    g.fillStyle = '#FFB020'; g.fillRect(ox, oy + 10, 4, 58);
    T(o.title, ox + 18, oy + 34, 22, '#FFB020'); T(o.detail, ox + 18, oy + 64, 22, '#fff', 'left', 600, SANS);
    if (o.progress !== undefined) { g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(ox + 18, oy + 76, bw - 36, 6); g.fillStyle = '#3FD0FF'; g.fillRect(ox + 18, oy + 76, (bw - 36) * Math.min(1, Math.max(0, o.progress)), 6); }
  }
  if (e.target && !e.result) {
    const t = e.target, x = t.x * w, y = t.y * h;
    g.strokeStyle = '#FFB020'; g.lineWidth = 3; g.fillStyle = '#FFB020';
    if (t.on) { g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 18, y); g.lineTo(x, y + 18); g.lineTo(x - 18, y); g.closePath(); g.stroke(); T(`${Math.round(t.dist)} m`, x, y + 44, 20, '#FFB020', 'center'); }
    else { const ex = Math.min(w - 70, Math.max(70, x)), ey = Math.min(h - 70, Math.max(150, y)), a = Math.atan2(y - h / 2, x - w / 2); g.save(); g.translate(ex, ey); g.rotate(a); g.beginPath(); g.moveTo(22, 0); g.lineTo(-12, -15); g.lineTo(-12, 15); g.fill(); g.restore(); }
  }
  if (e.flash) { g.fillStyle = `rgba(255,255,255,${0.7 * e.flash})`; g.fillRect(0, 0, w, h); }
  if (e.result) drawResult(g, w, h, e.result, e.resultKey ?? 'Enter');
  g.restore();
}

function drawResult(g: CanvasRenderingContext2D, w: number, h: number, r: Result, key: string) {
  const T = (t: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight = 700, font = MONO) => { g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
  g.fillStyle = 'rgba(2,4,6,.55)'; g.fillRect(0, 0, w, h);
  const cw = 760, ch = 220 + r.rows.length * 48, x = (w - cw) / 2, y = (h - ch) / 2;
  g.fillStyle = 'rgba(8,16,24,.96)'; g.beginPath(); g.roundRect(x, y, cw, ch, 20); g.fill();
  g.strokeStyle = r.success ? 'rgba(91,227,140,.7)' : 'rgba(255,90,78,.7)'; g.lineWidth = 3; g.stroke();
  T(r.success ? 'MISSION COMPLETE' : 'MISSION OVER', x + 40, y + 52, 20, r.success ? '#5BE38C' : '#FF7A70');
  T(r.title, x + 40, y + 104, 44, '#fff', 'left', 700, SANS);
  if (r.success) { T(r.newBest ? 'NEW BEST' : r.best !== null ? `best ${r.best}` : '', x + cw - 40, y + 52, 20, r.newBest ? '#FFB020' : '#8FA3B5', 'right'); }
  r.rows.forEach(([k, v], i) => { const yy = y + 160 + i * 48; T(k, x + 40, yy, 24, '#8FA3B5', 'left', 500, SANS); T(v, x + cw - 40, yy, 26, '#fff', 'right'); });
  T(`Press ${key} to return to the cockpit`, w / 2, y + ch - 28, 22, '#FFB020', 'center', 600);
}

export interface LosState {
  visible: boolean; reason: string | null; lostFor: number; dist: number; alt: number; hs: number; battery: number;
  marker: { x: number; y: number; on: boolean } | null; pip: { x: number; y: number; w: number; h: number } | null;
  mode: string; warnings: string[]; banner: string | null; range: number;
  extras?: Extras;
}

/** Line-of-sight overlay (PC): sight status, drone marker, frame around the remote's screen. */
export function drawLosHud(g: CanvasRenderingContext2D, W: number, H: number, s: LosState) {
  const u = H / 1080; g.clearRect(0, 0, W, H); g.save(); g.scale(u, u);
  const w = W / u, h = 1080, cx = w / 2;
  const T = (t: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight = 700, font = MONO) => { g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
  g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 6;

  // sight status pill + meter (how close to the edge of visual range)
  const ok = s.visible, label = ok ? `DRONE IN SIGHT · ${Math.round(s.dist)} m` : `LINE OF SIGHT LOST · ${s.reason}`;
  g.shadowBlur = 0; g.font = `700 26px ${MONO}`; const tw = g.measureText(label).width + 48;
  g.fillStyle = ok ? 'rgba(91,227,140,.92)' : 'rgba(255,90,78,.94)'; g.beginPath(); g.roundRect(cx - tw / 2, 28, tw, 46, 10); g.fill();
  T(label, cx, 61, 26, '#05080C', 'center');
  const frac = Math.min(1, s.dist / s.range);
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect(cx - 220, 86, 440, 8, 4); g.fill();
  g.fillStyle = frac > 0.8 ? '#FFB020' : ok ? '#5BE38C' : '#FF5A4E'; g.beginPath(); g.roundRect(cx - 220, 86, 440 * frac, 8, 4); g.fill();
  T(`visual range ${s.range} m`, cx + 220, 116, 16, 'rgba(255,255,255,.8)', 'right', 500);
  if (!ok) T(`${s.lostFor.toFixed(1)} s`, cx - 220, 116, 16, '#FF8A80', 'left', 600);
  g.shadowBlur = 6;

  // drone marker
  if (s.marker) {
    const { x, y, on } = s.marker, mx = x / u, my = y / u;
    g.strokeStyle = ok ? 'rgba(91,227,140,.95)' : 'rgba(255,90,78,.95)'; g.lineWidth = 2.5;
    if (on) { g.beginPath(); g.arc(mx, my, 26, 0, Math.PI * 2); g.stroke(); T(`${Math.round(s.dist)} m · ${Math.round(s.alt)} m up`, mx + 34, my + 6, 18, '#fff', 'left', 600); }
    else { // off-screen: arrow at the edge
      const ex = Math.min(w - 60, Math.max(60, mx)), ey = Math.min(h - 60, Math.max(140, my)), a = Math.atan2(my - h / 2, mx - w / 2);
      g.save(); g.translate(ex, ey); g.rotate(a); g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(18, 0); g.lineTo(-12, -12); g.lineTo(-12, 12); g.fill(); g.restore();
    }
  }

  // remote screen frame + telemetry
  if (s.pip) {
    const p = { x: s.pip.x / u, y: s.pip.y / u, w: s.pip.w / u, h: s.pip.h / u };
    g.shadowBlur = 0; g.strokeStyle = '#0E1013'; g.lineWidth = 14; g.beginPath(); g.roundRect(p.x - 7, p.y - 7, p.w + 14, p.h + 14, 14); g.stroke();
    g.strokeStyle = 'rgba(63,208,255,.5)'; g.lineWidth = 2; g.beginPath(); g.roundRect(p.x - 14, p.y - 14, p.w + 28, p.h + 28, 18); g.stroke();
    g.shadowBlur = 6;
    T(s.mode, p.x + 10, p.y + 28, 20, '#FFB020'); T(`ALT ${s.alt.toFixed(0)} m`, p.x + 10, p.y + p.h - 12, 18);
    T(`${s.hs.toFixed(1)} m/s`, p.x + p.w / 2, p.y + p.h - 12, 18, '#fff', 'center'); T(`${Math.round(s.battery * 100)} %`, p.x + p.w - 10, p.y + p.h - 12, 18, s.battery > 0.3 ? '#5BE38C' : '#FF5A4E', 'right');
  }

  const now = new Date();
  T(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), w - 40, 62, 30, '#fff', 'right');
  T(now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }), w - 40, 92, 18, 'rgba(255,255,255,.85)', 'right', 500);
  s.warnings.forEach((wn, i) => { g.shadowBlur = 0; g.font = `700 22px ${MONO}`; const ww = g.measureText(wn).width + 36; g.fillStyle = 'rgba(255,176,32,.92)'; g.beginPath(); g.roundRect(40, 40 + i * 44, ww, 36, 8); g.fill(); T(wn, 58, 66 + i * 44, 22, '#05080C'); });
  if (s.banner) { g.shadowBlur = 0; g.fillStyle = 'rgba(4,8,12,.75)'; g.font = `600 26px ${SANS}`; const bw = g.measureText(s.banner).width + 60; g.beginPath(); g.roundRect(cx - bw / 2, 140, bw, 58, 12); g.fill(); T(s.banner, cx, 178, 26, '#fff', 'center', 600, SANS); }
  if (s.extras) drawExtras(g, w, h, s.extras, 40, 40 + s.warnings.length * 44 + 8);
  g.restore();
}
