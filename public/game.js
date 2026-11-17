// ======================= Territory 3D client (three.js r128) =======================
const $ = id => document.getElementById(id);
const TS = 16; // texture pixels per tile
const LEAN = 35 * Math.PI / 180;  // characters lean back toward the camera so they don't get squashed from above
const PITCH = 66 * Math.PI / 180; // camera angle: 90 = straight down. Flat 2D map, upright 3D characters
let CFG, W = 0, H = 0, owner, def, players = {}, me = 0, myChar = 'fox';
let ws, follow = true, lastAct = 0, cdUsed = 800, started = false;
const round = { n: 1, phase: 'play', endsAt: 0 }; let myRank = null;
let mine = { x: 0, y: 0, kx: 0, ky: 0, tpUntil: 0, ignoreUntil: 0 };
// Lag compensation: the server's position reports are old by the time they arrive, so we compare them with where WE were
// back then (history), and hide whatever small correction is left by letting the picture slide instead of jump (vis).
const hist = [], vis = { x: 0, y: 0 }; let rtt = 120;
const setMine = (x, y) => { mine = { x, y, kx: 0, ky: 0, tpUntil: 0, ignoreUntil: 0 }; hist.length = 0; vis.x = vis.y = 0; };
function histAt(t) { // where we were at client-time t (null if we have no record that old)
  if (hist.length < 2 || t < hist[0][0] || t > hist[hist.length - 1][0]) return null;
  for (let i = hist.length - 1; i > 0; i--) if (hist[i - 1][0] <= t) {
    const a = hist[i - 1], b = hist[i], f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f };
  }
  return null;
}
function correct(cx, cy) { // move our real position, but keep what's on screen where it was
  mine.x += cx; mine.y += cy;
  for (const h of hist) { h[1] += cx; h[2] += cy; }
  if (Math.hypot(cx, cy) > 6) { vis.x = vis.y = 0; } else { vis.x -= cx; vis.y -= cy; }
}
let curMap = null, NEUTRAL = '#1a1f2a', myVote = null, voteCounts = {};
const avatars = {}, pickups = {}, fxUntil = {}; // fxUntil[id][type] = performance.now() expiry
const keys = new Set(); let padDir = [0, 0], sent = '0,0';
let chosenChar = localStorage.getItem('char') || 'fox';
let prog = { wins: 0, total: 0, owned: new Set() }, abReadyAt = 0, abTotal = 1;
const TIER_ORDER = ['starter', 'good', 'great', 'op'];

// ---------- three.js setup ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400); // orthographic = no perspective, so the map stays a flat 2D grid
scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-10, 25, 8); scene.add(sun);
const tgt = new THREE.Vector3(); let dist = 16; // = how many world units tall the screen shows (zoom)
const col = (h, s = 0.6, l = 0.56) => new THREE.Color().setHSL(h / 360, s, l);

let tileCv, tctx, tex, ground, texDirty = false, texLast = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function buildWorld() {
  tileCv = document.createElement('canvas'); tileCv.width = W * TS; tileCv.height = H * TS;
  tctx = tileCv.getContext('2d');
  tex = new THREE.CanvasTexture(tileCv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); scene.add(ground);
  repaintAll();
}


function paintTile(x, y) {
  const i = y * W + x, o = owner[i], p = players[o], d = def[i];
  const px = x * TS, py = y * TS;
  Themes.paintNeutral(tctx, px, py, TS, x, y, curMap || { ground: NEUTRAL }); // the ground itself (water, grass, sand...)
  if (o) { tctx.fillStyle = `hsla(${p ? p.hue : 0},${p ? 62 : 0}%,${p ? 47 : 32}%,0.88)`; tctx.fillRect(px, py, TS, TS); } // team colour on top, terrain still shows through
  tctx.fillStyle = 'rgba(0,0,0,.22)'; // subtle grid line
  tctx.fillRect(px + TS - 1, py, 1, TS); tctx.fillRect(px, py + TS - 1, TS, 1);
  if (o && d > 0) { // shield level = thickness of the light border (1-3), tile also gets lighter
    const t = d * 2;
    tctx.fillStyle = 'rgba(255,255,255,.16)'; tctx.fillRect(px, py, TS, TS);
    tctx.fillStyle = 'rgba(255,255,255,.9)';
    tctx.fillRect(px + 1, py + 1, TS - 3, t); tctx.fillRect(px + 1, py + TS - 2 - t, TS - 3, t);
    tctx.fillRect(px + 1, py + 1, t, TS - 3); tctx.fillRect(px + TS - 2 - t, py + 1, t, TS - 3);
  }
  texDirty = true;
}
function repaintAll() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintTile(x, y);
}
// ---------- helpers (characters live in characters.js) ----------
const lam = (c, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o));
const bas = (c, o = {}) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o));

function textSprite(text, { font = '600 30px system-ui,sans-serif', bubble = false, scale = 0.011 } = {}) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = font; const tw = Math.min(700, Math.ceil(x.measureText(text).width)) + (bubble ? 36 : 20);
  c.width = tw; c.height = bubble ? 64 : 48; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (bubble) { x.fillStyle = 'rgba(255,255,255,.96)'; x.beginPath(); x.roundRect(2, 2, tw - 4, 52, 16); x.fill(); x.fillStyle = '#111'; x.fillText(text, tw / 2, 28, 660); }
  else { x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(text, tw / 2, 26, 660); x.fillStyle = '#fff'; x.fillText(text, tw / 2, 26, 660); }
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.userData = { w: c.width, h: c.height, k: bubble ? 0.5 : 0.55 }; s.scale.set(1, 1, 1); s.renderOrder = 10; return s;
}
function disposeObj(o) {
  o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
}

