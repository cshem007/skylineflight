// One HUD renderer, drawn into a 2D canvas. On PC that canvas sits over the
// 3D view; in VR it is a texture on the goggles screen.

export interface HudState {
  hs: number; vs: number; alt: number; agl: number; home: number; heading: number;
  battery: number; flightTime: number; mode: string; modeName: string; manual: boolean;
  phase: string; roll: number; pitch: number; drone: string; input: string;
  warnings: string[]; banner: string | null; wind: number; signal: number; camTilt: number;
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
  g.restore();
}
