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

  const CYAN = '#38e8ff', PINK = '#ff4fd8', ORANGE = '#ffa43a', LIME = '#9dff4f';

  const MAPS = {
    portals: {
      id: 'portals', name: 'Portal Park', icon: '🌀', ground: '#16212e', accent: CYAN,
      desc: 'Hop between linked portals and zip across the map on boost lanes.',
      portals: [
        { id: 'a1', x: 9.5, y: 9.5, to: 'a2', color: CYAN }, { id: 'a2', x: 54.5, y: 54.5, to: 'a1', color: CYAN },
        { id: 'b1', x: 54.5, y: 9.5, to: 'b2', color: PINK }, { id: 'b2', x: 9.5, y: 54.5, to: 'b1', color: PINK },
        { id: 'c1', x: 32, y: 19.5, to: 'c2', color: ORANGE }, { id: 'c2', x: 32, y: 44.5, to: 'c1', color: ORANGE },
      ],
      vortexes: [],
      zones: [
        { type: 'speed', x: 20, y: 31, w: 24, h: 2, dir: 'x+' },
        { type: 'speed', x: 31, y: 4, w: 2, h: 10, dir: 'y+' },
        { type: 'speed', x: 31, y: 50, w: 2, h: 10, dir: 'y-' },
      ],
    },
    vortex: {
      id: 'vortex', name: 'Vortex Valley', icon: '🌪️', ground: '#142620', accent: '#b07bff',
      desc: 'Giant whirlpools drag you in. Use the boost lanes to escape.',
      portals: [],
      vortexes: [
        { x: 32, y: 32, r: 9, pull: 5.5 },
        { x: 13, y: 15, r: 6, pull: 4.5 },
        { x: 51, y: 49, r: 6, pull: 4.5 },
      ],
      zones: [
        { type: 'slow', x: 38, y: 6, w: 14, h: 8 },
        { type: 'slow', x: 12, y: 50, w: 14, h: 8 },
        { type: 'speed', x: 44, y: 30, w: 16, h: 4, dir: 'x+' },
        { type: 'speed', x: 4, y: 30, w: 16, h: 4, dir: 'x-' },
      ],
    },
    chaos: {
      id: 'chaos', name: 'Chaos Circuit', icon: '🏁', ground: '#251a2e', accent: PINK,
      desc: 'A racetrack of boost lanes, mud pits, a vortex and wrap-around portals.',
      portals: [
        { id: 'a1', x: 3.5, y: 32, to: 'a2', color: PINK }, { id: 'a2', x: 60.5, y: 32, to: 'a1', color: PINK },
        { id: 'b1', x: 32, y: 3.5, to: 'b2', color: CYAN }, { id: 'b2', x: 32, y: 60.5, to: 'b1', color: CYAN },
      ],
      vortexes: [{ x: 32, y: 32, r: 7, pull: 4.5 }],
      zones: [
        { type: 'speed', x: 12, y: 11, w: 40, h: 2, dir: 'x+' },
        { type: 'speed', x: 50, y: 13, w: 2, h: 38, dir: 'y+' },
        { type: 'speed', x: 12, y: 51, w: 40, h: 2, dir: 'x-' },
        { type: 'speed', x: 12, y: 13, w: 2, h: 38, dir: 'y-' },
        { type: 'slow', x: 18, y: 18, w: 8, h: 8 }, { type: 'slow', x: 38, y: 18, w: 8, h: 8 },
        { type: 'slow', x: 18, y: 38, w: 8, h: 8 }, { type: 'slow', x: 38, y: 38, w: 8, h: 8 },
      ],
    },
  };
  const MAP_IDS = Object.keys(MAPS);

  const inRect = (z, x, y) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
  function zoneMult(map, x, y) {
    let m = 1;
    for (const z of map.zones) if (inRect(z, x, y)) m *= z.type === 'speed' ? SPEED_ZONE : SLOW_ZONE;
    return m;
  }
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
      return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  }

  // Advance one player by dt seconds. p = { x, y, kx, ky, tpUntil }. Returns events: { tp:{from,to} } / { fling: vortex }
  function step(map, p, dt, dx, dy, speed, now) {
    const ev = [];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const eff = Math.min(MAX_SPEED, speed * zoneMult(map, p.x, p.y));
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

  return { W, H, MAPS, MAP_IDS, SPEED_ZONE, SLOW_ZONE, FLING, PORTAL_COOLDOWN, zoneMult, zonesAt, vortexAt, safeSpot, step };
});