function ensureAvatar(id) {
  const a = avatars[id], p = players[id]; if (!a || !p) return;
  if (a.char !== p.char || a.hue !== p.hue || a.name !== p.name) {
    if (a.g) { scene.remove(a.g.root); disposeObj(a.g.root); }
    a.g = makeCharacter(p.char, p.hue, LEAN); a.an = null; a.spd = 0; a.orbs = {}; a.char = p.char; a.hue = p.hue; a.name = p.name;
    a.label = textSprite(p.name); a.label.position.set(0, 2.35, 0); a.g.tilt.add(a.label);
    a.g.root.position.set(a.x, 0, a.y); scene.add(a.g.root);
    a.faceT = 0; a.lx = a.x; a.ly = a.y;
  }
}

// ---------- upgrade pickups (3D models live in scenery.js) ----------
function addPickup(k) {
  if (pickups[k.id]) return;
  const info = CFG.pickups[k.type], now = performance.now();
  const o = Scenery.makePickupModel(k.type, info.color, `${info.icon} ${info.name}`, LEAN);
  Object.assign(o, { id: k.id, type: k.type, x: k.x, y: k.y, life: CFG.pickupLife, expAt: now + k.left, born: now, seed: Math.random() * 6 });
  o.group.position.set(k.x, 0, k.y); o.group.scale.setScalar(0.01); scene.add(o.group); pickups[k.id] = o;
  const pin = document.createElement('div'); pin.textContent = info.icon; pin.style.borderColor = info.color; $('pins').appendChild(pin); o.pin = pin;
}
function removePickup(id) {
  const o = pickups[id]; if (!o) return;
  scene.remove(o.group); disposeObj(o.group); o.pin.remove(); delete pickups[id];
}
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// ---------- visual effects ----------
const effects = [];
function burst(x, z, color, size, life = 0.7) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 48), bas(color, { transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.1, z);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), bas(color, { transparent: true, depthWrite: false }));
  flash.position.set(x, 0.6, z); scene.add(ring, flash);
  effects.push({ ring, flash, t: 0, life, size });
}
const sparks = [], SPARK_GEO = new THREE.SphereGeometry(0.09, 6, 5);
function sparkBurst(x, z, color, n = 14, speed = 4) { // little glowing bits that fly out and fall
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(SPARK_GEO, new THREE.MeshBasicMaterial({ color, transparent: true }));
    const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random() * 0.7);
    m.position.set(x, 0.6, z); scene.add(m);
    sparks.push({ m, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 3 + Math.random() * 3, t: 0 });
  }
}
function stepSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.t += dt; s.vy -= 14 * dt;
    s.m.position.x += s.vx * dt; s.m.position.z += s.vz * dt; s.m.position.y = Math.max(0.05, s.m.position.y + s.vy * dt);
    s.m.material.opacity = Math.max(0, 1 - s.t / 0.75);
    if (s.t > 0.75) { scene.remove(s.m); s.m.material.dispose(); sparks.splice(i, 1); }
  }
}
const puffs = [], PUFF_GEO = new THREE.CircleGeometry(0.16, 10);
function spawnPuff(a) { // little dust cloud behind a foot when it lands
  if (puffs.length > 60) return;
  const ang = a.g.spin.rotation.y;
  const m = new THREE.Mesh(PUFF_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(a.x - Math.sin(ang) * 0.3 + (Math.random() - 0.5) * 0.3, 0.07, a.y - Math.cos(ang) * 0.3 + (Math.random() - 0.5) * 0.3);
  scene.add(m); puffs.push({ m, t: 0 });
}
function stepPuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]; p.t += dt; const f = p.t / 0.45;
    if (f >= 1) { scene.remove(p.m); p.m.material.dispose(); puffs.splice(i, 1); continue; }
    const s = 1 + f * 1.8; p.m.scale.set(s, s, s); p.m.material.opacity = 0.4 * (1 - f);
  }
}
function stepEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t += dt; const f = e.t / e.life;
    if (f >= 1) { scene.remove(e.ring, e.flash); disposeObj(e.ring); disposeObj(e.flash); effects.splice(i, 1); continue; }
    const s = 1 + f * e.size; e.ring.scale.set(s, s, s); e.ring.material.opacity = 1 - f;
    const fs = 1 + f * e.size * 0.5; e.flash.scale.set(fs, fs, fs); e.flash.material.opacity = 0.7 * (1 - f);
  }
}

// ---------- stats & boosts (mirrors the server so movement feels instant) ----------
const has = (id, t) => ((fxUntil[id] || {})[t] || 0) > performance.now();
function myStats() {
  const c = CFG.chars[myChar];
  return { speed: CFG.base.speed * (c.speed || 1) * (has(me, 'haste') ? CFG.haste : 1) * (has(me, 'leap') ? CFG.abilities.leap.mult : 1) };
}
function toast(html, color) {
  const t = $('toast'); t.innerHTML = html; t.style.display = 'block'; t.style.borderColor = color || '#2a3140';
  clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 2200);
}

