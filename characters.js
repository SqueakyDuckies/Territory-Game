// ======================= Characters: skeleton rigs + procedural animation =======================
// Exposes: makeCharacter(type, hue, lean) and animateCharacter(avatar, dt, now, speed, turnRate)
(function () {
  const T = THREE;
  const OUT = new T.MeshBasicMaterial({ color: 0x14161c, side: T.BackSide }); // dark outline shell
  const SPH = new T.SphereGeometry(1, 20, 14), BOX = new T.BoxGeometry(1, 1, 1), CONE = new T.ConeGeometry(1, 1, 16);
  const L = (c, o) => new T.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  const B = (c, o) => new T.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
  const pv = (x, y, z, parent) => { const g = new T.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g; };
  const at = (m, x, y, z, parent) => { m.position.set(x, y, z); parent.add(m); return m; };
  function outline(m, hx, hy, hz, t) { t = t || 0.026; const o = new T.Mesh(m.geometry, OUT); o.scale.set(1 + t / hx, 1 + t / hy, 1 + t / hz); m.add(o); }
  function ell(rx, ry, rz, mat, ol) { const m = new T.Mesh(SPH, mat); m.scale.set(rx, ry, rz); if (ol) outline(m, rx, ry, rz); return m; }
  function bx(w, h, d, mat, ol) { const m = new T.Mesh(BOX, mat); m.scale.set(w, h, d); if (ol) outline(m, w / 2, h / 2, d / 2); return m; }
  function cone(r, h, mat, ol) { const m = new T.Mesh(CONE, mat); m.scale.set(r, h, r); if (ol) outline(m, r, h / 2, r); return m; }

  function eye(C, parent, x, y, z, r, color) { // glossy cartoon eye (blinks)
    const g = pv(x, y, z, parent);
    at(ell(r, r * 1.2, r * 0.6, L(color || 0x101216)), 0, 0, 0, g);
    at(ell(r * 0.32, r * 0.32, r * 0.2, B(0xffffff)), r * 0.35, r * 0.4, r * 0.45, g);
    C.eyes.push(g); return g;
  }
  function arm(parent, x, y, len, r, mat, handMat) { // pivots at the shoulder
    const p = pv(x, y, 0, parent);
    at(ell(r, len / 2 + r * 0.5, r, mat, true), 0, -len / 2, 0, p);
    at(ell(r * 1.2, r * 1.2, r * 1.2, handMat || mat, true), 0, -len, 0, p);
    return p;
  }
  function leg(parent, x, hip, r, mat, footMat, footL) { // pivots at the hip, foot sits on the ground
    const p = pv(x, hip, 0, parent), fr = r * 0.75;
    at(ell(r, hip / 2 + r * 0.3, r, mat, true), 0, -hip / 2, 0, p);
    at(ell(r * 1.25, fr, footL, footMat || mat, true), 0, -hip + fr * 0.9, footL * 0.45, p);
    return p;
  }
  function ear(C, parent, s, x, y, z, rotZ, big, mat, inner) {
    const e = pv(x * s, y, z, parent); e.rotation.z = rotZ * s; e.userData.bz = e.rotation.z;
    at(cone(big[0], big[1], mat, true), 0, big[1] / 2, 0, e);
    if (inner) at(cone(big[0] * 0.55, big[1] * 0.62, inner), 0, big[1] * 0.4, big[0] * 0.3, e);
    C.ears.push(e); return e;
  }

  // ---------------- the six characters ----------------
  const BUILD = {
    fox(C) {
      const o = L(0xee8a3e), d = L(0x45291f), w = L(0xfff0dd), k = L(0x111111);
      C.hip = 0.36; C.neckY = 0.5; C.neckR = 0.28;
      at(ell(0.3, 0.27, 0.25, o, true), 0, 0.22, 0, C.upper); at(ell(0.2, 0.2, 0.12, w), 0, 0.2, 0.15, C.upper);
      const h = C.head = pv(0, 0.5, 0, C.upper);
      at(ell(0.43, 0.34, 0.36, o, true), 0, 0.27, 0, h);
      at(ell(0.2, 0.13, 0.16, w), -0.24, 0.15, 0.2, h); at(ell(0.2, 0.13, 0.16, w), 0.24, 0.15, 0.2, h);
      at(ell(0.17, 0.12, 0.17, w), 0, 0.16, 0.3, h); at(ell(0.055, 0.04, 0.04, k), 0, 0.2, 0.46, h);
      eye(C, h, -0.16, 0.33, 0.3, 0.065); eye(C, h, 0.16, 0.33, 0.3, 0.065);
      for (const s of [-1, 1]) ear(C, h, s, 0.24, 0.5, -0.02, -0.28, [0.14, 0.36], o, d);
      C.tail = pv(0, 0.12, -0.22, C.upper); C.tailBase = 0.7;
      at(ell(0.16, 0.16, 0.3, o, true), 0, 0.02, -0.26, C.tail); at(ell(0.12, 0.12, 0.14, w), 0, 0.02, -0.53, C.tail);
      C.armL = arm(C.upper, -0.31, 0.36, 0.28, 0.085, o, d); C.armR = arm(C.upper, 0.31, 0.36, 0.28, 0.085, o, d);
      C.legL = leg(C.rig, -0.14, C.hip, 0.1, d, d, 0.16); C.legR = leg(C.rig, 0.14, C.hip, 0.1, d, d, 0.16);
      C.style = { legAmp: 0.85, armAmp: 0.75, bob: 0.1, lean: 0.16, twist: 0.16, roll: 0.03, squash: 0.22, tail: 1, ear: 1, cadence: 1.05 };
    },
    cat(C) {
      const g = L(0x9aa3b5), dk = L(0x636b80), w = L(0xf0f2f7), pink = L(0xffa0b4), k = L(0x111111);
      C.hip = 0.36; C.neckY = 0.5; C.neckR = 0.26;
      at(ell(0.27, 0.26, 0.23, g, true), 0, 0.22, 0, C.upper); at(ell(0.15, 0.18, 0.1, w), 0, 0.2, 0.16, C.upper);
      for (const y of [0.16, 0.26, 0.36]) at(bx(0.3, 0.035, 0.03, dk), 0, y, -0.22, C.upper); // back stripes
      const h = C.head = pv(0, 0.5, 0, C.upper);
      at(ell(0.41, 0.33, 0.34, g, true), 0, 0.27, 0, h);
      for (const x of [-0.07, 0, 0.07]) at(bx(0.028, 0.1, 0.03, dk), x, 0.56, 0.12, h);
      at(ell(0.13, 0.1, 0.1, w), -0.21, 0.13, 0.22, h); at(ell(0.13, 0.1, 0.1, w), 0.21, 0.13, 0.22, h);
      at(ell(0.045, 0.035, 0.03, pink), 0, 0.2, 0.33, h);
      eye(C, h, -0.16, 0.31, 0.27, 0.075); eye(C, h, 0.16, 0.31, 0.27, 0.075);
      for (const s of [-1, 1]) for (const a of [-0.25, 0, 0.25]) { // whiskers
        const wh = at(bx(0.3, 0.008, 0.008, B(0xffffff)), 0.27 * s, 0.17 + a * 0.15, 0.27, h); wh.rotation.z = a * s * 0.6;
      }
      for (const s of [-1, 1]) ear(C, h, s, 0.22, 0.52, 0, -0.3, [0.13, 0.3], g, pink);
      C.tail = pv(0, 0.12, -0.2, C.upper); C.tailBase = 1.0;
      at(ell(0.05, 0.05, 0.17, g, true), 0, 0, -0.17, C.tail);
      C.tail2 = pv(0, 0, -0.33, C.tail);
      at(ell(0.045, 0.045, 0.17, g, true), 0, 0, -0.15, C.tail2); at(ell(0.05, 0.05, 0.05, dk), 0, 0, -0.31, C.tail2);
      C.armL = arm(C.upper, -0.29, 0.36, 0.27, 0.075, g, w); C.armR = arm(C.upper, 0.29, 0.36, 0.27, 0.075, g, w);
      C.legL = leg(C.rig, -0.13, C.hip, 0.09, g, w, 0.15); C.legR = leg(C.rig, 0.13, C.hip, 0.09, g, w, 0.15);
      C.style = { legAmp: 0.8, armAmp: 0.65, bob: 0.07, lean: 0.12, twist: 0.2, roll: 0.02, squash: 0.15, tail: 1.3, ear: 1, cadence: 1.15 };
    },
    frog(C) {
      const g = L(0x5cc15f), dg = L(0x3a923f), lg = L(0xcdeea6), wh = L(0xffffff), k = L(0x15221a);
      C.hip = 0.3; C.neckY = 0.42; C.neckR = 0.32;
      at(ell(0.33, 0.26, 0.28, g, true), 0, 0.2, 0, C.upper); at(ell(0.23, 0.2, 0.14, lg), 0, 0.16, 0.18, C.upper);
      for (const [x, y, z] of [[-0.12, 0.34, -0.12], [0.1, 0.3, -0.18], [0.0, 0.4, -0.02]]) at(ell(0.06, 0.025, 0.06, dg), x, y, z, C.upper);
      const h = C.head = pv(0, 0.42, 0, C.upper);
      at(ell(0.48, 0.27, 0.37, g, true), 0, 0.2, 0.02, h);
      for (const s of [-1, 1]) { // bulging eyes on top
        at(ell(0.15, 0.14, 0.15, g, true), 0.24 * s, 0.4, 0.08, h);
        const e = pv(0.24 * s, 0.42, 0.2, h);
        at(ell(0.1, 0.11, 0.07, wh), 0, 0, 0, e); at(ell(0.055, 0.065, 0.04, k), 0, 0, 0.05, e); at(ell(0.02, 0.02, 0.015, B(0xffffff)), 0.02, 0.03, 0.08, e);
        C.eyes.push(e);
      }
      const sm = new T.Mesh(new T.TorusGeometry(0.2, 0.014, 6, 18, Math.PI), B(0x1d4a24)); sm.rotation.z = Math.PI; sm.position.set(0, 0.2, 0.36); sm.scale.set(1.2, 0.8, 1); h.add(sm);
      at(ell(0.025, 0.02, 0.02, k), -0.07, 0.3, 0.37, h); at(ell(0.025, 0.02, 0.02, k), 0.07, 0.3, 0.37, h);
      C.armL = arm(C.upper, -0.33, 0.3, 0.24, 0.07, g, lg); C.armR = arm(C.upper, 0.33, 0.3, 0.24, 0.07, g, lg);
      C.legL = leg(C.rig, -0.17, C.hip, 0.12, g, dg, 0.22); C.legR = leg(C.rig, 0.17, C.hip, 0.12, g, dg, 0.22);
      C.style = { legAmp: 0.7, armAmp: 1.0, bob: 0.3, lean: 0.12, twist: 0.04, roll: 0, squash: 0.3, tail: 0, ear: 0, cadence: 0.6, hop: true };
    },
    panda(C) {
      const w = L(0xf6f6f6), k = L(0x1b1d22), gr = L(0xdcdcdc);
      C.hip = 0.34; C.neckY = 0.5; C.neckR = 0.3;
      at(ell(0.35, 0.3, 0.3, w, true), 0, 0.22, 0, C.upper);
      const h = C.head = pv(0, 0.5, 0, C.upper);
      at(ell(0.43, 0.36, 0.36, w, true), 0, 0.28, 0, h);
      at(ell(0.13, 0.1, 0.1, gr), 0, 0.15, 0.3, h); at(ell(0.065, 0.045, 0.045, k), 0, 0.2, 0.39, h);
      for (const s of [-1, 1]) {
        const p = at(ell(0.11, 0.14, 0.06, k), 0.17 * s, 0.31, 0.3, h); p.rotation.z = -0.45 * s;
        const e = pv(0.17 * s, 0.31, 0.34, h); at(ell(0.045, 0.05, 0.03, B(0xffffff)), 0, 0, 0, e); at(ell(0.026, 0.03, 0.025, k), 0, 0, 0.02, e); C.eyes.push(e);
        const ep = pv(0.3 * s, 0.5, -0.03, h); ep.rotation.z = -0.4 * s; ep.userData.bz = ep.rotation.z; at(ell(0.13, 0.13, 0.08, k, true), 0, 0.1, 0, ep); C.ears.push(ep);
      }
      C.tail = pv(0, 0.12, -0.27, C.upper); C.tailBase = 0; at(ell(0.09, 0.09, 0.09, w, true), 0, 0, -0.04, C.tail);
      C.armL = arm(C.upper, -0.36, 0.34, 0.27, 0.1, k, k); C.armR = arm(C.upper, 0.36, 0.34, 0.27, 0.1, k, k);
      C.legL = leg(C.rig, -0.16, C.hip, 0.12, k, k, 0.18); C.legR = leg(C.rig, 0.16, C.hip, 0.12, k, k, 0.18);
      C.style = { legAmp: 0.65, armAmp: 0.55, bob: 0.06, lean: 0.08, twist: 0.1, roll: 0.09, squash: 0.3, tail: 0.5, ear: 0.3, cadence: 0.85 };
    },
    robot(C) {
      const st = L(0xaab4c2), li = L(0xdfe5ee), dk = L(0x3f4856), glow = B(0x37e6ff);
      C.hip = 0.36; C.neckY = 0.5; C.neckR = 0.24;
      at(bx(0.52, 0.46, 0.4, st, true), 0, 0.24, 0, C.upper); at(bx(0.54, 0.07, 0.42, dk), 0, 0.03, 0, C.upper);
      at(bx(0.3, 0.2, 0.02, dk), 0, 0.27, 0.205, C.upper);
      for (const x of [-0.08, 0, 0.08]) at(bx(0.05, 0.05, 0.02, x === 0 ? B(0xff5a5a) : glow), x, 0.27, 0.22, C.upper);
      const h = C.head = pv(0, 0.5, 0, C.upper);
      at(bx(0.6, 0.46, 0.5, li, true), 0, 0.3, 0, h); at(bx(0.46, 0.28, 0.02, dk), 0, 0.3, 0.255, h);
      eye(C, h, -0.1, 0.33, 0.27, 0.05, 0x37e6ff).children[0].material = glow;
      eye(C, h, 0.1, 0.33, 0.27, 0.05, 0x37e6ff).children[0].material = glow;
      at(bx(0.16, 0.025, 0.02, glow), 0, 0.22, 0.27, h);
      for (const s of [-1, 1]) { const b = at(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.1, 12), dk), 0.32 * s, 0.3, 0, h); b.rotation.z = Math.PI / 2; }
      C.antenna = pv(0, 0.53, 0, h);
      at(ell(0.02, 0.1, 0.02, dk), 0, 0.1, 0, C.antenna); at(ell(0.06, 0.06, 0.06, L(0xff4a4a, { emissive: 0xaa1111 })), 0, 0.22, 0, C.antenna);
      C.armL = arm(C.upper, -0.38, 0.38, 0.27, 0.075, st, dk); C.armR = arm(C.upper, 0.38, 0.38, 0.27, 0.075, st, dk);
      for (const a of [C.armL, C.armR]) at(ell(0.1, 0.1, 0.1, dk), 0, 0, 0, a);
      C.legL = leg(C.rig, -0.15, C.hip, 0.09, st, dk, 0.17); C.legR = leg(C.rig, 0.15, C.hip, 0.09, st, dk, 0.17);
      C.style = { legAmp: 0.7, armAmp: 0.6, bob: 0.05, lean: 0.05, twist: 0.04, roll: 0, squash: 0.06, tail: 0, ear: 0, cadence: 1.2, stiff: true };
    },
    penguin(C) {
      const nv = L(0x262b3a), w = L(0xf7f7fb), or = L(0xff9d2a), k = L(0x111111);
      C.hip = 0.2; C.neckY = 0.62; C.neckR = 0.27;
      at(ell(0.36, 0.43, 0.31, nv, true), 0, 0.3, 0, C.upper); at(ell(0.26, 0.35, 0.14, w), 0, 0.26, 0.2, C.upper);
      const h = C.head = pv(0, 0.62, 0, C.upper);
      at(ell(0.34, 0.3, 0.3, nv, true), 0, 0.2, 0, h); at(ell(0.22, 0.17, 0.1, w), 0, 0.16, 0.22, h);
      eye(C, h, -0.115, 0.24, 0.27, 0.05); eye(C, h, 0.115, 0.24, 0.27, 0.05);
      const bk = at(cone(0.075, 0.2, or, true), 0, 0.14, 0.34, h); bk.rotation.x = Math.PI / 2; bk.scale.y = 0.2; bk.scale.x = 0.1; bk.scale.z = 0.07;
      at(cone(0.1, 0.2, nv), 0, 0.12, -0.3, C.upper).rotation.x = -2.0;
      for (const s of [-1, 1]) { // flippers
        const f = pv(0.37 * s, 0.46, 0, C.upper); at(ell(0.06, 0.24, 0.15, nv, true), 0, -0.2, 0, f);
        if (s < 0) C.armL = f; else C.armR = f; f.rotation.z = 0.2 * s; f.userData.bz = 0.2 * s;
      }
      C.legL = leg(C.rig, -0.14, C.hip, 0.07, or, or, 0.2); C.legR = leg(C.rig, 0.14, C.hip, 0.07, or, or, 0.2);
      C.style = { legAmp: 0.45, armAmp: 0.2, bob: 0.05, lean: 0.04, twist: 0.05, roll: 0.2, squash: 0.2, tail: 0, ear: 0, cadence: 1.0, flap: true };
    },
  };

  window.makeCharacter = function (type, hue, lean) {
    const root = pv(0, 0, 0), tilt = pv(0, 0, 0, root), spin = pv(0, 0, 0, tilt), rig = pv(0, 0, 0, spin);
    tilt.rotation.x = -lean; rig.scale.setScalar(1.25);
    const C = { root, tilt, spin, rig, eyes: [], ears: [], type, hip: 0.36 };
    C.upper = pv(0, 0.36, 0, rig); // torso pivot at the hips (placeholder; moved below once hip is known)
    BUILD[type](C);
    C.upper.position.y = C.hip;
    // team-colored scarf (+ a fluttering tail) so you can tell whose land you're looking at
    const team = new T.Color().setHSL(hue / 360, 0.75, 0.55);
    const scarf = new T.Mesh(new T.TorusGeometry(C.neckR, 0.07, 8, 22), B(team)); scarf.rotation.x = Math.PI / 2; scarf.position.y = C.neckY; C.upper.add(scarf);
    C.scarfTail = pv(0, C.neckY, -C.neckR * 0.8, C.upper); at(ell(0.07, 0.02, 0.2, B(team)), 0, 0, -0.16, C.scarfTail);
    const ring = new T.Mesh(new T.RingGeometry(0.65, 0.88, 28), B(team, { transparent: true, opacity: 0.85, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; root.add(ring);
    const aura = new T.Mesh(new T.TorusGeometry(1.05, 0.06, 8, 40), B(0xffffff, { transparent: true, opacity: 0.9 }));
    aura.rotation.x = Math.PI / 2; aura.position.y = 0.12; aura.visible = false; root.add(aura);
    const shadow = new T.Mesh(new T.CircleGeometry(0.62, 20), B(0x000000, { transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; root.add(shadow);
    C.aura = aura; C.shadow = shadow;
    return C;
  };

  // ---------------- animation ----------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Returns true on the frame a foot lands (so the caller can spawn a dust puff)
  window.animateCharacter = function (a, dt, now, spd, turnRate) {
    const C = a.g, S = C.style;
    const an = a.an || (a.an = { phase: 0, move: 0, sq: 0, sqv: 0, step: 0, moving: false, blink: 0, nextBlink: now + 1200 + Math.random() * 3000, turn: 0, seed: Math.random() * 100 });
    const sd = an.seed;

    // ease between idle and walking so starts/stops are smooth
    an.move += (Math.min(1, spd / 2.4) - an.move) * Math.min(1, dt * 9);
    const m = an.move;
    an.phase += dt * (7 + spd * 1.7) * S.cadence * m;
    const s0 = Math.sin(an.phase);
    const s = S.stiff ? Math.sign(s0) * Math.pow(Math.abs(s0), 0.7) : s0;

    // footfall -> squash spring impulse + dust
    const stepIdx = Math.floor(an.phase / Math.PI); let landed = false;
    if (stepIdx !== an.step) { an.step = stepIdx; if (m > 0.4 && (!S.hop || stepIdx % 2 === 0)) { an.sqv -= S.squash * 6; landed = m > 0.5; } }
    if (an.moving && m < 0.25) { an.moving = false; an.sqv -= S.squash * 4; }          // settle when stopping
    else if (!an.moving && m > 0.55) { an.moving = true; an.sqv += S.squash * 5; }     // stretch when starting
    an.sqv += (-170 * an.sq - 15 * an.sqv) * dt; an.sq += an.sqv * dt;

    // turning: lean into the turn
    an.turn += (clamp(turnRate * 0.06, -0.4, 0.4) - an.turn) * Math.min(1, dt * 8);

    let bob, extra = 0;
    if (S.hop) { // frog: hops instead of walking
      const hh = Math.max(0, Math.sin(an.phase)), cr = Math.max(0, -Math.sin(an.phase));
      bob = hh * S.bob * m; extra = -cr * 0.16 * m;
      C.legL.rotation.x = C.legR.rotation.x = (hh * 0.9 - cr * 0.25) * m * S.legAmp;
      C.armL.rotation.x = C.armR.rotation.x = -hh * 1.1 * m;
    } else {
      bob = Math.abs(s0) * S.bob * m;
      C.legL.rotation.x = s * S.legAmp * m; C.legR.rotation.x = -s * S.legAmp * m;
      C.legL.position.y = C.hip + Math.max(0, -Math.cos(an.phase)) * 0.07 * m;   // foot lifts while swinging forward
      C.legR.position.y = C.hip + Math.max(0, Math.cos(an.phase)) * 0.07 * m;
      if (S.flap) { C.armL.rotation.x = C.armR.rotation.x = 0; }
      else { C.armL.rotation.x = -s * S.armAmp * m; C.armR.rotation.x = s * S.armAmp * m; }
    }
    // arms: hang slightly out, breathe, flap (penguin)
    const sway = Math.sin(now / 700 + sd) * 0.03 * (1 - m);
    if (S.flap) {
      C.armL.rotation.z = C.armL.userData.bz + Math.max(0, s0) * 0.6 * m + sway; C.armR.rotation.z = C.armR.userData.bz - Math.max(0, -s0) * 0.6 * m - sway;
    } else { C.armL.rotation.z = 0.12 + sway + (S.hop ? 0.2 * m : 0); C.armR.rotation.z = -0.12 - sway - (S.hop ? 0.2 * m : 0); }

    // body
    C.rig.position.y = bob + Math.sin(now / 520 + sd) * 0.012 * (1 - m);
    C.rig.scale.set(1.25 * (1 - (an.sq + extra) * 0.5), 1.25 * (1 + an.sq + extra), 1.25 * (1 - (an.sq + extra) * 0.5));
    C.upper.rotation.x = m * S.lean + Math.sin(an.phase * 2) * 0.025 * m;
    C.upper.rotation.y = -s * S.twist * m * (S.hop ? 0 : 1);
    C.upper.rotation.z = Math.sin(an.phase) * S.roll * m - an.turn * (0.5 + m * 0.5);
    C.upper.scale.y = 1 + Math.sin(now / 520 + sd) * 0.02 * (1 - m * 0.6);       // breathing
    C.head.rotation.y = -C.upper.rotation.y * 0.7 + Math.sin(now / 1900 + sd) * 0.3 * (1 - m);
    C.head.rotation.x = -C.upper.rotation.x * 0.7 + Math.sin(an.phase * 2 + 0.6) * 0.045 * m + Math.sin(now / 1300 + sd) * 0.03;
    C.head.rotation.z = -C.upper.rotation.z * 0.6;

    // secondary motion: tails, ears, antenna, scarf
    if (C.tail) {
      const t = S.tail;
      C.tail.rotation.x = (C.tailBase || 0) + m * 0.25 * t;
      C.tail.rotation.y = Math.sin(an.phase - 0.8) * 0.5 * t * m + Math.sin(now / 260 + sd) * 0.28 * t * (1 - m * 0.4);
      if (C.tail2) C.tail2.rotation.y = Math.sin(an.phase - 1.9) * 0.7 * t * m + Math.sin(now / 300 + sd - 1) * 0.45 * t * (1 - m * 0.4);
    }
    for (let i = 0; i < C.ears.length; i++) {
      const e = C.ears[i];
      e.rotation.x = -m * 0.35 * S.ear + Math.sin(an.phase * 2 - 1) * 0.1 * m * S.ear;
      e.rotation.z = e.userData.bz + (Math.sin(now / 900 + sd + i * 2.1) > 0.97 ? 0.25 * (i ? 1 : -1) : 0); // occasional twitch
    }
    if (C.antenna) { C.antenna.rotation.x = Math.sin(an.phase * 2 + 0.5) * 0.22 * m - an.sqv * 0.04; C.antenna.rotation.z = Math.sin(now / 420 + sd) * 0.06; }
    C.scarfTail.rotation.x = 0.25 + m * 0.5 + Math.sin(an.phase * 2 + 1) * 0.15 * m + Math.sin(now / 350 + sd) * 0.05;
    C.scarfTail.rotation.y = an.turn * 1.2;

    // blinking
    if (now > an.nextBlink) { an.blink = 0.13; an.nextBlink = now + 1800 + Math.random() * 4200; }
    if (an.blink > 0) an.blink -= dt;
    const ey = an.blink > 0 ? 0.1 : 1;
    for (let i = 0; i < C.eyes.length; i++) C.eyes[i].scale.y += (ey - C.eyes[i].scale.y) * Math.min(1, dt * 40);

    C.shadow.scale.setScalar(1 - bob * 1.2);
    return landed;
  };
})();
