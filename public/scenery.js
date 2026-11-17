// ======================= Scenery: map hazards (portals, vortexes, zones) + upgrade models =======================
(function () {
  const T = THREE;
  const OUT = new T.MeshBasicMaterial({ color: 0x14161c, side: T.BackSide });
  let group = null, scene = null, fancy = [], heavy = [], lowQuality = false; const updaters = [];

  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const bas = (o) => new T.MeshBasicMaterial(Object.assign({ transparent: true, depthWrite: false }, o));
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    return new T.CanvasTexture(c);
  }
  const glowTex = color => canvasTex(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, hexA(color, 0.85)); r.addColorStop(0.45, hexA(color, 0.3)); r.addColorStop(1, hexA(color, 0));
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  // spiral arms fading out toward the edge; dark = black-hole / deep-water centre. dk = { dark, mid } optional centre colours
  const spiralTex = (color, arms, dark, dk) => canvasTex(256, 256, (g, w) => {
    g.translate(w / 2, w / 2);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    r.addColorStop(0, dark ? (dk ? dk.dark : 'rgba(4,0,12,0.95)') : hexA(color, 0.9)); r.addColorStop(0.2, dark ? (dk ? dk.mid : 'rgba(20,4,40,0.6)') : hexA(color, 0.45)); r.addColorStop(1, hexA(color, 0));
    g.fillStyle = r; g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill();
    g.lineCap = 'round';
    for (let k = 0; k < arms; k++) for (let i = 0; i < 48; i++) {
      const t0 = i / 48, t1 = (i + 1) / 48, a = t => k * 2 * Math.PI / arms + t * 3.4 * Math.PI, rr = t => 8 + t * w * 0.46;
      g.beginPath(); g.moveTo(Math.cos(a(t0)) * rr(t0), Math.sin(a(t0)) * rr(t0)); g.lineTo(Math.cos(a(t1)) * rr(t1), Math.sin(a(t1)) * rr(t1));
      g.strokeStyle = hexA(color, 0.8 * (1 - t0)); g.lineWidth = 9 * (1 - t0 * 0.6); g.stroke();
      g.strokeStyle = `rgba(255,255,255,${0.5 * (1 - t0)})`; g.lineWidth = 2; g.stroke();
    }
  });
  // boost lane chevrons. road = themed look: dark asphalt with painted yellow arrows
  const chevronTex = (color, dir, road) => canvasTex(64, 64, (g, w) => {
    g.fillStyle = road ? road.road : hexA(color, 0.16); g.fillRect(0, 0, w, w);
    g.translate(w / 2, w / 2); g.rotate({ 'x+': 0, 'y+': Math.PI / 2, 'x-': Math.PI, 'y-': -Math.PI / 2 }[dir] || 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [dx, a, lw] of [[-8, 0.4, 11], [12, 1, 9]]) {
      g.beginPath(); g.moveTo(dx - 12, -17); g.lineTo(dx + 8, 0); g.lineTo(dx - 12, 17);
      g.strokeStyle = hexA(color, a); g.lineWidth = lw; g.stroke();
    }
  });
  const mudTex = (m) => canvasTex(128, 128, (g, w) => {
    g.fillStyle = m ? m.base : 'rgba(74,34,84,0.58)'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * w, r = 4 + Math.random() * 12;
      g.fillStyle = m ? hexA(m.dark, 0.18 + Math.random() * 0.25) : `rgba(30,10,40,${0.18 + Math.random() * 0.2})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.strokeStyle = m ? hexA(m.light, 0.45) : 'rgba(200,140,230,0.4)'; g.lineWidth = 2; g.beginPath(); g.arc(x - r * 0.2, y - r * 0.2, r * 0.7, 3.4, 5.2); g.stroke();
    }
  });
  const emojiTex = e => canvasTex(128, 128, (g, w) => { g.font = '90px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, w / 2, w / 2 + 6); });
  const flat = (mesh, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };

  // ---------------- map hazards ----------------
  function makeZone(z, st) {
    const g = new T.Group(); g.position.set(z.x + z.w / 2, 0.02, z.y + z.h / 2);
    const speed = z.type === 'speed', road = st.lane, mud = st.mud, oval = z.shape === 'ellipse';
    const col = speed ? (road ? road.chevron : '#9dff4f') : '#b070d0';
    const tex = speed ? chevronTex(col, z.dir, road) : mudTex(mud);
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(speed ? Math.max(1, z.w / 2) : Math.max(1, z.w / 3), speed ? Math.max(1, z.h / 2) : Math.max(1, z.h / 3));
    if (oval) { // a natural-looking pond: a wet dark halo, the mud itself, and a lighter rim
      const rx = z.w / 2, ry = z.h / 2;
      const halo = flat(new T.Mesh(new T.CircleGeometry(1, 48), bas({ color: mud ? mud.rim : 0x000000, opacity: 0.4 })), -0.012); halo.scale.set(rx * 1.07, ry * 1.1, 1); g.add(halo);
      const body = flat(new T.Mesh(new T.CircleGeometry(1, 48), bas({ map: tex, opacity: 0.97 })), 0); body.scale.set(rx, ry, 1); g.add(body);
      const rim = flat(new T.Mesh(new T.RingGeometry(0.96, 1, 48), bas({ color: mud ? mud.edge : 0xffffff, opacity: 0.55, side: T.DoubleSide })), 0.01); rim.scale.set(rx, ry, 1); g.add(rim);
    } else {
      g.add(flat(new T.Mesh(new T.PlaneGeometry(z.w, z.h), bas({ map: tex })), 0));
      const edge = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(z.w, z.h)), new T.LineBasicMaterial({ color: road ? road.edge : col, transparent: true, opacity: 0.8 }));
      g.add(flat(edge, 0.01));
    }
    const icon = (!road && !mud) ? flat(new T.Mesh(new T.PlaneGeometry(2.2, 2.2), bas({ map: emojiTex(speed ? '⚡' : '🐌'), opacity: 0.6 })), 0.015) : null; if (icon) g.add(icon);
    const mv = { 'x+': [-1, 0], 'x-': [1, 0], 'y+': [0, 1], 'y-': [0, -1] }[z.dir] || [0, 0];
    updaters.push((dt, now) => {
      if (speed) { tex.offset.x += mv[0] * dt * 0.9; tex.offset.y += mv[1] * dt * 0.9; } // chevrons stream along the lane
      else { tex.offset.x += dt * 0.05; tex.offset.y -= dt * 0.035; }                   // mud slowly churns
      if (icon) icon.material.opacity = 0.45 + Math.sin(now / 500) * 0.12;
    });
    return g;
  }
  function makeVortex(v, color, st) {
    const vs = st.vortex, g = new T.Group(); g.position.set(v.x, 0.04, v.y);
    const spiral = flat(new T.Mesh(new T.CircleGeometry(v.r, 72), bas({ map: spiralTex(vs ? vs.glow : '#b07bff', 4, true, vs) })), 0); g.add(spiral);
    if (vs) { const fa = flat(new T.Mesh(new T.CircleGeometry(v.r, 72), bas({ map: spiralTex(vs.arm, 3, false), blending: T.AdditiveBlending, opacity: 0.55 })), 0.005); g.add(fa); spiral.userData.foam = fa; }
    g.add(flat(new T.Mesh(new T.RingGeometry(v.r - 0.1, v.r, 72), bas({ color: vs ? vs.boundary : 0xb07bff, opacity: vs ? 0.55 : 0.4, side: T.DoubleSide })), 0.01));
    const rings = [0, 1, 2].map(() => { const r = flat(new T.Mesh(new T.RingGeometry(0.96, 1, 64), bas({ color: vs ? vs.ring : 0xe6d4ff, side: T.DoubleSide })), 0.02); g.add(r); return r; });
    updaters.push((dt, now) => {
      spiral.rotation.z -= dt * 1.4; if (spiral.userData.foam) spiral.userData.foam.rotation.z -= dt * 1.9;
      rings.forEach((r, i) => { const f = ((now / 1700) + i / 3) % 1, s = v.r * (1 - f) + 0.6; r.scale.set(s, s, s); r.material.opacity = 0.65 * Math.sin(f * Math.PI); }); // rings drain inward
    });
    return g;
  }
  function makePortal(p, lean) {
    const g = new T.Group(); g.position.set(p.x, 0, p.y);
    const glow = flat(new T.Mesh(new T.CircleGeometry(2.3, 32), bas({ map: glowTex(p.color), blending: T.AdditiveBlending })), 0.03); g.add(glow);
    const tilt = new T.Group(); tilt.rotation.x = -lean; g.add(tilt);
    const ring = new T.Mesh(new T.TorusGeometry(1.0, 0.12, 12, 48), new T.MeshBasicMaterial({ color: p.color })); ring.position.y = 1.2; tilt.add(ring);
    const ring2 = new T.Mesh(new T.TorusGeometry(1.0, 0.035, 8, 48), new T.MeshBasicMaterial({ color: 0xffffff })); ring2.position.set(0, 1.2, 0.0); ring2.scale.set(1.2, 1.2, 1); tilt.add(ring2);
    const back = new T.Mesh(new T.CircleGeometry(0.98, 40), bas({ color: 0x000000, opacity: 0.55, side: T.DoubleSide })); back.position.set(0, 1.2, -0.02); tilt.add(back);
    const swirl = new T.Mesh(new T.CircleGeometry(0.98, 40), bas({ map: spiralTex(p.color, 3, false), blending: T.AdditiveBlending, side: T.DoubleSide })); swirl.position.set(0, 1.2, 0.02); tilt.add(swirl);
    const bits = [0, 1, 2, 3, 4].map(() => { const m = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff })); tilt.add(m); return m; });
    updaters.push((dt, now) => {
      swirl.rotation.z += dt * 2.6;
      const s = 1 + Math.sin(now / 350 + p.x) * 0.04; ring.scale.set(s, s, 1); glow.scale.setScalar(1 + Math.sin(now / 420 + p.y) * 0.1);
      bits.forEach((b, i) => { const a = now / 600 + i * 1.2566, r = 1.0 + Math.sin(now / 300 + i) * 0.1; b.position.set(Math.cos(a) * r, 1.2 + Math.sin(a) * r, 0.05); });
    });
    return g;
  }

  function buildMap(sc, map, lean) {
    clearMap(); scene = sc; group = new T.Group();
    const st = Themes.style(map);
    map.zones.forEach(z => group.add(makeZone(z, st)));
    map.vortexes.forEach(v => group.add(makeVortex(v, map.accent, st)));
    map.portals.forEach(p => group.add(makePortal(p, lean)));
    const th = Themes.build(map, lean); group.add(th.group); updaters.push(th.update); sc.background = new T.Color(th.bg);
    fancy = th.fancy || []; heavy = th.heavy || []; heavy.forEach(b => { b.full = b.mesh.count; }); applyQuality();
    scene.add(group);
  }
  function clearMap() {
    updaters.length = 0;
    if (!group) return;
    scene.remove(group);
    group.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    group = null; fancy = []; heavy = [];
  }
  const updateMap = (dt, now) => updaters.forEach(f => f(dt, now));

  // ---------------- map preview (used by the vote cards) ----------------
  function drawPreview(canvas, map) {
    const g = canvas.getContext('2d'), s = canvas.width / 64, st = Themes.style(map);
    g.fillStyle = map.ground; g.fillRect(0, 0, canvas.width, canvas.height);
    // a little of the theme's scenery as dots, so each card feels different
    let seed = map.id.length * 977; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const dots = { ocean: ['#ff7aa8', '#ff9a4d', '#b983ff', '#7d8fa3'], swamp: ['#2f6a35', '#3f8a45', '#d9382f', '#ffd23f'], canyon: ['#b5532c', '#4f8a45', '#8a9360', '#a8472a'] }[map.theme] || [];
    for (let i = 0; i < 70; i++) { const x = rnd() * 64, y = rnd() * 64; g.fillStyle = dots[Math.floor(rnd() * dots.length)] || '#fff'; g.globalAlpha = 0.5; g.beginPath(); g.arc(x * s, y * s, (0.5 + rnd() * 0.9) * s, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    for (const z of map.zones) {
      if (z.type === 'speed') { g.fillStyle = st.lane ? 'rgba(46,38,34,0.9)' : 'rgba(157,255,79,0.65)'; g.fillRect(z.x * s, z.y * s, z.w * s, z.h * s);
        if (st.lane) { g.strokeStyle = st.lane.chevron; g.lineWidth = Math.max(1, s * 0.5); g.setLineDash([s * 1.5, s * 1.2]); g.beginPath(); const hz = z.w > z.h; g.moveTo((z.x + (hz ? 0 : z.w / 2)) * s, (z.y + (hz ? z.h / 2 : 0)) * s); g.lineTo((z.x + (hz ? z.w : z.w / 2)) * s, (z.y + (hz ? z.h / 2 : z.h)) * s); g.stroke(); g.setLineDash([]); } }
      else { g.fillStyle = st.mud ? st.mud.base : 'rgba(176,112,208,0.65)'; g.strokeStyle = st.mud ? st.mud.edge : 'rgba(0,0,0,0)';
        if (z.shape === 'ellipse') { g.beginPath(); g.ellipse((z.x + z.w / 2) * s, (z.y + z.h / 2) * s, z.w / 2 * s, z.h / 2 * s, 0, 0, 7); g.fill(); g.lineWidth = 1; g.stroke(); } else g.fillRect(z.x * s, z.y * s, z.w * s, z.h * s); }
    }
    for (const v of map.vortexes) {
      const r = g.createRadialGradient(v.x * s, v.y * s, 0, v.x * s, v.y * s, v.r * s), vs = st.vortex;
      r.addColorStop(0, vs ? 'rgba(2,24,52,0.98)' : 'rgba(0,0,0,0.95)'); r.addColorStop(0.5, vs ? 'rgba(90,200,240,0.7)' : 'rgba(120,60,200,0.65)'); r.addColorStop(1, vs ? 'rgba(230,255,255,0.35)' : 'rgba(176,123,255,0.1)');
      g.fillStyle = r; g.beginPath(); g.arc(v.x * s, v.y * s, v.r * s, 0, 7); g.fill();
      if (vs) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = Math.max(1, s * 0.4); for (let k = 0; k < 3; k++) { g.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24, a = k * 2.09 + t * 5, rr = v.r * s * (0.15 + t * 0.8); const x = v.x * s + Math.cos(a) * rr, y = v.y * s + Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } }
    }
    for (const p of map.portals) {
      g.fillStyle = p.color; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x * s, p.y * s, 3.2 * s / 1.6, 0, 7); g.fill(); g.stroke();
    }
  }

  // ---------------- upgrade (pickup) models ----------------
  function labelSprite(text) {
    const c = document.createElement('canvas'), x = c.getContext('2d'); x.font = '600 30px system-ui,sans-serif';
    c.width = Math.ceil(x.measureText(text).width) + 20; c.height = 48;
    x.font = '600 30px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(text, c.width / 2, 26); x.fillStyle = '#fff'; x.fillText(text, c.width / 2, 26);
    const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false }));
    s.userData = { w: c.width, h: c.height, k: 0.5 }; s.renderOrder = 10; return s;
  }
  const L = (c, o) => new T.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  const withOutline = (geo, mat, grow) => { const m = new T.Mesh(geo, mat); const o = new T.Mesh(geo, OUT); o.scale.setScalar(grow || 1.08); m.add(o); return m; };

  const MODELS = {
    rapid() { // lightning bolt
      const sh = new T.Shape(), P = [[-0.1, 1], [0.45, 1], [0.12, 0.2], [0.5, 0.2], [-0.25, -1], [-0.02, -0.15], [-0.4, -0.15]];
      P.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
      const geo = new T.ExtrudeGeometry(sh, { depth: 0.26, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }); geo.center();
      const g = new T.Group(); g.add(withOutline(geo, L(0xffd23f, { emissive: 0xd69a00, emissiveIntensity: 0.9 }), 1.1)); g.scale.setScalar(0.72); return { g };
    },
    boom() { // bomb with a sparking fuse
      const g = new T.Group();
      g.add(withOutline(new T.SphereGeometry(0.46, 20, 14), L(0x2b2d38), 1.07));
      const band = new T.Mesh(new T.TorusGeometry(0.47, 0.06, 8, 28), L(0xff4a2a, { emissive: 0xff2200, emissiveIntensity: 0.9 })); band.rotation.x = Math.PI / 2; g.add(band);
      const cap = new T.Mesh(new T.CylinderGeometry(0.13, 0.16, 0.16, 12), L(0x8c93a3)); cap.position.y = 0.5; g.add(cap);
      const fuse = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.3, 6), L(0xc9a46a)); fuse.position.set(0.08, 0.7, 0); fuse.rotation.z = -0.5; g.add(fuse);
      const spark = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), new T.MeshBasicMaterial({ color: 0xffd23f })); spark.position.set(0.2, 0.84, 0); g.add(spark);
      const hl = new T.Mesh(new T.SphereGeometry(0.08, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff })); hl.position.set(-0.17, 0.2, 0.36); g.add(hl);
      g.scale.setScalar(0.95); return { g, anim: (now) => { const s = 0.8 + Math.abs(Math.sin(now / 70)) * 0.7; spark.scale.setScalar(s); } };
    },
    breaker() { // hammer
      const g = new T.Group();
      const handle = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 1.25, 10), L(0x8a5a2b)); g.add(handle);
      const head = withOutline(new T.BoxGeometry(0.9, 0.44, 0.44), L(0xb06bff, { emissive: 0x5a2ca8, emissiveIntensity: 0.5 }), 1.08); head.position.y = 0.55; g.add(head);
      for (const s of [-1, 1]) { const cap = new T.Mesh(new T.BoxGeometry(0.12, 0.52, 0.52), L(0x5b3a9c)); cap.position.set(0.46 * s, 0.55, 0); g.add(cap); }
      g.rotation.z = 0.5; const w = new T.Group(); w.add(g); w.scale.setScalar(0.82); return { g: w };
    },
    haste() { // rocket
      const g = new T.Group();
      g.add(withOutline(new T.CylinderGeometry(0.22, 0.22, 0.8, 14), L(0xf2f6ff), 1.1));
      const nose = new T.Mesh(new T.ConeGeometry(0.22, 0.38, 14), L(0xff4a5a)); nose.position.y = 0.59; g.add(nose);
      const win = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), new T.MeshBasicMaterial({ color: 0x3fe0ff })); win.position.set(0, 0.12, 0.2); g.add(win);
      for (let i = 0; i < 3; i++) { const f = new T.Mesh(new T.BoxGeometry(0.05, 0.3, 0.28), L(0xff4a5a)); const a = i * 2.094; f.position.set(Math.sin(a) * 0.27, -0.32, Math.cos(a) * 0.27); f.rotation.y = a; g.add(f); }
      const flame = new T.Mesh(new T.ConeGeometry(0.15, 0.5, 10), new T.MeshBasicMaterial({ color: 0xffa43a })); flame.rotation.x = Math.PI; flame.position.y = -0.62; g.add(flame);
      g.rotation.z = -0.55; const w = new T.Group(); w.add(g); w.scale.setScalar(0.9);
      return { g: w, anim: (now) => { flame.scale.set(1, 0.8 + Math.sin(now / 55) * 0.35, 1); } };
    },
    fortress() { // shield
      const sh = new T.Shape(); sh.moveTo(-0.5, 0.55); sh.lineTo(0.5, 0.55); sh.lineTo(0.5, 0.05); sh.quadraticCurveTo(0.5, -0.42, 0, -0.74); sh.quadraticCurveTo(-0.5, -0.42, -0.5, 0.05); sh.closePath();
      const geo = new T.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }); geo.center();
      const g = new T.Group(); g.add(withOutline(geo, L(0x4da3ff, { emissive: 0x1d5fb8, emissiveIntensity: 0.6 }), 1.08));
      const inner = new T.Mesh(geo, L(0xdcecff, { emissive: 0x8fbfff, emissiveIntensity: 0.4 })); inner.scale.set(0.6, 0.6, 1.5); inner.position.z = 0.04; g.add(inner);
      g.scale.setScalar(0.95); return { g };
    },
  };

  // A complete pickup: glowing pad, countdown ring, floating spinning 3D model, orbiting sparkles, name tag
  function makePickupModel(type, color, label, lean) {
    const col = new T.Color(color), group = new T.Group();
    const glow = flat(new T.Mesh(new T.CircleGeometry(1.9, 32), bas({ map: glowTex(color), blending: T.AdditiveBlending })), 0.03); group.add(glow);
    const pad = flat(new T.Mesh(new T.RingGeometry(0.82, 0.96, 40), bas({ color: col, opacity: 0.9, side: T.DoubleSide })), 0.04); group.add(pad);
    const timer = flat(new T.Mesh(new T.RingGeometry(1.08, 1.26, 48, 1, Math.PI / 2, Math.PI * 2), bas({ color: 0x66ff99, side: T.DoubleSide, opacity: 0.95 })), 0.05); group.add(timer);
    const shadow = flat(new T.Mesh(new T.CircleGeometry(0.5, 20), bas({ color: 0x000000, opacity: 0.35 })), 0.035); group.add(shadow);
    const tilt = new T.Group(); tilt.rotation.x = -lean; group.add(tilt);
    const spinner = new T.Group(); tilt.add(spinner);
    const model = MODELS[type](); spinner.add(model.g);
    const sparks = [0, 1, 2].map(() => { const m = new T.Mesh(new T.SphereGeometry(0.075, 8, 6), new T.MeshBasicMaterial({ color: col })); group.add(m); return m; });
    const tag = labelSprite(label); tag.position.y = 3.1; tag.visible = false; group.add(tag);
    let lastFrac = 1;
    return {
      group, tag,
      setTimer(frac) {
        if (Math.abs(frac - lastFrac) < 0.004 && frac > 0.01) return; lastFrac = frac;
        timer.geometry.dispose(); timer.geometry = new T.RingGeometry(1.08, 1.26, 48, 1, Math.PI / 2, Math.max(0.01, frac * Math.PI * 2));
        timer.material.color.set(frac > 0.4 ? 0x66ff99 : frac > 0.2 ? 0xffd23f : 0xff5555);
      },
      update(now, seed) {
        spinner.rotation.y = now / 800 + seed; spinner.position.y = 1.3 + Math.sin(now / 320 + seed) * 0.13;
        const p = 1 + Math.sin(now / 260 + seed) * 0.08; glow.scale.setScalar(p); pad.scale.setScalar(1 + Math.sin(now / 260 + seed) * 0.04);
        shadow.scale.setScalar(1 - (spinner.position.y - 1.2) * 0.5);
        sparks.forEach((s, i) => { const a = now / 650 + seed + i * 2.094; s.position.set(Math.cos(a) * 1.12, 0.9 + Math.sin(now / 400 + i) * 0.25, Math.sin(a) * 1.12 * 0.8); });
        if (model.anim) model.anim(now);
      },
    };
  }

  // Low graphics: hide fog / light shimmer / ambient critters (the map and rules are unchanged)
  function applyQuality() { fancy.forEach(o => { o.visible = !lowQuality; }); heavy.forEach(b => { b.mesh.count = lowQuality ? Math.ceil(b.full * 0.33) : b.full; }); } // low graphics keeps a third of the scenery
  function setLow(on) { lowQuality = on; applyQuality(); }
  window.Scenery = { setLow, buildMap, clearMap, updateMap, drawPreview, makePickupModel, labelSprite };
})();