// ---------- login + networking ----------
fetch('/config').then(r => r.json()).then(cfg => {
  CFG = cfg;
  const starters = Object.keys(cfg.chars).filter(k => cfg.chars[k].tier === 'starter');
  prog.owned = new Set(starters);
  try { const b = (localStorage.getItem('save') || '').split('.')[0]; if (b) { const d = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/'))); prog.wins = d.wins | 0; prog.total = d.total | 0; (d.owned || []).forEach(k => cfg.chars[k] && prog.owned.add(k)); } } catch (e) { /* no saved progress yet */ }
  if (!prog.owned.has(chosenChar)) chosenChar = starters[0];
  $('wins').textContent = prog.wins;
  const grid = () => Object.entries(cfg.chars).map(([k, c]) => `<div class="ch tier-${c.tier}${prog.owned.has(k) ? '' : ' locked'}" data-k="${k}">${c.icon}<small>${c.name}</small>${prog.owned.has(k) ? '' : `<i class="lock">🔒${cfg.tiers[c.tier].cost}</i>`}</div>`).join('');
  $('chars').innerHTML = grid();
  const sel = (msg) => {
    [...$('chars').children].forEach(e => e.classList.toggle('sel', e.dataset.k === chosenChar));
    const c = cfg.chars[chosenChar], ab = c.ability && cfg.abilities[c.ability];
    $('perktext').innerHTML = msg || `<b>${c.name}</b> · ${cfg.tiers[c.tier].label}<br>${esc(c.perk)}${ab ? `<br>${ab.icon} Q: <b>${ab.name}</b> - ${esc(ab.desc)}` : ''}`;
  };
  $('chars').onclick = e => {
    const el = e.target.closest('.ch'); if (!el) return; const k = el.dataset.k, c = cfg.chars[k];
    if (!prog.owned.has(k)) { sel(`🔒 <b>${c.name}</b> (${cfg.tiers[c.tier].label}) costs <b>${cfg.tiers[c.tier].cost} wins</b>. Win rounds against other players, then unlock it in the game with <b>C</b>.<br>You have 🏆 ${prog.wins}.`); return; }
    chosenChar = k; localStorage.setItem('char', chosenChar); sel();
  };
  sel();
});
$('name').value = localStorage.getItem('name') || '';
$('go').onclick = () => { if (!CFG) return; localStorage.setItem('name', $('name').value); connect(); $('login').style.display = 'none'; };
$('name').onkeydown = e => { if (e.key === 'Enter') $('go').click(); }; // (must NOT return false for other keys, or the browser swallows every letter you type)
const sendJ = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  clearInterval(connect.ping); connect.ping = setInterval(() => sendJ({ t: 'ping', c: performance.now() }), 1000);
  ws.onopen = () => { sendJ({ t: 'ping', c: performance.now() }); sendJ({ t: 'join', name: $('name').value, token: localStorage.getItem('token'), char: chosenChar, save: localStorage.getItem('save') || undefined }); };
  ws.onclose = () => { clearInterval(connect.ping); flash('Disconnected - reconnecting...'); setTimeout(connect, 2000); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'init') onInit(m);
    else if (m.t === 'tile') {
      const i = m.y * W + m.x; owner[i] = m.o; def[i] = m.d; paintTile(m.x, m.y); updateMine();
    } else if (m.t === 'player') {
      const hueChanged = !players[m.id];
      players[m.id] = { name: m.name, hue: m.hue, char: m.char };
      if (hueChanged && owner) { repaintAll(); }
    } else if (m.t === 'pos') {
      const seen = new Set();
      for (const [id, x, y] of m.p) {
        seen.add(id);
        const a = avatars[id] || (avatars[id] = { x, y });
        a.tx = x; a.ty = y;
        if (Math.hypot(a.x - x, a.y - y) > 4) { a.x = x; a.y = y; a.lx = x; a.ly = y; }
        if (id === me) {
          const nowp = performance.now();
          if (nowp >= mine.ignoreUntil && round.phase === 'play') {
            const h = histAt(nowp - rtt - 25); // the server's snapshot reflects what we were doing about one round-trip ago
            if (h) { const ex = x - h.x, ey = y - h.y, e = Math.hypot(ex, ey); if (e > 0.06) { const k = e > 1.5 ? 1 : 0.25; correct(ex * k, ey * k); } }
          } else if (round.phase !== 'play') { mine.x = x; mine.y = y; vis.x = vis.y = 0; hist.length = 0; }
        }
      }
      for (const id in avatars) if (!seen.has(+id)) { const a = avatars[id]; if (a.g) { scene.remove(a.g.root); disposeObj(a.g.root); } delete avatars[id]; }
    } else if (m.t === 'chat') {
      const a = avatars[m.id]; if (!a || !a.g) return;
      if (a.bubble) { a.g.tilt.remove(a.bubble); disposeObj(a.bubble); }
      a.bubble = textSprite(m.msg, { font: '28px system-ui,sans-serif', bubble: true, scale: 0.0105 });
      a.bubble.position.set(0, 2.9, 0); a.g.tilt.add(a.bubble); a.bubbleUntil = performance.now() + 5000;
    } else if (m.t === 'board') { showBoard(m); round.n = m.n; round.phase = m.phase; round.endsAt = performance.now() + m.left; }
    else if (m.t === 'roundEnd') onRoundEnd(m);
    else if (m.t === 'rank') myRank = m;
    else if (m.t === 'round') onNewRound(m);
    else if (m.t === 'spawn') { setMine(m.x, m.y); tgt.set(m.x, 0, m.y); for (const id in avatars) if (+id === me) { avatars[id].x = m.x; avatars[id].y = m.y; } }
    else if (m.t === 'pong') { rtt = rtt * 0.7 + (performance.now() - m.c) * 0.3; }
    else if (m.t === 'fling') { // start the shove where the server did, and catch up for the time the message spent travelling
      const k = Math.exp(-5 * rtt / 1000);
      correct(m.x - mine.x + m.kx * (1 - k) / 5, m.y - mine.y + m.ky * (1 - k) / 5); // slide (not jump) to where the shove has already carried us
      mine.kx = m.kx * k; mine.ky = m.ky * k; hist.length = 0;
    }
    else if (m.t === 'portalfx') {
      const c = new THREE.Color(m.color);
      burst(m.from.x, m.from.y, c, 3, 0.5); burst(m.to.x, m.to.y, c, 3, 0.6); sparkBurst(m.from.x, m.from.y, c, 10, 3); sparkBurst(m.to.x, m.to.y, c, 10, 3);
    } else if (m.t === 'vortexfx') { burst(m.x, m.y, new THREE.Color('#b07bff'), 4, 0.6); sparkBurst(m.x, m.y, new THREE.Color('#d9c2ff'), 12, 5); }
    else if (m.t === 'votes') { voteCounts = m.counts; updateVotes(); }
    else if (m.t === 'err') { flash(m.msg); if ($('chpanel').style.display === 'block') toast('⚠️ ' + m.msg, '#ff6b6b'); }
    else if (m.t === 'ok') { lastAct = performance.now(); cdUsed = m.cd; }
    else if (m.t === 'prog') applyProg(m);
    else if (m.t === 'unlocked') { const c = CFG.chars[m.char]; toast(`🔓 <b>${c.name}</b> unlocked! <span style="font-weight:400;font-size:13px">Pick it in Characters (C) between rounds</span>`, '#ffc83d'); sparkBurst(mine.x, mine.y, new THREE.Color('#ffd23f'), 24, 6); }
    else if (m.t === 'ab') { abTotal = Math.max(1, m.cd); abReadyAt = performance.now() + m.cd; }
    else if (m.t === 'blink') { mine.x = m.x; mine.y = m.y; mine.kx = mine.ky = 0; hist.length = 0; vis.x = vis.y = 0; mine.ignoreUntil = performance.now() + 400; tgt.x = m.x; tgt.z = m.y; }
    else if (m.t === 'abfx') {
      if (m.kind === 'leap') sparkBurst(m.x, m.y, new THREE.Color('#9be8ff'), 12, 4);
      else if (m.kind === 'blink') { const c = new THREE.Color('#e6a8ff'); burst(m.x, m.y, c, 3, 0.5); burst(m.x2, m.y2, c, 3, 0.5); sparkBurst(m.x, m.y, c, 10, 4); sparkBurst(m.x2, m.y2, c, 14, 5); }
      else if (m.kind === 'shockwave') { const c = new THREE.Color('#7fd6ff'); burst(m.x, m.y, c, m.r * 1.8, 0.7); burst(m.x, m.y, c, m.r * 1.2, 0.5); sparkBurst(m.x, m.y, c, 22, m.r * 1.5); }
      else if (m.kind === 'inferno') { const c = new THREE.Color('#ff7a2a'); burst(m.x, m.y, c, m.r * 2, 0.8); burst(m.x, m.y, new THREE.Color('#ffd23f'), m.r, 0.5); sparkBurst(m.x, m.y, c, 30, m.r * 1.6); }
    }
    else if (m.t === 'pickup+') addPickup(m);
    else if (m.t === 'pickup-') {
      const o = pickups[m.id];
      if (o && m.by) { const c = new THREE.Color(CFG.pickups[o.type].color); burst(o.x, o.y, c, 3, 0.5); sparkBurst(o.x, o.y, c, 16, 4.5); }
      removePickup(m.id);
    } else if (m.t === 'fx') {
      const now = performance.now(); fxUntil[m.id] = {};
      for (const [k, left] of Object.entries(m.fx)) fxUntil[m.id][k] = now + left;
    } else if (m.t === 'got') {
      const info = CFG.pickups[m.type];
      toast(`${info.icon} ${info.name}! <span style="font-weight:400;font-size:13px">${info.desc}</span>`, info.color);
    } else if (m.t === 'boom') { const c = new THREE.Color(CFG.pickups.boom.color); burst(m.x, m.y, c, 7, 0.8); sparkBurst(m.x, m.y, c, 28, 7); }
  };
}

