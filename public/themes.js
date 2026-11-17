// ======================= Themes: ground textures, decorations and ambient life for each map =======================
// Everything here is purely visual (nothing blocks you or changes the rules). Scenery is placed with a fixed seed, so
// every player sees the same trees, rocks and coral in the same spots.
(function () {
  const T = THREE, SW = Shared.W, SH = Shared.H;

  // ---------- tiny utilities ----------
  const strSeed = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash2(x, y, s) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 982451653); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // ---------- building models out of simple shapes, merged into ONE geometry (so 100 trees = 1 draw call) ----------
  const U = {
    sph: new T.SphereGeometry(1, 8, 6), box: new T.BoxGeometry(1, 1, 1), cone: new T.ConeGeometry(1, 1, 8), cyl: new T.CylinderGeometry(1, 1, 1, 8),
    ico: new T.IcosahedronGeometry(1, 0), hemi: new T.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), tor: new T.TorusGeometry(1, 0.12, 6, 16),
  };
  const _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _c = new T.Color(), UP = new T.Vector3(0, 1, 0), AX = new T.Vector3(1, 0, 0);
  // part(shape, color, [x,y,z] centre, [sx,sy,sz], rot)   rot = [rx,ry,rz]  or  {dir:[x,y,z]} (turn the shape's up-axis to point along dir)
  function part(kind, color, pos, scl, rot) {
    if (rot && rot.dir) _q.setFromUnitVectors(UP, _v.set(rot.dir[0], rot.dir[1], rot.dir[2]).normalize());
    else if (rot) _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])); else _q.identity();
    const g = U[kind].index ? U[kind].toNonIndexed() : U[kind].clone();
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(pos[0], pos[1], pos[2]), _q, new T.Vector3(scl[0], scl[1], scl[2])));
    const n = g.attributes.position.count, col = new Float32Array(n * 3); _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.deleteAttribute('uv'); return g;
  }
  function merge(list) {
    let n = 0; list.forEach(g => n += g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3)); out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.computeBoundingSphere(); return out;
  }
  // a branch from `base` along `dir` of length `len` (cone, thick end at the base)
  const stem = (kind, color, base, dir, len, r) => { const d = new T.Vector3(dir[0], dir[1], dir[2]).normalize(); return part(kind, color, [base[0] + d.x * len / 2, base[1] + d.y * len / 2, base[2] + d.z * len / 2], [r, len, r], { dir: [d.x, d.y, d.z] }); };

  // A batch = many copies of one model drawn in a single call. Copies lean back toward the camera like the characters do.
  function batch(geo, max, lean, matOpts) {
    const mesh = new T.InstancedMesh(geo, new T.MeshLambertMaterial(Object.assign({ vertexColors: true }, matOpts || {})), max);
    mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(max * 3), 3); // make the colour buffer full-size BEFORE the visible count is zeroed
    mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const qLean = new T.Quaternion().setFromAxisAngle(AX, -lean), qa = new T.Quaternion(), qb = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), m4 = new T.Matrix4(), tc = new T.Color(), e = new T.Euler();
    const api = {
      mesh,
      // o: { y, flat (don't lean), swx/swz (sway angles) }
      put(i, x, z, yaw, scale, tint, o) {
        o = o || {};
        qa.setFromAxisAngle(UP, yaw);
        if (o.swx || o.swz) { qb.setFromEuler(e.set(o.swx || 0, 0, o.swz || 0)); qa.multiply(qb); }
        if (!o.flat) qa.premultiply(qLean);
        const sc = typeof scale === 'number' ? [scale, scale, scale] : scale;
        m4.compose(p.set(x, o.y || 0, z), qa, s.set(sc[0], sc[1], sc[2])); mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, tc.set(tint === undefined ? 0xffffff : tint));
        mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      },
      add(x, z, yaw, scale, tint, o) { if (mesh.count >= mesh.instanceMatrix.count) return; api.put(mesh.count, x, z, yaw, scale, tint, o); mesh.count++; },
    };
    return api;
  }

  // ---------- placing things ----------
  function makeAvoid(map) { // is (x,z) on top of a hazard (or within `pad` tiles of one)?
    return (x, z, pad) => {
      for (const v of map.vortexes) if (Math.hypot(v.x - x, v.y - z) < v.r + pad) return true;
      for (const q of map.zones) {
        if (q.shape === 'ellipse') { const rx = q.w / 2 + pad, ry = q.h / 2 + pad, dx = (x - q.x - q.w / 2) / rx, dy = (z - q.y - q.h / 2) / ry; if (dx * dx + dy * dy < 1) return true; }
        else if (x > q.x - pad && x < q.x + q.w + pad && z > q.y - pad && z < q.y + q.h + pad) return true;
      }
      return false;
    };
  }
  const inside = (x, z, m) => x > m && x < SW - m && z > m && z < SH - m;
  function scatter(R, n, ok, span) { // n random spots in [-span, size+span] that pass ok(x,z)
    span = span === undefined ? 22 : span; const out = [];
    for (let t = 0; t < n * 40 && out.length < n; t++) { const x = R() * (SW + 2 * span) - span, z = R() * (SH + 2 * span) - span; if (ok(x, z)) out.push([x, z]); }
    return out;
  }
  const ground = (color, w, h, y, opacity) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color, transparent: opacity !== undefined, opacity: opacity === undefined ? 1 : opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; return m;
  };
  function strips(group, color, opacity, y, inner, outer) { // a square band around the map, from `inner` to `outer` tiles past the edge
    const t = outer - inner, mids = [
      [SW / 2, -(inner + outer) / 2, SW + 2 * outer, t], [SW / 2, SH + (inner + outer) / 2, SW + 2 * outer, t],
      [-(inner + outer) / 2, SH / 2, t, SH + 2 * inner], [SW + (inner + outer) / 2, SH / 2, t, SH + 2 * inner],
    ];
    const made = mids.map(([cx, cz, w, h]) => { const m = ground(color, w, h, y, opacity); m.position.x = cx; m.position.z = cz; group.add(m); return m; });
    return made;
  }
  function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; return t; }
  const overlay = (texture, w, h, y, opts) => { // a map-sized sheet of drifting light/fog
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial(Object.assign({ map: texture, transparent: true, depthWrite: false }, opts)));
    m.rotation.x = -Math.PI / 2; m.position.set(SW / 2, y, SH / 2); texture.repeat.set(w / 10, h / 10); return m;
  };
  function blobTex(rgb, alpha, n, size) { // soft blobs that wrap around, for fog / dust / light
    return tex(size || 256, size || 256, (g, w) => {
      const R = rng(7);
      for (let i = 0; i < n; i++) for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]) {
        const x = R() * w + ox, y = R() * w + oy, r = 24 + R() * 46;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${alpha * (0.5 + R() * 0.5)})`); gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
  }

  // =====================================================================================================
  //  OCEAN  -  Whirlpool Reef
  // =====================================================================================================
  function oceanModels() {
    const coral = (() => { const L = [part('sph', 0xffffff, [0, 0.1, 0], [0.32, 0.16, 0.32])];
      [[0, 0.5], [2.1, 0.4], [4.2, 0.55], [1.0, 0.3], [3.2, 0.35]].forEach(([a, t], i) => { const len = 0.55 + (i % 3) * 0.15, d = [Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)];
        L.push(stem('cone', 0xffffff, [0, 0.12, 0], d, len, 0.11)); L.push(part('sph', 0xffffff, [d[0] * len, 0.12 + d[1] * len, d[2] * len], [0.09, 0.09, 0.09])); });
      return merge(L); })();
    const brain = merge([part('sph', 0xffffff, [0, 0.2, 0], [0.5, 0.32, 0.5]), ...[[0.18, 0.44, 0.1], [-0.2, 0.42, -0.05], [0.02, 0.47, -0.2], [-0.05, 0.46, 0.2]].map(p => part('sph', 0xe9e9e9, p, [0.12, 0.08, 0.12]))]);
    const rock = merge([part('ico', 0x7d8fa3, [0, 0.55, 0], [1, 0.7, 0.85], [0.3, 0.5, 0.2]), part('ico', 0x6b7d92, [0.75, 0.25, 0.3], [0.45, 0.3, 0.4])]);
    const weed = merge([[0, 0.05, 1.1, 0x2fa36b], [0.12, -0.08, 1.45, 0x3dbb7a], [-0.1, 0.1, 0.9, 0x23895a], [0.05, 0.14, 1.25, 0x35b070]].map(([tx, tz, h, c], i) => stem('cone', c, [(i - 1.5) * 0.09, 0, (i % 2) * 0.08], [tx, 1, tz], h, 0.07)));
    const star = merge([part('sph', 0xffffff, [0, 0.05, 0], [0.13, 0.06, 0.13]), ...[0, 1, 2, 3, 4].map(k => { const a = k * 1.2566; return part('cone', 0xffffff, [Math.cos(a) * 0.17, 0.04, Math.sin(a) * 0.17], [0.085, 0.34, 0.085], { dir: [Math.cos(a), 0, Math.sin(a)] }); })]);
    const shell = merge([part('sph', 0xffffff, [0, 0.08, 0], [0.17, 0.09, 0.14]), part('cone', 0xf3c7b0, [-0.12, 0.06, 0], [0.05, 0.12, 0.05], [0, 0, 1.57])]);
    const wreck = merge([part('box', 0x6b4a2b, [0, 0.3, 0], [2.8, 0.6, 1.1]), part('box', 0x5a3d22, [1.5, 0.5, 0], [0.9, 0.8, 0.9], [0, 0, 0.4]), part('box', 0x7a5836, [-0.6, 0.8, 0.3], [0.12, 0.9, 0.5], [0, 0, 0.35]),
      part('box', 0x7a5836, [-1.0, 0.65, -0.3], [0.12, 0.7, 0.5], [0, 0, -0.3]), part('cyl', 0x5a3d22, [0.2, 1.2, 0], [0.07, 2.4, 0.07], [0, 0, 0.35]), part('box', 0xe8e2d0, [0.55, 1.55, 0], [0.03, 0.9, 0.8], [0, 0, 0.35]),
      ...[[0.4, 0.62, 0.3], [-0.9, 0.62, -0.2], [1.1, 0.4, 0.45], [-1.3, 0.35, 0.4]].map(p => part('sph', 0x8aa88a, p, [0.14, 0.09, 0.14]))]);
    const buoy = merge([part('cyl', 0xe94b4b, [0, 0.45, 0], [0.25, 0.5, 0.25]), part('cyl', 0xffffff, [0, 0.5, 0], [0.255, 0.18, 0.255]), part('hemi', 0xe94b4b, [0, 0.7, 0], [0.24, 0.22, 0.24]), part('sph', 0xffe066, [0, 0.98, 0], [0.07, 0.07, 0.07]), part('cyl', 0x555b66, [0, 0.12, 0], [0.06, 0.3, 0.06])]);
    const fish = merge([part('sph', 0xffffff, [0, 0.14, 0], [0.14, 0.17, 0.34]), part('cone', 0xf2f2f2, [0, 0.14, -0.4], [0.03, 0.24, 0.2], { dir: [0, 0, 1] }), part('sph', 0x111111, [0.09, 0.2, 0.2], [0.03, 0.03, 0.03]), part('sph', 0x111111, [-0.09, 0.2, 0.2], [0.03, 0.03, 0.03])]);
    const jelly = merge([part('hemi', 0xffffff, [0, 0.4, 0], [0.45, 0.4, 0.45]), ...[[0.2, 0], [-0.2, 0.05], [0, 0.2], [0.05, -0.2], [-0.1, -0.12]].map(([x, z]) => part('cyl', 0xf2dcff, [x, 0.2, z], [0.025, 0.45, 0.025]))]);
    return { coral, brain, rock, weed, star, shell, wreck, buoy, fish, jelly };
  }
  function causticTex() {
    return tex(256, 256, (g, w) => {
      const R = rng(11); g.strokeStyle = 'rgba(210,255,255,0.55)'; g.lineWidth = 2.2; g.lineJoin = 'round';
      for (let i = 0; i < 46; i++) { const cx = R() * w, cy = R() * w, r = 14 + R() * 26, k = 6 + Math.floor(R() * 3), ph = R() * 6;
        for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]) { g.beginPath();
          for (let j = 0; j <= 18; j++) { const a = j / 18 * Math.PI * 2, rr = r * (1 + 0.28 * Math.sin(a * k * 0.5 + ph)); const x = cx + ox + Math.cos(a) * rr, y = cy + oy + Math.sin(a) * rr * 0.8; j ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.stroke(); } }
    });
  }
  function buildOcean(map, lean) {
    const R = rng(strSeed(map.id)), g = new T.Group(), ups = [], fancy = [], avoid = makeAvoid(map), M = oceanModels();
    const g0 = ground(0x0a3a5c, 500, 500, -0.03); g0.position.set(SW / 2, -0.03, SH / 2); g.add(g0);
    strips(g, 0x2b92b0, 0.9, -0.02, 0, 4.5);            // the sandy reef shelf
    const foam = strips(g, 0xe8fcff, 0.55, -0.01, 0, 0.5); // a line of foam at the edge of the playing field
    ups.push((dt, now) => foam.forEach(f => { f.material.opacity = 0.42 + Math.sin(now / 600) * 0.14; }));
    const tints = [0xff7aa8, 0xff9a4d, 0xb983ff, 0xffd75e, 0x6fe0c4, 0xff6f6f];
    const B = {}; for (const k of ['coral', 'brain', 'rock', 'weed']) B[k] = batch(M[k], 220, lean);
    B.star = batch(M.star, 60, lean); B.shell = batch(M.shell, 50, lean); B.wreck = batch(M.wreck, 4, lean); B.buoy = batch(M.buoy, 12, lean);
    const outer = (x, z) => !inside(x, z, -1.4), rim = (x, z) => inside(x, z, 0.8) && !inside(x, z, 4.5), low = (x, z) => inside(x, z, 1.4) && !avoid(x, z, 1.6);
    scatter(R, 80, outer).forEach(([x, z]) => B.coral.add(x, z, R() * 6.28, 1.1 + R() * 1.1, tints[Math.floor(R() * tints.length)]));
    scatter(R, 26, (x, z) => low(x, z) && R() < 0.8).forEach(([x, z]) => B.coral.add(x, z, R() * 6.28, 0.55 + R() * 0.4, tints[Math.floor(R() * tints.length)]));
    scatter(R, 34, outer).forEach(([x, z]) => B.brain.add(x, z, R() * 6.28, 1 + R() * 0.9, tints[Math.floor(R() * 4)]));
    scatter(R, 14, low).forEach(([x, z]) => B.brain.add(x, z, R() * 6.28, 0.5 + R() * 0.3, tints[Math.floor(R() * 4)]));
    scatter(R, 50, outer).forEach(([x, z]) => B.rock.add(x, z, R() * 6.28, 0.9 + R() * 1.8, 0xffffff));
    scatter(R, 16, low).forEach(([x, z]) => B.rock.add(x, z, R() * 6.28, 0.3 + R() * 0.25, 0xffffff));
    const weedSpots = [...scatter(R, 70, outer), ...scatter(R, 24, rim)].map(([x, z]) => ({ x, z, s: inside(x, z, 0) ? 0.7 + R() * 0.4 : 1 + R() * 0.8, ph: R() * 6, yaw: R() * 6.28 }));
    weedSpots.forEach(w => B.weed.add(w.x, w.z, w.yaw, w.s, 0xffffff));
    scatter(R, 26, low).forEach(([x, z]) => B.star.add(x, z, R() * 6.28, 0.9 + R() * 0.5, [0xff8a3d, 0xff5d5d, 0xffb347][Math.floor(R() * 3)], { flat: true, y: 0.02 }));
    scatter(R, 30, low).forEach(([x, z]) => B.shell.add(x, z, R() * 6.28, 0.9 + R() * 0.5, [0xffffff, 0xffd6e6, 0xfff0c9][Math.floor(R() * 3)], { flat: true, y: 0.02 }));
    B.wreck.add(-9, 17, 0.5, 1.8, 0xffffff); B.wreck.add(SW + 10, 47, -0.6, 1.5, 0xffffff);
    [[-2.5, 6], [-3, 40], [SW + 2.8, 10], [SW + 3, 55], [20, -3], [46, SH + 3]].forEach(([x, z]) => B.buoy.add(x, z, 0, 1.2, 0xffffff));
    for (const k in B) g.add(B[k].mesh);
    ups.push((dt, now) => { // seaweed sways
      weedSpots.forEach((w, i) => B.weed.put(i, w.x, w.z, w.yaw, w.s, 0xffffff, { swz: Math.sin(now / 900 + w.ph) * 0.16, swx: Math.cos(now / 1100 + w.ph) * 0.1 }));
    });
    // fish schools gliding around in lazy circles, over the whole map
    const fishB = batch(M.fish, 48, lean, { transparent: false }), fish = [], FT = [0xff9a4d, 0xffd75e, 0x7fd6ff, 0xff7aa8];
    for (let s = 0; s < 5; s++) { const cx = 8 + R() * 48, cz = 8 + R() * 48, r = 6 + R() * 10, sp = (0.18 + R() * 0.3) * (R() < 0.5 ? -1 : 1), tint = FT[s % FT.length];
      for (let k = 0; k < 8; k++) fish.push({ cx: cx + (R() - 0.5) * 2, cz: cz + (R() - 0.5) * 2, r: r + (R() - 0.5) * 2.4, sp, ph: R() * 6.28, tint, sc: 0.55 + R() * 0.2 }); }
    fish.forEach((f, i) => fishB.add(f.cx, f.cz, 0, f.sc, f.tint, { flat: true, y: 0.3 }));
    ups.push((dt, now) => fish.forEach((f, i) => {
      const a = f.ph + now / 1000 * f.sp, dx = -Math.sin(a) * f.sp, dz = Math.cos(a) * 0.7 * f.sp;
      fishB.put(i, f.cx + Math.cos(a) * f.r, f.cz + Math.sin(a) * f.r * 0.7, Math.atan2(dx, dz) + Math.sin(now / 160 + f.ph) * 0.12, f.sc, f.tint, { flat: true, y: 0.3 + Math.sin(now / 700 + f.ph) * 0.05 });
    }));
    g.add(fishB.mesh); fancy.push(fishB.mesh);
    // jellyfish drifting at the edges
    const jb = batch(M.jelly, 12, lean, { transparent: true, opacity: 0.8, emissive: 0x442266 }), jel = [];
    scatter(R, 10, (x, z) => !inside(x, z, 3) && Math.hypot(x - 32, z - 32) < 46).forEach(([x, z]) => jel.push({ x, z, ph: R() * 6, s: 0.8 + R() * 0.7, tint: [0xff9be6, 0xb9a0ff, 0x9fe8ff][Math.floor(R() * 3)] }));
    jel.forEach(j => jb.add(j.x, j.z, 0, 1, j.tint));
    ups.push((dt, now) => jel.forEach((j, i) => { const pul = 1 + Math.sin(now / 420 + j.ph) * 0.12; jb.put(i, j.x + Math.sin(now / 3000 + j.ph) * 1.2, j.z + Math.cos(now / 3600 + j.ph) * 0.8, now / 5000 + j.ph, [j.s * pul, j.s * (2 - pul), j.s * pul], j.tint, { y: 0.9 + Math.sin(now / 1200 + j.ph) * 0.35 }); }));
    g.add(jb.mesh); fancy.push(jb.mesh);
    // bubbles rising from the sea floor
    const bub = new T.InstancedMesh(new T.SphereGeometry(0.07, 6, 5), new T.MeshBasicMaterial({ color: 0xd8f6ff, transparent: true, opacity: 0.55, depthWrite: false }), 60), bd = [], bm = new T.Matrix4(), bq = new T.Quaternion(), bp = new T.Vector3(), bs = new T.Vector3();
    bub.frustumCulled = false; bub.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < 60; i++) bd.push({ x: R() * (SW + 14) - 7, z: R() * (SH + 14) - 7, ph: R(), sp: 0.25 + R() * 0.3, s: 0.6 + R() * 0.9 });
    ups.push((dt, now) => { bd.forEach((b, i) => { const f = (b.ph + now / 1000 * b.sp) % 1; bs.setScalar(b.s * Math.sin(f * Math.PI)); bm.compose(bp.set(b.x + Math.sin(now / 700 + i) * 0.12, f * 2.4, b.z), bq, bs); bub.setMatrixAt(i, bm); }); bub.instanceMatrix.needsUpdate = true; });
    g.add(bub); fancy.push(bub);
    // dancing light on the sea floor
    const c1 = causticTex(), c2 = causticTex();
    const o1 = overlay(c1, SW + 12, SH + 12, 0.012, { blending: T.AdditiveBlending, opacity: 0.15 }), o2 = overlay(c2, SW + 12, SH + 12, 0.014, { blending: T.AdditiveBlending, opacity: 0.12 });
    o1.position.set(SW / 2, 0.012, SH / 2); o2.position.set(SW / 2, 0.014, SH / 2); g.add(o1, o2); fancy.push(o1, o2);
    ups.push((dt) => { c1.offset.x += dt * 0.012; c1.offset.y += dt * 0.008; c2.offset.x -= dt * 0.009; c2.offset.y += dt * 0.011; });
    return { group: g, bg: 0x06243d, fancy, heavy: Object.values(B), update: (dt, now) => ups.forEach(f => f(dt, now)) };
  }

  // =====================================================================================================
  //  SWAMP  -  Misty Bog
  // =====================================================================================================
  function swampModels() {
    const tree = merge([part('cone', 0x4d3320, [0, 0.12, 0], [0.36, 0.3, 0.36]), part('cyl', 0x5b3d22, [0, 0.75, 0], [0.17, 1.5, 0.17]), part('sph', 0x2f6a35, [0, 2.05, 0], [1.0, 0.85, 1.0]), part('sph', 0x3f8a45, [0.55, 1.65, 0.25], [0.7, 0.6, 0.7]),
      part('sph', 0x2b5e30, [-0.55, 1.75, -0.2], [0.75, 0.65, 0.75]), part('sph', 0x4a9a50, [0.1, 2.55, 0.1], [0.6, 0.5, 0.6]), part('sph', 0x7fa070, [0.62, 1.3, 0.3], [0.16, 0.38, 0.16]), part('sph', 0x7fa070, [-0.5, 1.35, -0.25], [0.14, 0.34, 0.14])]);
    const bush = merge([part('sph', 0x3b7a3f, [0, 0.3, 0], [0.55, 0.38, 0.5]), part('sph', 0x4a9250, [0.32, 0.22, 0.12], [0.34, 0.26, 0.32]), part('sph', 0x2f6a35, [-0.3, 0.24, -0.1], [0.36, 0.28, 0.34]), part('sph', 0xff7aa8, [0.1, 0.52, 0.2], [0.06, 0.06, 0.06])]);
    const mush = cap => merge([[0, 0, 1], [0.28, 0.12, 0.65], [-0.22, 0.16, 0.5]].flatMap(([x, z, s]) => [part('cyl', 0xf3ead2, [x, 0.16 * s, z], [0.07 * s, 0.32 * s, 0.07 * s]), part('hemi', cap, [x, 0.3 * s, z], [0.22 * s, 0.15 * s, 0.22 * s]), part('sph', 0xffffff, [x + 0.07 * s, 0.4 * s, z + 0.05 * s], [0.035 * s, 0.025 * s, 0.035 * s]), part('sph', 0xffffff, [x - 0.08 * s, 0.38 * s, z - 0.04 * s], [0.03 * s, 0.022 * s, 0.03 * s])]));
    const reed = merge([[-0.12, 0, 0.1, 1.3], [0.05, 0.05, -0.05, 1.0], [0.14, -0.02, -0.1, 1.45], [-0.04, -0.08, 0.12, 0.85], [0.0, 0.1, 0.0, 1.15]].flatMap(([bx, tx, tz, h], i) => {
      const L = [stem('cone', 0x7aa84e, [bx, 0, (i - 2) * 0.06], [tx, 1, tz], h, 0.03)];
      if (i % 2 === 0) { const d = new T.Vector3(tx, 1, tz).normalize(); L.push(part('cyl', 0x6b4423, [bx + d.x * (h - 0.05), d.y * (h - 0.05), (i - 2) * 0.06 + d.z * (h - 0.05)], [0.05, 0.22, 0.05], { dir: [tx, 1, tz] })); } return L; }));
    const log = merge([part('cyl', 0x6b4a2b, [0, 0.24, 0], [0.24, 1.8, 0.24], [0, 0, Math.PI / 2]), part('cyl', 0xcfa56c, [0.91, 0.24, 0], [0.2, 0.02, 0.2], [0, 0, Math.PI / 2]), part('sph', 0x4f8a45, [-0.2, 0.46, 0], [0.5, 0.1, 0.2]), stem('cyl', 0x5a3d22, [0.3, 0.4, 0.1], [0, 1, 0.4], 0.35, 0.05)]);
    const rock = merge([part('ico', 0x7b867a, [0, 0.45, 0], [0.9, 0.6, 0.8], [0.2, 0.4, 0.1]), part('sph', 0x4d8a3f, [0.1, 0.78, 0], [0.55, 0.14, 0.45]), part('ico', 0x6c776b, [0.7, 0.2, 0.3], [0.4, 0.28, 0.36])]);
    const flower = merge([part('cyl', 0x3c8a3c, [0, 0.13, 0], [0.012, 0.26, 0.012]), part('sph', 0xffffff, [0, 0.28, 0], [0.065, 0.05, 0.065]), part('sph', 0xffd23f, [0, 0.31, 0], [0.025, 0.02, 0.025])]);
    const pad = merge([part('cyl', 0x4fb36a, [0, 0.02, 0], [0.38, 0.03, 0.38]), part('cyl', 0x3f9a58, [0.1, 0.035, -0.1], [0.14, 0.02, 0.14]), part('sph', 0xffa6c9, [0.12, 0.08, 0.06], [0.1, 0.07, 0.1])]);
    return { tree, bush, mushR: mush(0xd9382f), mushO: mush(0xe0903a), reed, log, rock, flower, pad };
  }
  function buildSwamp(map, lean) {
    const R = rng(strSeed(map.id)), g = new T.Group(), ups = [], fancy = [], avoid = makeAvoid(map), M = swampModels();
    const g0 = ground(0x15230f, 500, 500, -0.03); g0.position.set(SW / 2, -0.03, SH / 2); g.add(g0);
    strips(g, 0x22401d, 1, -0.02, 0, 5);
    const B = { tree: batch(M.tree, 260, lean), bush: batch(M.bush, 120, lean), mushR: batch(M.mushR, 50, lean), mushO: batch(M.mushO, 50, lean), reed: batch(M.reed, 140, lean), log: batch(M.log, 16, lean), rock: batch(M.rock, 50, lean), flower: batch(M.flower, 130, lean), pad: batch(M.pad, 40, lean) };
    const outer = (x, z) => !inside(x, z, -1.6), low = (x, z) => inside(x, z, 1.4) && !avoid(x, z, 1.2);
    const gt = () => [0xffffff, 0xe6f3e0, 0xf0ffe8, 0xd8ecd0][Math.floor(R() * 4)];
    scatter(R, 120, outer, 22).forEach(([x, z]) => B.tree.add(x, z, R() * 6.28, 1.0 + R() * 1.0, gt()));
    scatter(R, 4, (x, z) => inside(x, z, 0.5) && !inside(x, z, 2.2) && !avoid(x, z, 2)).forEach(([x, z]) => B.tree.add(x, z, R() * 6.28, 0.7, gt()));
    scatter(R, 70, (x, z) => !inside(x, z, -0.8)).forEach(([x, z]) => B.bush.add(x, z, R() * 6.28, 0.9 + R() * 0.8, gt()));
    scatter(R, 34, low).forEach(([x, z]) => B.bush.add(x, z, R() * 6.28, 0.6 + R() * 0.45, gt()));
    scatter(R, 18, low).forEach(([x, z]) => B.mushR.add(x, z, R() * 6.28, 0.9 + R() * 0.6, 0xffffff));
    scatter(R, 18, low).forEach(([x, z]) => B.mushO.add(x, z, R() * 6.28, 0.9 + R() * 0.6, 0xffffff));
    scatter(R, 10, outer).forEach(([x, z]) => B.mushR.add(x, z, R() * 6.28, 1.6 + R() * 1.0, 0xffffff));
    scatter(R, 6, low).forEach(([x, z]) => B.log.add(x, z, R() * 6.28, 0.9 + R() * 0.4, 0xffffff));
    scatter(R, 8, outer).forEach(([x, z]) => B.log.add(x, z, R() * 6.28, 1.4, 0xffffff));
    scatter(R, 16, low).forEach(([x, z]) => B.rock.add(x, z, R() * 6.28, 0.5 + R() * 0.4, 0xffffff));
    scatter(R, 30, outer).forEach(([x, z]) => B.rock.add(x, z, R() * 6.28, 1.0 + R() * 1.4, 0xffffff));
    const FT = [0xffffff, 0xfff2a8, 0xffb3d9, 0xd9b3ff, 0xffd23f];
    scatter(R, 90, low).forEach(([x, z]) => B.flower.add(x, z, R() * 6.28, 0.9 + R() * 0.5, FT[Math.floor(R() * FT.length)]));
    // reeds & lily pads ring every mud pond; pond mud bubbles
    const reeds = [], bubbles = [];
    map.zones.filter(z => z.type === 'slow').forEach(z => {
      const cx = z.x + z.w / 2, cz = z.y + z.h / 2, rx = z.w / 2, rz = z.h / 2;
      for (let k = 0; k < 11; k++) { const a = k / 11 * 6.28 + R() * 0.4, rr = 1.08 + R() * 0.12; const x = cx + Math.cos(a) * rx * rr, zz = cz + Math.sin(a) * rz * rr; reeds.push({ x, z: zz, ph: R() * 6, yaw: R() * 6.28, s: 0.8 + R() * 0.6 }); }
      for (let k = 0; k < 4; k++) { const a = R() * 6.28, rr = Math.sqrt(R()) * 0.8; B.pad.add(cx + Math.cos(a) * rx * rr, cz + Math.sin(a) * rz * rr, R() * 6.28, 0.8 + R() * 0.5, 0xffffff, { flat: true, y: 0.03 }); }
      for (let k = 0; k < 6; k++) { const a = R() * 6.28, rr = Math.sqrt(R()) * 0.85; bubbles.push({ x: cx + Math.cos(a) * rx * rr, z: cz + Math.sin(a) * rz * rr, ph: R() * 6, sp: 0.4 + R() * 0.5 }); }
    });
    reeds.forEach(r => B.reed.add(r.x, r.z, r.yaw, r.s, 0xffffff));
    for (const k in B) g.add(B[k].mesh);
    ups.push((dt, now) => reeds.forEach((r, i) => B.reed.put(i, r.x, r.z, r.yaw, r.s, 0xffffff, { swz: Math.sin(now / 800 + r.ph) * 0.12, swx: Math.cos(now / 1000 + r.ph) * 0.08 })));
    // mud bubbles popping
    const mb = new T.InstancedMesh(new T.SphereGeometry(0.16, 8, 6), new T.MeshLambertMaterial({ color: 0x9a7448 }), Math.max(1, bubbles.length)), mm = new T.Matrix4(), mq = new T.Quaternion(), mp = new T.Vector3(), ms = new T.Vector3();
    mb.frustumCulled = false; mb.instanceMatrix.setUsage(T.DynamicDrawUsage);
    ups.push((dt, now) => { bubbles.forEach((b, i) => { const f = (b.ph + now / 1000 * b.sp) % 1, s = f < 0.7 ? Math.sin(f / 0.7 * Math.PI * 0.5) : Math.max(0, 1 - (f - 0.7) / 0.08); mm.compose(mp.set(b.x, 0.05, b.z), mq, ms.set(s, s * 0.6, s)); mb.setMatrixAt(i, mm); }); mb.instanceMatrix.needsUpdate = true; });
    g.add(mb); fancy.push(mb);
    // fireflies
    const ffm = new T.InstancedMesh(new T.SphereGeometry(0.09, 6, 5), new T.MeshBasicMaterial({ color: 0xd8ff6a, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }), 46), ff = [];
    ffm.frustumCulled = false; ffm.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < 46; i++) ff.push({ x: R() * (SW + 16) - 8, z: R() * (SH + 16) - 8, ph: R() * 6.28, sp: 0.3 + R() * 0.5, r: 0.8 + R() * 1.8 });
    ups.push((dt, now) => { ff.forEach((f, i) => { const t = now / 1000 * f.sp + f.ph, fl = Math.max(0, Math.sin(now / 420 + f.ph * 3)); mm.compose(mp.set(f.x + Math.cos(t) * f.r, 0.9 + Math.sin(t * 1.3) * 0.4, f.z + Math.sin(t * 0.8) * f.r), mq, ms.setScalar(0.3 + fl * 1.0)); ffm.setMatrixAt(i, mm); }); ffm.instanceMatrix.needsUpdate = true; });
    g.add(ffm); fancy.push(ffm);
    // fog drifting over the bog
    const f1 = blobTex('215,235,205', 0.5, 9), f2 = blobTex('215,235,205', 0.4, 8);
    const o1 = overlay(f1, SW + 14, SH + 14, 0.5, { opacity: 0.2 }), o2 = overlay(f2, SW + 14, SH + 14, 0.6, { opacity: 0.16 });
    f1.repeat.set(5, 5); f2.repeat.set(4, 4); g.add(o1, o2); fancy.push(o1, o2);
    ups.push(dt => { f1.offset.x += dt * 0.006; f1.offset.y += dt * 0.002; f2.offset.x -= dt * 0.004; f2.offset.y += dt * 0.005; });
    return { group: g, bg: 0x0d170b, fancy, heavy: Object.values(B), update: (dt, now) => ups.forEach(f => f(dt, now)) };
  }

  // =====================================================================================================
  //  CANYON  -  Canyon Dash
  // =====================================================================================================
  function canyonModels() {
    const mesa = (layers) => { let y = 0; return merge(layers.map(([w, h, d, c], i) => { const p = part('box', c, [0, y + h / 2, 0], [w, h, d], [0, i * 0.07, 0]); y += h; return p; })); };
    const mesaA = mesa([[2.6, 0.9, 2.2, 0xa8472a], [2.3, 0.8, 1.95, 0xc9693a], [2.0, 0.9, 1.7, 0xb5532c], [1.7, 0.7, 1.45, 0xd07a45], [1.3, 0.5, 1.1, 0xc25f30]]);
    const mesaB = mesa([[3.2, 0.7, 2.4, 0xb5532c], [2.8, 0.6, 2.1, 0xd07a45], [2.4, 0.8, 1.8, 0xa8472a]]);
    const boulder = merge([part('ico', 0xb07a4f, [0, 0.55, 0], [1, 0.75, 0.9], [0.2, 0.4, 0.1]), part('ico', 0x9c6a42, [0.8, 0.25, 0.3], [0.5, 0.35, 0.45])]);
    const sag = merge([part('cyl', 0x4f8a45, [0, 0.85, 0], [0.15, 1.7, 0.15]), part('sph', 0x4f8a45, [0, 1.7, 0], [0.15, 0.17, 0.15]),
      part('cyl', 0x4f8a45, [-0.28, 0.8, 0], [0.1, 0.5, 0.1], [0, 0, Math.PI / 2]), part('sph', 0x4f8a45, [-0.52, 0.8, 0], [0.1, 0.1, 0.1]), part('cyl', 0x4f8a45, [-0.52, 1.1, 0], [0.1, 0.6, 0.1]), part('sph', 0x4f8a45, [-0.52, 1.4, 0], [0.1, 0.11, 0.1]),
      part('cyl', 0x4f8a45, [0.28, 1.05, 0], [0.1, 0.5, 0.1], [0, 0, Math.PI / 2]), part('sph', 0x4f8a45, [0.52, 1.05, 0], [0.1, 0.1, 0.1]), part('cyl', 0x4f8a45, [0.52, 1.3, 0], [0.1, 0.5, 0.1]), part('sph', 0x4f8a45, [0.52, 1.55, 0], [0.1, 0.11, 0.1]), part('sph', 0xff7aa8, [0, 1.84, 0], [0.07, 0.05, 0.07])]);
    const barrel = merge([part('sph', 0x5a9a4f, [0, 0.24, 0], [0.3, 0.27, 0.3]), part('sph', 0x4a8a40, [0.1, 0.3, 0.14], [0.14, 0.18, 0.12]), part('sph', 0xff7aa8, [0, 0.5, 0], [0.09, 0.06, 0.09])]);
    const sage = merge([part('sph', 0x8a9360, [0, 0.25, 0], [0.42, 0.28, 0.4]), part('sph', 0x7a8555, [0.3, 0.18, 0.1], [0.28, 0.2, 0.26]), part('sph', 0x98a06c, [-0.25, 0.2, -0.1], [0.3, 0.22, 0.28])]);
    const skull = merge([part('sph', 0xf1ead6, [0, 0.1, 0], [0.14, 0.1, 0.18]), part('cone', 0xf1ead6, [0.2, 0.15, 0], [0.04, 0.3, 0.04], [0, 0, -1.2]), part('cone', 0xf1ead6, [-0.2, 0.15, 0], [0.04, 0.3, 0.04], [0, 0, 1.2]), part('sph', 0x2a2420, [0.06, 0.13, 0.15], [0.03, 0.03, 0.03]), part('sph', 0x2a2420, [-0.06, 0.13, 0.15], [0.03, 0.03, 0.03])]);
    const wheel = merge([part('tor', 0x6b4a2b, [0, 0.52, 0], [0.5, 0.5, 0.5]), part('sph', 0x5a3d22, [0, 0.52, 0], [0.08, 0.08, 0.08]), ...[0, 1, 2].map(k => part('box', 0x6b4a2b, [0, 0.52, 0], [0.05, 0.98, 0.04], [0, 0, k * 1.047]))]);
    const crate = merge([part('box', 0x9a6b3a, [0, 0.3, 0], [0.6, 0.6, 0.6]), part('box', 0x6b4a2b, [0, 0.3, 0], [0.62, 0.08, 0.62]), part('box', 0x6b4a2b, [0, 0.52, 0], [0.62, 0.06, 0.62]), part('box', 0x6b4a2b, [0, 0.08, 0], [0.62, 0.06, 0.62])]);
    const barrelW = merge([part('cyl', 0x7a5230, [0, 0.35, 0], [0.28, 0.7, 0.28]), part('cyl', 0x3a3a40, [0, 0.18, 0], [0.295, 0.05, 0.295]), part('cyl', 0x3a3a40, [0, 0.52, 0], [0.295, 0.05, 0.295])]);
    const sign = merge([part('cyl', 0x6b4a2b, [0, 0.6, 0], [0.05, 1.2, 0.05]), part('box', 0xc9a066, [0.28, 1.05, 0], [0.7, 0.26, 0.05]), part('cone', 0xc9a066, [0.68, 1.05, 0], [0.15, 0.2, 0.04], [0, 0, -Math.PI / 2])]);
    return { mesaA, mesaB, boulder, sag, barrel, sage, skull, wheel, crate, barrelW, sign };
  }
  function buildCanyon(map, lean) {
    const R = rng(strSeed(map.id)), g = new T.Group(), ups = [], fancy = [], avoid = makeAvoid(map), M = canyonModels();
    const g0 = ground(0x6c3a24, 500, 500, -0.03); g0.position.set(SW / 2, -0.03, SH / 2); g.add(g0);
    strips(g, 0xa35e38, 1, -0.02, 0, 4.5); strips(g, 0xd9b27a, 0.6, -0.015, 0, 1.2);
    const B = { mesaA: batch(M.mesaA, 60, lean), mesaB: batch(M.mesaB, 60, lean), boulder: batch(M.boulder, 120, lean), sag: batch(M.sag, 90, lean), barrel: batch(M.barrel, 50, lean), sage: batch(M.sage, 90, lean), skull: batch(M.skull, 12, lean), wheel: batch(M.wheel, 8, lean), crate: batch(M.crate, 24, lean), barrelW: batch(M.barrelW, 24, lean), sign: batch(M.sign, 10, lean) };
    const outer = (x, z) => !inside(x, z, -1.8), low = (x, z) => inside(x, z, 1.4) && !avoid(x, z, 1.8);
    const red = () => [0xffffff, 0xf3d8c8, 0xffe3cf, 0xe6c0a8][Math.floor(R() * 4)];
    scatter(R, 56, (x, z) => !inside(x, z, -3.5)).forEach(([x, z]) => (R() < 0.5 ? B.mesaA : B.mesaB).add(x, z, R() * 6.28, 1.0 + R() * 1.5, red()));
    scatter(R, 70, outer).forEach(([x, z]) => B.sag.add(x, z, R() * 6.28, 0.9 + R() * 0.7, 0xffffff));
    scatter(R, 5, (x, z) => inside(x, z, 0.6) && !inside(x, z, 2.6) && !avoid(x, z, 3)).forEach(([x, z]) => B.sag.add(x, z, R() * 6.28, 0.6, 0xffffff));
    scatter(R, 60, outer).forEach(([x, z]) => B.boulder.add(x, z, R() * 6.28, 0.9 + R() * 1.6, red()));
    scatter(R, 22, low).forEach(([x, z]) => B.boulder.add(x, z, R() * 6.28, 0.3 + R() * 0.3, red()));
    scatter(R, 28, low).forEach(([x, z]) => B.barrel.add(x, z, R() * 6.28, 0.8 + R() * 0.6, 0xffffff));
    scatter(R, 30, outer).forEach(([x, z]) => B.barrel.add(x, z, R() * 6.28, 1.2 + R() * 0.8, 0xffffff));
    scatter(R, 46, (x, z) => low(x, z) || (outer(x, z) && R() < 0.5)).forEach(([x, z]) => B.sage.add(x, z, R() * 6.28, 0.7 + R() * 0.7, 0xffffff));
    scatter(R, 6, low).forEach(([x, z]) => B.skull.add(x, z, R() * 6.28, 1, 0xffffff, { flat: true, y: 0.01 }));
    scatter(R, 5, low).forEach(([x, z]) => B.wheel.add(x, z, R() * 6.28, 1.0, 0xffffff));
    scatter(R, 8, low).forEach(([x, z]) => B.crate.add(x, z, R() * 6.28, 0.8 + R() * 0.3, 0xffffff));
    scatter(R, 8, low).forEach(([x, z]) => B.barrelW.add(x, z, R() * 6.28, 0.9, 0xffffff));
    scatter(R, 14, outer).forEach(([x, z]) => (R() < 0.5 ? B.crate : B.barrelW).add(x, z, R() * 6.28, 1.0, 0xffffff));
    // signposts pointing the way around the racetrack, in the four corners just outside the ring road
    [[10, 9.2, 0], [54, 15, Math.PI / 2], [54, 55, Math.PI], [10, 49, -Math.PI / 2]].forEach(([x, z, yaw]) => B.sign.add(x, z, yaw, 1.3, 0xffffff));
    for (const k in B) g.add(B[k].mesh);
    // tumbleweeds rolling past
    const tw = new T.InstancedMesh(new T.IcosahedronGeometry(0.5, 1), new T.MeshLambertMaterial({ color: 0xb59a62, wireframe: true }), 7), td = [], tm = new T.Matrix4(), tq = new T.Quaternion(), tp = new T.Vector3(), ts = new T.Vector3(), te = new T.Euler();
    tw.frustumCulled = false; tw.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < 7; i++) td.push({ z: R() * SH, x0: R() * (SW + 40), sp: 1.6 + R() * 1.6, s: 0.7 + R() * 0.5, ph: R() * 6 });
    ups.push((dt, now) => { td.forEach((t, i) => { const x = ((t.x0 + now / 1000 * t.sp) % (SW + 40)) - 20, hop = Math.abs(Math.sin(now / 500 + t.ph)) * 0.35; tq.setFromEuler(te.set(now / 400 * t.sp, 0, now / 300 * t.sp)); tm.compose(tp.set(x, 0.28 * t.s + hop, t.z + Math.sin(now / 2000 + t.ph) * 2), tq, ts.setScalar(t.s)); tw.setMatrixAt(i, tm); }); tw.instanceMatrix.needsUpdate = true; });
    g.add(tw); fancy.push(tw);
    // drifting dust
    const d1 = blobTex('240,215,170', 0.45, 8), d2 = blobTex('240,215,170', 0.35, 7);
    const o1 = overlay(d1, SW + 14, SH + 14, 0.5, { opacity: 0.13 }), o2 = overlay(d2, SW + 14, SH + 14, 0.6, { opacity: 0.1 });
    d1.repeat.set(5, 3); d2.repeat.set(4, 3); g.add(o1, o2); fancy.push(o1, o2);
    ups.push(dt => { d1.offset.x += dt * 0.02; d2.offset.x += dt * 0.032; d2.offset.y += dt * 0.003; });
    return { group: g, bg: 0x3b1d12, fancy, heavy: Object.values(B), update: (dt, now) => ups.forEach(f => f(dt, now)) };
  }

  // ---------- ground texture for tiles nobody has claimed ----------
  function paintNeutral(ctx, px, py, ts, x, y, map) {
    const h1 = hash2(x, y, 1), h2 = hash2(x, y, 2), h3 = hash2(x, y, 3), u = ts / 16;
    if (map.theme === 'ocean') {
      ctx.fillStyle = `hsl(${196 + (h1 - 0.5) * 6},${56 + h2 * 6}%,${32 + h1 * 3}%)`; ctx.fillRect(px, py, ts, ts);
      if (h2 < 0.07) { ctx.fillStyle = 'rgba(224,204,150,0.2)'; ctx.beginPath(); ctx.ellipse(px + ts * (0.3 + h1 * 0.4), py + ts * (0.3 + h3 * 0.4), 5 * u, 3 * u, h1 * 3, 0, 7); ctx.fill(); }
      if (h3 < 0.4) { ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = u; ctx.beginPath(); ctx.arc(px + ts * (0.2 + h1 * 0.5), py + ts * (0.55 + h2 * 0.3), 4 * u + h2 * 3 * u, 3.5, 5.6); ctx.stroke(); }
    } else if (map.theme === 'swamp') {
      ctx.fillStyle = `hsl(${98 + (h1 - 0.5) * 10},${34 + h2 * 6}%,${22 + h1 * 3}%)`; ctx.fillRect(px, py, ts, ts);
      if (h2 < 0.6) { ctx.strokeStyle = `rgba(${130 + h1 * 40},${180 + h3 * 30},84,0.5)`; ctx.lineWidth = u * 1.2; for (let k = 0; k < 3; k++) { const bx = px + ts * (0.2 + 0.3 * k + h1 * 0.1), by = py + ts * (0.55 + h3 * 0.3); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + (k - 1) * 1.5 * u, by - (3 + h2 * 3) * u); ctx.stroke(); } }
      if (h3 < 0.05) { ctx.fillStyle = h1 < 0.5 ? '#fff6c8' : '#ffd23f'; ctx.beginPath(); ctx.arc(px + ts * (0.3 + h1 * 0.4), py + ts * (0.3 + h2 * 0.4), 1.4 * u, 0, 7); ctx.fill(); }
    } else if (map.theme === 'canyon') {
      ctx.fillStyle = `hsl(${34 + (h1 - 0.5) * 4},${44 + h2 * 6}%,${58 + h1 * 3}%)`; ctx.fillRect(px, py, ts, ts);
      ctx.fillStyle = 'rgba(120,80,40,0.22)'; for (let k = 0; k < 4; k++) { ctx.fillRect(px + ts * hash2(x, y, 10 + k), py + ts * hash2(x, y, 20 + k), u, u); }
      if (h2 < 0.08) { ctx.strokeStyle = 'rgba(100,60,30,0.3)'; ctx.lineWidth = u; ctx.beginPath(); ctx.moveTo(px + 2 * u, py + ts * 0.3); ctx.lineTo(px + ts * 0.45, py + ts * 0.5); ctx.lineTo(px + ts * 0.7, py + ts * 0.42); ctx.lineTo(px + ts - 2 * u, py + ts * 0.7); ctx.stroke(); }
      if (h3 < 0.08) { ctx.fillStyle = 'rgba(255,235,200,0.35)'; ctx.beginPath(); ctx.ellipse(px + ts * (0.3 + h1 * 0.4), py + ts * (0.3 + h2 * 0.4), 2.5 * u, 1.8 * u, h1 * 3, 0, 7); ctx.fill(); }
    } else { ctx.fillStyle = map.ground; ctx.fillRect(px, py, ts, ts); }
  }

  // colours for the hazards, matched to each theme
  function style(map) {
    if (map.theme === 'ocean') return { vortex: { arm: '#f2ffff', glow: '#7fe3ff', ring: 0xe6fbff, boundary: 0xbff3ff, dark: 'rgba(2,30,60,0.95)', mid: 'rgba(8,70,120,0.55)' } };
    if (map.theme === 'swamp') return { mud: { base: '#6e4d2d', dark: '#3f2a16', light: '#a98255', rim: 0x2d1e10, edge: '#caa070' } };
    if (map.theme === 'canyon') return { lane: { road: 'rgba(46,38,34,0.82)', chevron: '#ffd23f', dash: '#fff2bd', edge: 0xfff2bd } };
    return {};
  }
  const BUILD = { ocean: buildOcean, swamp: buildSwamp, canyon: buildCanyon };
  window.Themes = {
    paintNeutral, style,
    build(map, lean) { return BUILD[map.theme] ? BUILD[map.theme](map, lean) : { group: new T.Group(), bg: 0x0a0d12, update() {} }; },
  };
})();
