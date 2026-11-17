// ======================= Shared by server AND browser: maps + movement physics =======================
// Keeping one copy of the physics means the client can predict movement exactly (no rubber-banding).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(this, function () {
  const W = 64, H = 64;
  const SPEED_ZONE = 1.6;       // speed multiplier on a boost lane
  const SLOW_ZONE = 0.5;        // speed multiplier in mud
  const MAX_SPEED = 17;         // hard cap so nobody skips through tiles
  const PORTAL_COOLDOWN = 1500; // ms before a portal can be used again by the same player
  const PORTAL_RADIUS = 0.9;
  const FLING = 15;             // tiles/sec shove when a vortex spits you out

  const CYAN = '#38e8ff', PINK = '#ff4fd8', ORANGE = '#ffa43a'; // (kept for portal maps)

  // Each map has exactly ONE hazard: whirlpools, mud, or boost lanes. (Portals still work in the code if you want a map with them.)
  // theme = how it looks (see themes.js). Mud zones can be ovals (shape: 'ellipse', x/y/w/h = the oval's bounding box).
  const MAPS = {
    ocean: {
      id: 'ocean', theme: 'ocean', name: 'Whirlpool Reef', icon: '🌊', ground: '#1d6f8c', accent: '#7fe3ff', tag: '🌊 Giant whirlpools',
      desc: 'A coral reef with giant whirlpools. They drag you in and spit you out.',
      portals: [],
      vortexes: [
        { x: 32, y: 32, r: 9.5, pull: 5.5 },
        { x: 13, y: 16, r: 6.5, pull: 4.5 },
        { x: 51, y: 49, r: 6.5, pull: 4.5 },
        { x: 50, y: 13, r: 5, pull: 4 },
      ],
      zones: [],
    },
    swamp: {
      id: 'swamp', theme: 'swamp', name: 'Misty Bog', icon: '🐸', ground: '#36532c', accent: '#ffd966', tag: '🟤 Sticky mud ponds',
      desc: 'A foggy bog full of mud ponds that halve your speed. Go around or wade through.',
      portals: [], vortexes: [],
      zones: [
        { type: 'slow', shape: 'ellipse', x: 8, y: 26, w: 20, h: 14 },
        { type: 'slow', shape: 'ellipse', x: 38, y: 8, w: 18, h: 12 },
        { type: 'slow', shape: 'ellipse', x: 36, y: 40, w: 20, h: 14 },
        { type: 'slow', shape: 'ellipse', x: 6, y: 6, w: 10, h: 8 },
        { type: 'slow', shape: 'ellipse', x: 24, y: 52, w: 12, h: 8 },
        { type: 'slow', shape: 'ellipse', x: 46, y: 26, w: 10, h: 8 },
      ],
    },
    canyon: {
      id: 'canyon', theme: 'canyon', name: 'Canyon Dash', icon: '🏜️', ground: '#c9a56a', accent: '#ffd23f', tag: '⚡ Boost lanes',
      desc: 'A desert racetrack of boost lanes. Run WITH the arrows, never against them.',
      portals: [], vortexes: [],
      zones: [
        { type: 'speed', x: 12, y: 11, w: 40, h: 2, dir: 'x+' },
        { type: 'speed', x: 50, y: 13, w: 2, h: 38, dir: 'y+' },
        { type: 'speed', x: 12, y: 51, w: 40, h: 2, dir: 'x-' },
        { type: 'speed', x: 12, y: 13, w: 2, h: 38, dir: 'y-' },
        { type: 'speed', x: 31, y: 19, w: 2, h: 8, dir: 'y-' },
        { type: 'speed', x: 31, y: 37, w: 2, h: 8, dir: 'y+' },
        { type: 'speed', x: 19, y: 31, w: 8, h: 2, dir: 'x-' },
        { type: 'speed', x: 37, y: 31, w: 8, h: 2, dir: 'x+' },
      ],
    },
  };
  const MAP_IDS = Object.keys(MAPS);

  const inRect = (z, x, y) => {
    if (z.shape === 'ellipse') { const rx = z.w / 2, ry = z.h / 2, dx = (x - z.x - rx) / rx, dy = (y - z.y - ry) / ry; return dx * dx + dy * dy < 1; }
    return x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
  };
  const LANE_VEC = { 'x+': [1, 0], 'x-': [-1, 0], 'y+': [0, 1], 'y-': [0, -1] };
  // A boost lane only helps when you run WITH it: full boost going along it, half speed going against it,
  // normal speed when crossing it sideways (smoothly blended for diagonals). ux,uy = your unit direction.
  function laneMult(z, ux, uy) {
    if (ux === undefined) return 1;
    const v = LANE_VEC[z.dir] || [0, 0], dot = ux * v[0] + uy * v[1];
    return dot >= 0 ? 1 + (SPEED_ZONE - 1) * dot : 1 + (1 - SLOW_ZONE) * dot;
  }
  function zoneMult(map, x, y, ux, uy) {
    let m = 1;
    for (const z of map.zones) if (inRect(z, x, y)) m *= z.type === 'speed' ? laneMult(z, ux, uy) : SLOW_ZONE;
    return m;
  }
  const laneAt = (map, x, y) => map.zones.find(z => z.type === 'speed' && inRect(z, x, y)) || null;
  // Tiles under a boost lane can never be claimed
  const isLaneTile = (map, tx, ty) => map.zones.some(z => z.type === 'speed' && inRect(z, tx + 0.5, ty + 0.5));
  function zonesAt(map, x, y) { return map.zones.filter(z => inRect(z, x, y)).map(z => z.type); }
  function vortexAt(map, x, y) { return map.vortexes.find(v => Math.hypot(v.x - x, v.y - y) < v.r) || null; }

  // A random spot that isn't inside a vortex, mud, or on top of a portal
  function safeSpot(map, rnd) {
    rnd = rnd || Math.random;
    for (let i = 0; i < 80; i++) {
      const x = 6 + rnd() * (W - 12), y = 6 + rnd() * (H - 12);
      if (map.vortexes.some(v => Math.hypot(v.x - x, v.y - y) < v.r + 2)) continue;
      if (map.portals.some(p => Math.hypot(p.x - x, p.y - y) < 4)) continue;
      if (map.zones.some(z => z.type === 'slow' && inRect(z, x, y))) continue;
      if (map.zones.some(z => z.type === 'speed' && inRect({ x: z.x - 2, y: z.y - 2, w: z.w + 4, h: z.h + 4 }, x, y))) continue; // keep the spawn patch off the lanes
      return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  }

  // Advance one player by dt seconds. p = { x, y, kx, ky, tpUntil }. Returns events: { tp:{from,to} } / { fling: vortex }
  function step(map, p, dt, dx, dy, speed, now) {
    const ev = [];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const eff = Math.min(MAX_SPEED, speed * zoneMult(map, p.x, p.y, dx / len, dy / len));
      p.x += dx / len * eff * dt; p.y += dy / len * eff * dt;
    }
    for (const v of map.vortexes) { // pull toward the center, stronger near the middle
      const ddx = v.x - p.x, ddy = v.y - p.y, d = Math.hypot(ddx, ddy);
      if (d < v.r && d > 1e-6) {
        const mv = Math.min(v.pull * (0.35 + 0.65 * (1 - d / v.r)) * dt, d);
        p.x += ddx / d * mv; p.y += ddy / d * mv;
        if (d < 0.7) ev.push({ fling: v });
      }
    }
    if (p.kx || p.ky) { // knockback from a vortex spit-out, fades quickly
      p.x += p.kx * dt; p.y += p.ky * dt;
      const k = Math.exp(-5 * dt); p.kx *= k; p.ky *= k;
      if (Math.hypot(p.kx, p.ky) < 0.2) p.kx = p.ky = 0;
    }
    p.x = Math.max(0.5, Math.min(W - 0.5, p.x)); p.y = Math.max(0.5, Math.min(H - 0.5, p.y));
    if (now >= (p.tpUntil || 0)) {
      for (const po of map.portals) {
        if (Math.hypot(p.x - po.x, p.y - po.y) < PORTAL_RADIUS) {
          const dest = map.portals.find(q => q.id === po.to);
          p.x = dest.x; p.y = dest.y; p.tpUntil = now + PORTAL_COOLDOWN;
          ev.push({ tp: { from: po, to: dest } });
          break;
        }
      }
    }
    return ev;
  }

  return { W, H, MAPS, MAP_IDS, SPEED_ZONE, SLOW_ZONE, FLING, PORTAL_COOLDOWN, LANE_VEC, laneMult, laneAt, isLaneTile, zoneMult, zonesAt, vortexAt, safeSpot, step };
});