function onInit(m) {
  ({ w: W, h: H } = m); me = m.you; myChar = m.char; players = m.players;
  localStorage.setItem('token', m.token);
  owner = Uint16Array.from(m.owner); def = Uint8Array.from(m.def);
  setMap(m.map);
  if (!started) buildWorld(); else repaintAll();
  if (lowGfx) setLowGfx(true);
  for (const k of m.pickups) addPickup(k);
  voteCounts = m.votes || {}; myVote = null;
  const now = performance.now();
  for (const [id, fx] of Object.entries(m.fx)) { fxUntil[id] = {}; for (const [k, l] of Object.entries(fx)) fxUntil[id][k] = now + l; }
  setMine(m.x, m.y); tgt.set(m.x, 0, m.y); sent = '0,0';
  round.n = m.round.n; round.phase = m.round.phase; round.endsAt = performance.now() + m.round.left; myRank = null;
  if (m.results) showResults(m.results); else $('results').style.display = 'none';
  applyProg(m.prog); describeChar(); abReadyAt = 0;
  updateMine();
  if (!started) { started = true; last = performance.now(); requestAnimationFrame(frame); }
}
function setMap(id) {
  curMap = Shared.MAPS[id] || Shared.MAPS[Shared.MAP_IDS[0]]; NEUTRAL = curMap.ground;
  Scenery.buildMap(scene, curMap, LEAN);
  $('mapname').textContent = curMap.icon + ' ' + curMap.name;
  if (tctx && owner) repaintAll();
}
function voteTags(mp) { return mp.tag; }
function updateVotes() {
  document.querySelectorAll('.vc').forEach(el => { el.classList.toggle('sel', el.dataset.m === myVote); el.querySelector('.cnt').textContent = voteCounts[el.dataset.m] || 0; });
}
function vote(id) { if (round.phase !== 'results' || !Shared.MAPS[id]) return; myVote = id; sendJ({ t: 'vote', map: id }); updateVotes(); }
function describeChar() {
  const c = CFG.chars[myChar], ab = c.ability && CFG.abilities[c.ability];
  $('me').textContent = `${c.icon} ${c.name}`; $('perk').textContent = c.perk + (ab ? `  ·  Q: ${ab.icon} ${ab.name}` : '');
  $('abbtn').style.display = ab ? 'flex' : 'none'; if (ab) $('abbtn').querySelector('.abico').textContent = ab.icon;
}
function applyProg(m) {
  prog.wins = m.wins; prog.total = m.total; prog.owned = new Set(m.owned);
  if (m.save) { try { localStorage.setItem('save', m.save); } catch (e) { /* private mode */ } }
  $('wins').textContent = m.wins;
  if (m.char && m.char !== myChar) { myChar = m.char; localStorage.setItem('char', myChar); if (CFG) describeChar(); }
  if ($('chpanel').style.display === 'block') renderChars();
}
function renderChars() {
  $('chwins').textContent = prog.wins;
  const keys = Object.keys(CFG.chars).sort((a, b) => TIER_ORDER.indexOf(CFG.chars[a].tier) - TIER_ORDER.indexOf(CFG.chars[b].tier));
  $('chgrid').innerHTML = keys.map(k => {
    const c = CFG.chars[k], t = CFG.tiers[c.tier], owned = prog.owned.has(k), eq = myChar === k, ab = c.ability && CFG.abilities[c.ability];
    const btn = eq ? '<button disabled class="eq">✔ In use</button>' : owned ? `<button data-a="equip" data-k="${k}">Use this one</button>`
      : prog.wins >= t.cost ? `<button data-a="unlock" data-k="${k}" class="buy">Unlock · 🏆 ${t.cost}</button>` : `<button disabled>🔒 Needs ${t.cost} wins (${t.cost - prog.wins} more)</button>`;
    return `<div class="cc tier-${c.tier}${owned ? ' owned' : ''}${eq ? ' eq' : ''}"><div class="cc-top"><span class="cc-ico">${c.icon}</span><div><b>${c.name}</b><span class="badge">${t.label}${t.cost ? ' · 🏆' + t.cost : ' · free'}</span></div></div><p class="perk">${esc(c.perk)}</p>${ab ? `<p class="abil">${ab.icon} <b>Q: ${ab.name}</b> - ${esc(ab.desc)} <i>(${Math.round(ab.cd / 1000)}s cooldown)</i></p>` : ''}${btn}</div>`;
  }).join('');
}
function toggleChars(on) { const p = $('chpanel'), show = on === undefined ? p.style.display !== 'block' : on; p.style.display = show ? 'block' : 'none'; if (show) { renderChars(); $('rename').value = players[me] ? players[me].name : ($('name').value || ''); } }
$('renamebtn').onclick = () => { const v = $('rename').value.trim(); if (v) { sendJ({ t: 'rename', name: v }); localStorage.setItem('name', v); $('name').value = v; toast('✏️ Name changed to <b>' + esc(v) + '</b>', '#5aa9ff'); } };
$('rename').onkeydown = e => { if (e.key === 'Enter') $('renamebtn').click(); };
$('chbtn').onclick = () => toggleChars(); $('chclose').onclick = () => toggleChars(false);
$('chgrid').onclick = e => { const b = e.target.closest('button[data-a]'); if (b) sendJ({ t: b.dataset.a, char: b.dataset.k }); };
$('abbtn').onpointerdown = e => { e.preventDefault(); sendJ({ t: 'ability' }); };
function showResults(r) {
  const top = r.board, win = top[0];
  const rows = top.slice(0, 5).map((p, i) => `<div class="row${p.id === me ? ' you' : ''}"><b>${['🥇', '🥈', '🥉', '4', '5'][i]}</b><span class="dot" style="background:hsl(${p.hue},65%,52%)"></span><span class="n">${esc(p.name)}</span><b>${p.count}</b><span style="color:#8b95a8;width:42px;text-align:right">${Math.round(p.count / r.total * 100)}%</span></div>`).join('');
  const mineRow = top.findIndex(p => p.id === me);
  const youLine = mineRow >= 0 ? (mineRow === 0 ? '🎉 <b>You won!</b>' : `You finished #${mineRow + 1}`) : (myRank && myRank.rank ? `You finished #${myRank.rank} with ${myRank.count} tiles` : 'You didn\'t claim any tiles');
  voteCounts = r.counts || {}; myVote = null;
  const extra = r.awarded === me ? `<div class="award">🏆 <b>+1 win!</b> You now have ${prog.wins} to spend - press <b>C</b> for Characters</div>` : r.solo ? '<div class="solo">Solo round: wins only count when 2+ players take part</div>' : '';
  const cards = Shared.MAP_IDS.map((id, i) => { const mp = Shared.MAPS[id];
    return `<div class="vc" data-m="${id}"><span class="key">${i + 1}</span><span class="cnt">0</span><canvas width="160" height="160"></canvas><b>${mp.icon} ${mp.name}</b><small>${voteTags(mp)}</small></div>`; }).join('');
  $('results').innerHTML = `<h2>Round ${r.n} complete</h2>` + (win ? `<div class="win">🏆 <b>${esc(win.name)}</b> wins with ${win.count} tiles!</div>${rows}` : '<div class="win">Nobody claimed anything!</div>') +
    `<div style="margin-top:8px">${youLine}</div>${extra}<div class="votehdr">Vote for the next map</div><div id="vote">${cards}</div><div class="next">Next round in <b id="nextin">12</b>s</div>`;
  document.querySelectorAll('.vc').forEach(el => { Scenery.drawPreview(el.querySelector('canvas'), Shared.MAPS[el.dataset.m]); el.onclick = () => vote(el.dataset.m); });
  updateVotes();
  $('results').style.display = 'block';
}
function onRoundEnd(m) {
  round.phase = 'results'; round.endsAt = performance.now() + m.next;
  for (const id in pickups) removePickup(id);
  keys.clear(); padDir = [0, 0];
  setTimeout(() => showResults(m), 250); // let the last tiles settle on screen first
}
function onNewRound(m) {
  if (m.map) setMap(m.map); myVote = null;
  round.n = m.n; round.phase = 'play'; round.endsAt = performance.now() + m.left; myRank = null;
  owner.fill(0); def.fill(0); repaintAll(); updateMine();
  for (const id in pickups) removePickup(id);
  for (const id in fxUntil) delete fxUntil[id];
  $('results').style.display = 'none'; sent = '0,0'; follow = true; syncDir();
  toast('🏁 Round ' + m.n + ' - GO!', '#66ff99');
}
function updateMine() { let n = 0; for (let i = 0; i < owner.length; i++) if (owner[i] === me) n++; $('mine').textContent = n; }

// ---------- input ----------
function curDir() {
  let dx = padDir[0], dy = padDir[1];
  if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d')) dx += 1;
  if (keys.has('arrowup') || keys.has('w')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) dy += 1;
  return [Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy))];
}
function syncDir() {
  const d = curDir(), s = d.join(',');
  if (s !== sent) { sent = s; sendJ({ t: 'move', dx: d[0], dy: d[1] }); if (s !== '0,0') follow = true; }
}
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (document.activeElement === $('chatin')) {
    if (e.key === 'Enter') { const v = $('chatin').value.trim(); if (v) sendJ({ t: 'chat', msg: v }); $('chatin').value = ''; $('chatin').blur(); }
    else if (e.key === 'Escape') $('chatin').blur();
    return;
  }
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return; // typing in any text box: no game hotkeys
  if ($('results').style.display === 'block' && ['1', '2', '3'].includes(e.key)) { vote(Shared.MAP_IDS[+e.key - 1]); return; }
  if (e.key === 'Enter') { e.preventDefault(); $('chatin').focus(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) sendJ({ t: 'fort' }); return; }
  if (k === 'q' && !e.repeat) { sendJ({ t: 'ability' }); return; }
  if (k === 'c' && !e.repeat) { toggleChars(); return; }
  if (e.key === 'Escape' && $('chpanel').style.display === 'block') { toggleChars(false); return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); syncDir(); }
});
addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); syncDir(); });
addEventListener('blur', () => { keys.clear(); padDir = [0, 0]; syncDir(); });
$('fortbtn').onpointerdown = e => { e.preventDefault(); sendJ({ t: 'fort' }); };
document.querySelectorAll('#pad b').forEach(b => {
  const d = b.dataset.d.split(',').map(Number);
  b.onpointerdown = e => { e.preventDefault(); if (d[0]) padDir[0] = d[0]; if (d[1]) padDir[1] = d[1]; syncDir(); };
  const up = () => { if (d[0]) padDir[0] = 0; if (d[1]) padDir[1] = 0; syncDir(); };
  b.onpointerup = b.onpointerleave = b.onpointercancel = up;
});

let drag = null; const ptrs = new Map(); let pinch = 0;
const cv = $('c');
cv.onpointerdown = e => {
  ptrs.set(e.pointerId, [e.clientX, e.clientY]); cv.setPointerCapture(e.pointerId);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = null; return; }
  drag = { sx: e.clientX, sy: e.clientY, moved: false, tx: tgt.x, tz: tgt.z };
};
cv.onpointermove = e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); dist = Math.max(8, Math.min(60, dist * pinch / d)); pinch = d; return; }
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 6) { drag.moved = true; follow = false; }
  if (drag.moved) { const k = dist / innerHeight; tgt.x = Math.max(0, Math.min(W, drag.tx - dx * k)); tgt.z = Math.max(0, Math.min(H, drag.tz - dy * k / Math.sin(PITCH))); }
};
cv.onpointerup = cv.onpointercancel = e => {
  ptrs.delete(e.pointerId);
  drag = null;
};
cv.onwheel = e => { e.preventDefault(); dist = Math.max(8, Math.min(60, dist * (e.deltaY < 0 ? 0.9 : 1.1))); };

// ---------- main loop ----------
let last = 0, fxHtml = '', fpsEma = 60, slowFor = 0, lowGfx = /[?&]low=1/.test(location.search);
function setLowGfx(on, why) {
  lowGfx = on; Scenery.setLow(on); renderer.setPixelRatio(on ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  if (why) toast('🐢 Low graphics on: ' + why + ' <span style="font-weight:400;font-size:13px">(add ?low=0 to the address to keep them on)</span>', '#ffd23f');
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  { const inst = 1 / Math.max(0.001, (now - (frame.prev || now - 16)) / 1000); frame.prev = now; fpsEma += (Math.min(inst, 90) - fpsEma) * 0.05; // smoothed frames-per-second
    if (!lowGfx && !/[?&]low=0/.test(location.search) && round.phase === 'play') { slowFor = fpsEma < 26 ? slowFor + dt : Math.max(0, slowFor - dt * 2); if (slowFor > 4) { setLowGfx(true, 'your device was struggling'); slowFor = 0; } } }
  if (renderer.domElement.width !== Math.floor(innerWidth * renderer.getPixelRatio())) {
    renderer.setSize(innerWidth, innerHeight, false);
  }
  { const hh = dist / 2, hw = hh * innerWidth / innerHeight; if (camera.top !== hh || camera.right !== hw) { camera.top = hh; camera.bottom = -hh; camera.right = hw; camera.left = -hw; camera.updateProjectionMatrix(); } }
  const st = myStats(), d = curDir();
  if (round.phase === 'play') {
    for (const ev of Shared.step(curMap, mine, dt, d[0], d[1], st.speed, now)) if (ev.tp) { mine.ignoreUntil = now + 600; vis.x = vis.y = 0; hist.length = 0; }
    hist.push([now, mine.x, mine.y]); while (hist.length > 2 && hist[0][0] < now - 1500) hist.shift();
  }
  const dk = Math.exp(-dt * 10); vis.x *= dk; vis.y *= dk; // any leftover correction melts away in ~0.2s
  // avatars
  for (const id in avatars) {
    const a = avatars[id]; ensureAvatar(+id); if (!a.g) continue;
    if (+id === me) { a.x = mine.x + vis.x; a.y = mine.y + vis.y; }
    else if (a.tx !== undefined) { a.x += (a.tx - a.x) * Math.min(1, dt * 12); a.y += (a.ty - a.y) * Math.min(1, dt * 12); }
    let vx = a.x - a.lx, vy = a.y - a.ly;
    if (Math.hypot(vx, vy) > 2) vx = vy = 0; // teleport / respawn / portal: a jump isn't running, don't animate it as speed
    const sp = Math.min(14, Math.hypot(vx, vy) / Math.max(dt, 0.001));
    a.lx = a.x; a.ly = a.y;
    a.spd += (sp - a.spd) * Math.min(1, dt * 10); // smoothed speed so animation doesn't jitter between network updates
    if (sp > 0.6) a.faceT = Math.atan2(vx, vy);
    const prevYaw = a.g.spin.rotation.y;
    let diff = ((a.faceT || 0) - prevYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    a.g.spin.rotation.y += diff * Math.min(1, dt * 12);
    const turnRate = (a.g.spin.rotation.y - prevYaw) / Math.max(dt, 0.001);
    if (animateCharacter(a, dt, now, a.spd, turnRate) && Math.abs(a.x - tgt.x) < dist * 1.2 && Math.abs(a.y - tgt.z) < dist * 1.4) spawnPuff(a);
    a.g.root.position.set(a.x, 0, a.y);
    a.g.root.visible = Math.abs(a.x - tgt.x) < dist * 1.2 && Math.abs(a.y - tgt.z) < dist * 1.4;
    // boost aura
    const fx = fxUntil[id] || {}, act = Object.keys(fx).filter(k => fx[k] > now);
    a.g.aura.visible = act.length > 0;
    if (act.length) { a.g.aura.material.color.set(CFG.pickups[act[0]].color); const s = 1 + Math.sin(now / 150) * 0.08; a.g.aura.scale.set(s, s, s); }
    a.orbs = a.orbs || {};
    for (const k of Object.keys(a.orbs)) if (!(fx[k] > now)) { a.g.root.remove(a.orbs[k]); disposeObj(a.orbs[k]); delete a.orbs[k]; }
    act.forEach((k, i) => {
      if (!a.orbs[k]) { a.orbs[k] = textSprite(CFG.pickups[k].icon, { font: '44px sans-serif' }); a.orbs[k].userData.k = 0.45; a.g.root.add(a.orbs[k]); }
      const ang = now / 520 + i * (Math.PI * 2 / act.length); a.orbs[k].position.set(Math.cos(ang) * 1.05, 1.55 + Math.sin(now / 300 + i) * 0.08, Math.sin(ang) * 0.85);
    });
    if (a.bubble && now > a.bubbleUntil) { a.g.tilt.remove(a.bubble); disposeObj(a.bubble); a.bubble = null; }
    if (a.bubble) a.bubble.position.y = 2.35 + 46 * (dist / innerHeight); // keep the bubble just above the name at any zoom
  }
  // camera
  if (follow) { tgt.x += (mine.x + vis.x - tgt.x) * Math.min(1, dt * 8); tgt.z += (mine.y + vis.y - tgt.z) * Math.min(1, dt * 8); }
  camera.position.set(tgt.x, 80 * Math.sin(PITCH), tgt.z + 80 * Math.cos(PITCH)); camera.lookAt(tgt.x, 0, tgt.z);
  camera.updateMatrixWorld();
  const upp = dist / innerHeight; // world units per screen pixel: keeps text the same size at any zoom
  scene.traverse(o => { if (o.isSprite && o.userData.w) o.scale.set(o.userData.w * upp * o.userData.k, o.userData.h * upp * o.userData.k, 1); });
  // upgrades: pop-in, spin/bob, countdown ring, name tag when close, edge pins
  for (const id in pickups) {
    const o = pickups[id], left = o.expAt - now, f = Math.max(0, Math.min(1, left / o.life)), age = (now - o.born) / 1000;
    o.group.scale.setScalar(age < 0.4 ? Math.max(0.01, easeOutBack(age / 0.4)) : 1);
    o.update(now, o.seed); o.setTimer(f);
    o.group.visible = left > 3000 || Math.floor(now / 140) % 2 === 0; // blink when about to vanish
    o.tag.visible = Math.hypot(o.x - mine.x, o.y - mine.y) < 5.5;
    _p.set(o.x, 1.2, o.y).project(camera);
    const off = Math.abs(_p.x) > 0.93 || Math.abs(_p.y) > 0.9 || _p.z > 1;
    if (off) {
      let sx = _p.x, sy = _p.y; if (_p.z > 1) { sx = -sx; sy = -sy; }
      const k = Math.max(Math.abs(sx) / 0.93, Math.abs(sy) / 0.9, 1); sx /= k; sy /= k;
      o.pin.style.display = 'flex'; o.pin.style.left = (sx * 0.5 + 0.5) * innerWidth + 'px'; o.pin.style.top = (-sy * 0.5 + 0.5) * innerHeight + 'px';
      o.pin.style.opacity = o.group.visible ? 1 : 0.3; o.pin.style.transform = `translate(-50%,-50%) scale(${1 + Math.sin(now / 200) * 0.06})`;
    } else o.pin.style.display = 'none';
  }
  stepEffects(dt); stepPuffs(dt); stepSparks(dt); Scenery.updateMap(dt, now);
  // upload map texture at most ~10x per second
  if (texDirty && now - texLast > 100) { tex.needsUpdate = true; texDirty = false; texLast = now; }
  renderer.render(scene, camera);
  // HUD
  { const left = Math.max(0, Math.ceil((round.endsAt - now) / 1000)), txt = round.phase === 'play' ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'TIME!';
    if ($('clock').textContent !== txt) $('clock').textContent = txt;
    $('timer').classList.toggle('low', round.phase === 'play' && left <= 10);
    $('roundn').textContent = 'Round ' + round.n;
    const ni = $('nextin'); if (ni && round.phase !== 'play') ni.textContent = left; }
  $('fill').style.width = Math.min(1, (now - lastAct) / cdUsed) * 100 + '%';
  { const ab = $('abbtn'); if (ab.style.display !== 'none') { const left = Math.max(0, abReadyAt - now); ab.style.setProperty('--p', (left <= 0 ? 360 : (1 - left / abTotal) * 360) + 'deg'); ab.classList.toggle('ready', left <= 0 && round.phase === 'play'); } }
  updateChips(now);
  requestAnimationFrame(frame);
}

const chipEls = {};
function updateChips(now) {
  const want = {}, fx = fxUntil[me] || {};
  for (const k in fx) if (fx[k] > now) { const i = CFG.pickups[k]; want['fx:' + k] = { icon: i.icon, name: i.name, color: i.color, t: Math.ceil((fx[k] - now) / 1000) + 's', frac: (fx[k] - now) / (CFG.pickups[k].dur || CFG.boostMs * (CFG.chars[myChar].fxMult || 1)) }; }
  if (curMap && round.phase === 'play') {
    const zs = Shared.zonesAt(curMap, mine.x, mine.y);
    const lane = Shared.laneAt(curMap, mine.x, mine.y);
    if (lane) {
      const dd = curDir(), l = Math.hypot(dd[0], dd[1]), m = l ? Shared.laneMult(lane, dd[0] / l, dd[1] / l) : 1, arrow = { 'x+': '→', 'x-': '←', 'y+': '↓', 'y-': '↑' }[lane.dir];
      want['z:speed'] = !l ? { icon: '⚡', name: 'Boost lane ' + arrow, color: '#9dff4f', t: '' }
        : m > 1.05 ? { icon: '⚡', name: 'Boost lane ' + arrow, color: '#9dff4f', t: '×' + m.toFixed(1) }
        : m < 0.95 ? { icon: '⛔', name: 'Against the lane!', color: '#ff6b6b', t: '×' + m.toFixed(1) }
        : { icon: '↔', name: 'Crossing the lane', color: '#c8d0dc', t: '' };
    }
    if (zs.includes('slow')) want['z:slow'] = { icon: '🐌', name: curMap.theme === 'swamp' ? 'Sticky mud' : 'Mud', color: curMap.theme === 'swamp' ? '#d9a56a' : '#c98be6', t: '×0.5' };
    if (Shared.vortexAt(curMap, mine.x, mine.y)) want['z:vortex'] = { icon: '🌪️', name: curMap.theme === 'ocean' ? 'Whirlpool pulling you!' : 'Vortex pulling you!', color: '#b07bff', t: '' };
  }
  for (const k in chipEls) if (!want[k]) { chipEls[k].remove(); delete chipEls[k]; }
  for (const k in want) {
    const w = want[k]; let el = chipEls[k];
    if (!el) {
      el = chipEls[k] = document.createElement('div'); el.className = 'chip';
      el.innerHTML = `<span class="ico">${w.icon}</span><div class="mid"><b>${w.name}</b><div class="bar"><u></u></div></div><span class="t"></span>`;
      $('fx').appendChild(el);
    }
    el.style.setProperty('--c', w.color); el.querySelector('.ico').textContent = w.icon; el.querySelector('.mid b').textContent = w.name;
    el.querySelector('.t').textContent = w.t;
    const bar = el.querySelector('.bar'); bar.style.display = w.frac === undefined ? 'none' : 'block';
    if (w.frac !== undefined) el.querySelector('u').style.width = Math.max(0, Math.min(1, w.frac)) * 100 + '%';
  }
}
function showBoard(m) {
  $('online').textContent = m.online;
  $('rows').innerHTML = m.board.map(r =>
    `<div><span class="dot" style="background:hsl(${r.hue},65%,52%)"></span><span class="n">${esc(r.name)}${r.id === me ? ' (you)' : ''}</span><b>${r.count}</b></div>`).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ft; function flash(t) { $('msg').textContent = t; clearTimeout(ft); ft = setTimeout(() => $('msg').textContent = '', 1500); }
