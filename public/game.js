// ======================= Territory 3D client (three.js r128) =======================
const $ = id => document.getElementById(id);
const TS = 12; // texture pixels per tile
let CFG, W = 0, H = 0, owner, def, players = {}, me = 0, myChar = 'fox';
let ws, follow = true, lastAct = 0, cdUsed = 800, started = false;
let mine = { x: 0, y: 0 };
const avatars = {}, pickups = {}, fxUntil = {}; // fxUntil[id][type] = performance.now() expiry
const keys = new Set(); let padDir = [0, 0], sent = '0,0';
let chosenChar = localStorage.getItem('char') || 'fox';

// ---------- three.js setup ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
scene.fog = new THREE.Fog(0x0a0d12, 45, 95);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-10, 25, 8); scene.add(sun);
const tgt = new THREE.Vector3(); let dist = 10;
const col = (h, s = 0.6, l = 0.56) => new THREE.Color().setHSL(h / 360, s, l);

let tileCv, tctx, tex, ground, blocks, texDirty = false, texLast = 0, blkDirty = false;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function buildWorld() {
  tileCv = document.createElement('canvas'); tileCv.width = W * TS; tileCv.height = H * TS;
  tctx = tileCv.getContext('2d');
  tex = new THREE.CanvasTexture(tileCv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); scene.add(ground);
  blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), W * H);
  blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); blocks.frustumCulled = false;
  scene.add(blocks);
  for (let i = 0; i < W * H; i++) setBlock(i, true);
  repaintAll();
}


function paintTile(x, y) {
  const o = owner[y * W + x], p = players[o];
  tctx.fillStyle = o ? `hsl(${p ? p.hue : 0},${p ? 60 : 0}%,${p ? 46 : 32}%)` : '#1a1f2a';
  tctx.fillRect(x * TS, y * TS, TS, TS);
  tctx.fillStyle = 'rgba(0,0,0,.28)';
  tctx.fillRect(x * TS + TS - 1, y * TS, 1, TS); tctx.fillRect(x * TS, y * TS + TS - 1, TS, 1);
  texDirty = true;
}
function repaintAll() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintTile(x, y);
  for (let i = 0; i < W * H; i++) if (def[i]) setBlock(i);
}
function setBlock(i, init) { // raised block = fortification level
  const d = def[i], o = owner[i], x = i % W, y = (i / W) | 0;
  if (!d || !o) { _m.makeScale(0, 0, 0); }
  else { const h = 0.22 * d; _m.compose(_p.set(x + 0.5, h / 2, y + 0.5), _q.set(0, 0, 0, 1), _s.set(0.86, h, 0.86)); }
  blocks.setMatrixAt(i, _m);
  const p = players[o]; blocks.setColorAt(i, p ? _c.setHSL(p.hue / 360, 0.6, 0.66) : _c.set(0x888888));
  blkDirty = true;
}

// ---------- 3D characters (built from simple shapes) ----------
const lam = (c, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o));
const bas = (c, o = {}) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o));
const sph = (r, mat, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat); m.scale.set(sx, sy, sz); return m; };
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const cone = (r, h, mat) => new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), mat);
const cyl = (r, h, mat) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
const put = (m, x, y, z, parent) => { m.position.set(x, y, z); parent.add(m); return m; };

function makeCharacter(type, hue) {
  const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig);
  const team = col(hue, 0.75, 0.55);
  const black = lam(0x15171c), white = lam(0xffffff);
  const eyes = (parent, y, z, sx = 0.12, r = 0.045) => { put(sph(r, black), -sx, y, z, parent); put(sph(r, black), sx, y, z, parent); };
  let legMat = lam(0x777777), legL, legR, legs = (w, h) => {
    legL = new THREE.Group(); legR = new THREE.Group();
    put(box(w, h, w, legMat), 0, -h / 2, 0, legL); put(box(w, h, w, legMat), 0, -h / 2, 0, legR);
    put(legL, -0.17, 0.32, 0, rig); put(legR, 0.17, 0.32, 0, rig);
  };
  if (type === 'fox') {
    const o = lam(0xe8833a), w = lam(0xfff1e0); legMat = lam(0x3a2a22); legs(0.15, 0.3);
    put(sph(0.4, o, 1, 1.05, 0.9), 0, 0.62, 0, rig); put(sph(0.27, w, 0.9, 1, 0.5), 0, 0.6, 0.28, rig);
    const head = put(sph(0.33, o), 0, 1.2, 0, rig);
    put(sph(0.16, w, 1, 0.8, 1), 0, -0.07, 0.28, head); put(sph(0.04, black), 0, -0.02, 0.43, head); eyes(head, 0.06, 0.29);
    const e1 = put(cone(0.1, 0.3, o), -0.18, 0.36, 0, head), e2 = put(cone(0.1, 0.3, o), 0.18, 0.36, 0, head); e1.rotation.z = 0.25; e2.rotation.z = -0.25;
    const tail = put(cone(0.16, 0.6, o), 0, 0.5, -0.45, rig); tail.rotation.x = -1.9; put(sph(0.1, w), 0, -0.32, 0, tail);
  } else if (type === 'cat') {
    const g = lam(0x8d95a6), w = lam(0xe9ecf2), pink = lam(0xffa6b8); legMat = lam(0x6b7384); legs(0.14, 0.3);
    put(sph(0.38, g, 1, 1.05, 0.9), 0, 0.62, 0, rig); put(sph(0.24, w, 0.9, 1, 0.5), 0, 0.6, 0.28, rig);
    const head = put(sph(0.33, g), 0, 1.2, 0, rig); eyes(head, 0.04, 0.29, 0.13, 0.05);
    put(sph(0.035, pink), 0, -0.05, 0.33, head);
    const e1 = put(cone(0.11, 0.26, g), -0.2, 0.33, 0, head), e2 = put(cone(0.11, 0.26, g), 0.2, 0.33, 0, head); e1.rotation.z = 0.3; e2.rotation.z = -0.3;
    const tail = put(cyl(0.05, 0.7, g), 0, 0.85, -0.42, rig); tail.rotation.x = -0.6;
  } else if (type === 'frog') {
    const g = lam(0x58b95a), lg = lam(0xbfe9a0); legMat = lam(0x3f8f42); legs(0.17, 0.28);
    put(sph(0.43, g, 1.05, 0.95, 0.95), 0, 0.58, 0, rig); put(sph(0.3, lg, 0.9, 0.9, 0.5), 0, 0.52, 0.28, rig);
    const head = put(sph(0.36, g, 1.15, 0.8, 1), 0, 1.12, 0.02, rig);
    for (const s of [-1, 1]) { const eb = put(sph(0.14, g), 0.2 * s, 0.26, 0.04, head); put(sph(0.1, white), 0, 0.04, 0.07, eb); put(sph(0.05, black), 0, 0.04, 0.15, eb); }
    put(box(0.4, 0.03, 0.05, lam(0x2c6b2f)), 0, -0.1, 0.33, head);
  } else if (type === 'panda') {
    const w = lam(0xf5f5f5); legMat = black; legs(0.17, 0.3);
    put(sph(0.42, w, 1, 1.05, 0.92), 0, 0.62, 0, rig);
    put(sph(0.15, black, 1, 1, 0.6), -0.37, 0.7, 0.1, rig); put(sph(0.15, black, 1, 1, 0.6), 0.37, 0.7, 0.1, rig);
    const head = put(sph(0.35, w), 0, 1.2, 0, rig);
    put(sph(0.12, black, 1, 1.2, 0.5), -0.14, 0.05, 0.29, head); put(sph(0.12, black, 1, 1.2, 0.5), 0.14, 0.05, 0.29, head);
    put(sph(0.035, white), -0.14, 0.07, 0.35, head); put(sph(0.035, white), 0.14, 0.07, 0.35, head);
    put(sph(0.05, black, 1.2, 0.8, 1), 0, -0.08, 0.34, head);
    put(sph(0.12, black), -0.26, 0.28, 0, head); put(sph(0.12, black), 0.26, 0.28, 0, head);
  } else if (type === 'robot') {
    const g = lam(0xb7c0cc), dk = lam(0x4b5563), glow = bas(0x38e8ff); legMat = dk; legs(0.16, 0.3);
    put(box(0.66, 0.6, 0.5, g), 0, 0.62, 0, rig); put(box(0.3, 0.16, 0.02, bas(0x38e8ff)), 0, 0.64, 0.26, rig);
    put(box(0.14, 0.4, 0.14, dk), -0.42, 0.62, 0, rig); put(box(0.14, 0.4, 0.14, dk), 0.42, 0.62, 0, rig);
    const head = put(box(0.54, 0.42, 0.44, lam(0xd5dbe3)), 0, 1.2, 0, rig);
    put(box(0.12, 0.1, 0.02, glow), -0.12, 0.03, 0.23, head); put(box(0.12, 0.1, 0.02, glow), 0.12, 0.03, 0.23, head);
    put(cyl(0.025, 0.25, dk), 0, 0.33, 0, head); put(sph(0.065, lam(0xff3b3b, { emissive: 0xaa1111 })), 0, 0.5, 0, head);
  } else { // penguin
    const dk = lam(0x23262d), or = lam(0xff9a1f); legMat = or; legs(0.2, 0.12);
    put(sph(0.42, dk, 1, 1.15, 0.95), 0, 0.68, 0, rig); put(sph(0.33, white, 0.9, 1.05, 0.5), 0, 0.64, 0.25, rig);
    put(sph(0.14, dk, 0.5, 1.5, 1), -0.42, 0.68, 0, rig); put(sph(0.14, dk, 0.5, 1.5, 1), 0.42, 0.68, 0, rig);
    const head = put(sph(0.3, dk), 0, 1.25, 0, rig); eyes(head, 0.05, 0.25, 0.11, 0.045);
    const beak = put(cone(0.07, 0.2, or), 0, -0.04, 0.34, head); beak.rotation.x = Math.PI / 2;
  }
  // team-colored scarf + ground ring so everyone can tell who owns what
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 20), bas(team)); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.97; rig.add(scarf);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 28), bas(team, { transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; root.add(ring);
  const aura = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 8, 40), bas(0xffffff, { transparent: true, opacity: 0.9 }));
  aura.rotation.x = Math.PI / 2; aura.position.y = 0.12; aura.visible = false; root.add(aura);
  return { root, rig, legL, legR, aura };
}

function textSprite(text, { font = '600 30px system-ui,sans-serif', bubble = false, scale = 0.011 } = {}) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = font; const tw = Math.min(700, Math.ceil(x.measureText(text).width)) + (bubble ? 36 : 20);
  c.width = tw; c.height = bubble ? 64 : 48; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (bubble) { x.fillStyle = 'rgba(255,255,255,.96)'; x.beginPath(); x.roundRect(2, 2, tw - 4, 52, 16); x.fill(); x.fillStyle = '#111'; x.fillText(text, tw / 2, 28, 660); }
  else { x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(text, tw / 2, 26, 660); x.fillStyle = '#fff'; x.fillText(text, tw / 2, 26, 660); }
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(c.width * scale, c.height * scale, 1); s.renderOrder = 10; return s;
}
function disposeObj(o) {
  o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
}

function ensureAvatar(id) {
  const a = avatars[id], p = players[id]; if (!a || !p) return;
  if (a.char !== p.char || a.hue !== p.hue || a.name !== p.name) {
    if (a.g) { scene.remove(a.g.root); disposeObj(a.g.root); }
    if (a.label) { a.g.root.remove(a.label); }
    a.g = makeCharacter(p.char, p.hue); a.char = p.char; a.hue = p.hue; a.name = p.name;
    a.label = textSprite(p.name); a.label.position.set(0, 1.95, 0); a.g.root.add(a.label);
    a.g.root.position.set(a.x, 0, a.y); scene.add(a.g.root);
    a.faceT = 0; a.walk = 0; a.lx = a.x; a.ly = a.y;
  }
}

// ---------- boost pickups ----------
function makePickup(type) {
  const info = CFG.pickups[type], c = new THREE.Color(info.color), g = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.7 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 20, 1, true), bas(c, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  const base = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), bas(c, { side: THREE.DoubleSide }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.05; beam.position.y = 1.6;
  const icon = textSprite(info.icon, { font: '56px sans-serif', scale: 0.016 }); icon.position.y = 2.15;
  const barGeo = new THREE.BoxGeometry(1.3, 0.14, 0.06); barGeo.translate(0.65, 0, 0);
  const bar = new THREE.Mesh(barGeo, bas(0x66ff99)); bar.position.set(-0.65, 2.75, 0); bar.renderOrder = 9;
  g.add(gem, beam, base, icon, bar);
  return { g, gem, bar, icon };
}
function addPickup(k) {
  if (pickups[k.id]) return;
  const o = makePickup(k.type); Object.assign(o, { id: k.id, type: k.type, x: k.x, y: k.y, life: CFG.pickupLife, expAt: performance.now() + k.left });
  o.g.position.set(k.x, 0, k.y); scene.add(o.g); pickups[k.id] = o;
  const pin = document.createElement('div'); pin.textContent = CFG.pickups[k.type].icon; pin.style.borderColor = CFG.pickups[k.type].color; $('pins').appendChild(pin); o.pin = pin;
}
function removePickup(id) {
  const o = pickups[id]; if (!o) return;
  scene.remove(o.g); disposeObj(o.g); o.pin.remove(); delete pickups[id];
}

// ---------- visual effects ----------
const effects = [];
function burst(x, z, color, size, life = 0.7) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 48), bas(color, { transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.1, z);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), bas(color, { transparent: true, depthWrite: false }));
  flash.position.set(x, 0.6, z); scene.add(ring, flash);
  effects.push({ ring, flash, t: 0, life, size });
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
  return { speed: CFG.base.speed * (c.speed || 1) * (has(me, 'haste') ? CFG.haste : 1) };
}
function toast(html, color) {
  const t = $('toast'); t.innerHTML = html; t.style.display = 'block'; t.style.borderColor = color || '#2a3140';
  clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 2200);
}

// ---------- login + networking ----------
fetch('/config').then(r => r.json()).then(cfg => {
  CFG = cfg;
  if (!cfg.chars[chosenChar]) chosenChar = 'fox';
  $('chars').innerHTML = Object.entries(cfg.chars).map(([k, c]) => `<div class="ch" data-k="${k}">${c.icon}<small>${c.name}</small></div>`).join('');
  const sel = () => {
    [...$('chars').children].forEach(e => e.classList.toggle('sel', e.dataset.k === chosenChar));
    $('perktext').textContent = cfg.chars[chosenChar].perk;
  };
  $('chars').onclick = e => { const el = e.target.closest('.ch'); if (el) { chosenChar = el.dataset.k; localStorage.setItem('char', chosenChar); sel(); } };
  sel();
});
$('name').value = localStorage.getItem('name') || '';
$('go').onclick = () => { if (!CFG) return; localStorage.setItem('name', $('name').value); connect(); $('login').style.display = 'none'; };
$('name').onkeydown = e => e.key === 'Enter' && $('go').click();
const sendJ = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => sendJ({ t: 'join', name: $('name').value, token: localStorage.getItem('token'), char: chosenChar });
  ws.onclose = () => { flash('Disconnected - reconnecting...'); setTimeout(connect, 2000); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'init') onInit(m);
    else if (m.t === 'tile') {
      const i = m.y * W + m.x; owner[i] = m.o; def[i] = m.d; paintTile(m.x, m.y); setBlock(i); updateMine();
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
        if (id === me) {
          const d = Math.hypot(x - mine.x, y - mine.y);
          if (d > 2) { mine.x = x; mine.y = y; } else { mine.x += (x - mine.x) * 0.1; mine.y += (y - mine.y) * 0.1; }
        }
      }
      for (const id in avatars) if (!seen.has(+id)) { const a = avatars[id]; if (a.g) { scene.remove(a.g.root); disposeObj(a.g.root); } delete avatars[id]; }
    } else if (m.t === 'chat') {
      const a = avatars[m.id]; if (!a || !a.g) return;
      if (a.bubble) { a.g.root.remove(a.bubble); disposeObj(a.bubble); }
      a.bubble = textSprite(m.msg, { font: '28px system-ui,sans-serif', bubble: true, scale: 0.0105 });
      a.bubble.position.set(0, 2.6, 0); a.g.root.add(a.bubble); a.bubbleUntil = performance.now() + 5000;
    } else if (m.t === 'board') showBoard(m);
    else if (m.t === 'err') flash(m.msg);
    else if (m.t === 'ok') { lastAct = performance.now(); cdUsed = m.cd; }
    else if (m.t === 'pickup+') addPickup(m);
    else if (m.t === 'pickup-') {
      const o = pickups[m.id];
      if (o && m.by) burst(o.x, o.y, new THREE.Color(CFG.pickups[o.type].color), 3, 0.5);
      removePickup(m.id);
    } else if (m.t === 'fx') {
      const now = performance.now(); fxUntil[m.id] = {};
      for (const [k, left] of Object.entries(m.fx)) fxUntil[m.id][k] = now + left;
    } else if (m.t === 'got') {
      const info = CFG.pickups[m.type];
      toast(`${info.icon} ${info.name}! <span style="font-weight:400;font-size:13px">${info.desc}</span>`, info.color);
    } else if (m.t === 'boom') burst(m.x, m.y, new THREE.Color(CFG.pickups.boom.color), 7, 0.8);
  };
}

function onInit(m) {
  ({ w: W, h: H } = m); me = m.you; myChar = m.char; players = m.players;
  localStorage.setItem('token', m.token);
  owner = Uint16Array.from(m.owner); def = Uint8Array.from(m.def);
  if (!started) buildWorld(); else repaintAll();
  for (const k of m.pickups) addPickup(k);
  const now = performance.now();
  for (const [id, fx] of Object.entries(m.fx)) { fxUntil[id] = {}; for (const [k, l] of Object.entries(fx)) fxUntil[id][k] = now + l; }
  mine = { x: m.x, y: m.y }; tgt.set(m.x, 0, m.y); sent = '0,0';
  const c = CFG.chars[myChar]; $('me').textContent = `${c.icon} ${c.name}`; $('perk').textContent = c.perk;
  updateMine();
  if (!started) { started = true; last = performance.now(); requestAnimationFrame(frame); }
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
  if (document.activeElement === $('name')) return;
  if (e.key === 'Enter') { e.preventDefault(); $('chatin').focus(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) sendJ({ t: 'fort' }); return; }
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
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); dist = Math.max(6, Math.min(45, dist * pinch / d)); pinch = d; return; }
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 6) { drag.moved = true; follow = false; }
  if (drag.moved) { const k = dist * 0.0017; tgt.x = Math.max(0, Math.min(W, drag.tx - dx * k)); tgt.z = Math.max(0, Math.min(H, drag.tz - dy * k * 1.5)); }
};
cv.onpointerup = cv.onpointercancel = e => {
  ptrs.delete(e.pointerId);
  drag = null;
};
cv.onwheel = e => { e.preventDefault(); dist = Math.max(6, Math.min(45, dist * (e.deltaY < 0 ? 0.9 : 1.1))); };

// ---------- main loop ----------
let last = 0, fxHtml = '';
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (renderer.domElement.width !== Math.floor(innerWidth * renderer.getPixelRatio())) {
    renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  const st = myStats(), d = curDir(), len = Math.hypot(d[0], d[1]);
  if (len > 0) {
    mine.x = Math.max(0.5, Math.min(W - 0.5, mine.x + d[0] / len * st.speed * dt));
    mine.y = Math.max(0.5, Math.min(H - 0.5, mine.y + d[1] / len * st.speed * dt));
  }
  // avatars
  for (const id in avatars) {
    const a = avatars[id]; ensureAvatar(+id); if (!a.g) continue;
    if (+id === me) { a.x = mine.x; a.y = mine.y; }
    else if (a.tx !== undefined) { a.x += (a.tx - a.x) * Math.min(1, dt * 12); a.y += (a.ty - a.y) * Math.min(1, dt * 12); }
    const vx = a.x - a.lx, vy = a.y - a.ly, sp = Math.hypot(vx, vy) / Math.max(dt, 0.001);
    a.lx = a.x; a.ly = a.y;
    const moving = sp > 0.6;
    if (moving) a.faceT = Math.atan2(vx, vy);
    let diff = ((a.faceT || 0) - a.g.root.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    a.g.root.rotation.y += diff * Math.min(1, dt * 12);
    a.walk += dt * Math.min(sp, 9) * 2.4;
    const sw = moving ? Math.sin(a.walk) * 0.75 : 0;
    a.g.legL.rotation.x = sw; a.g.legR.rotation.x = -sw;
    a.g.rig.position.y = moving ? Math.abs(Math.sin(a.walk)) * 0.1 : Math.sin(now / 400 + +id) * 0.015;
    a.g.root.position.set(a.x, 0, a.y);
    a.g.root.visible = Math.hypot(a.x - tgt.x, a.y - tgt.z) < 55;
    // boost aura
    const fx = fxUntil[id] || {}, act = Object.keys(fx).filter(k => fx[k] > now);
    a.g.aura.visible = act.length > 0;
    if (act.length) { a.g.aura.material.color.set(CFG.pickups[act[0]].color); const s = 1 + Math.sin(now / 150) * 0.08; a.g.aura.scale.set(s, s, s); }
    if (a.bubble && now > a.bubbleUntil) { a.g.root.remove(a.bubble); disposeObj(a.bubble); a.bubble = null; }
  }
  // camera
  if (follow) { tgt.x += (mine.x - tgt.x) * Math.min(1, dt * 8); tgt.z += (mine.y - tgt.z) * Math.min(1, dt * 8); }
  camera.position.set(tgt.x, dist * 0.9, tgt.z + dist * 0.55); camera.lookAt(tgt.x, 0.4, tgt.z);
  // pickups: spin, bob, countdown bar, edge pins
  for (const id in pickups) {
    const o = pickups[id], left = o.expAt - now, f = Math.max(0, left / o.life);
    o.gem.rotation.y += dt * 2.2; o.gem.position.y = 1.15 + Math.sin(now / 300 + +id) * 0.14;
    o.bar.scale.x = Math.max(0.001, f); o.bar.material.color.set(f > 0.4 ? 0x66ff99 : f > 0.2 ? 0xffd23f : 0xff5555);
    o.g.visible = left > 3000 || Math.floor(now / 160) % 2 === 0; // blink when about to vanish
    _p.set(o.x, 1.2, o.y).project(camera);
    const off = Math.abs(_p.x) > 0.93 || Math.abs(_p.y) > 0.9 || _p.z > 1;
    if (off) {
      let sx = _p.x, sy = _p.y; if (_p.z > 1) { sx = -sx; sy = -sy; }
      const k = Math.max(Math.abs(sx) / 0.93, Math.abs(sy) / 0.9, 1); sx /= k; sy /= k;
      o.pin.style.display = 'flex'; o.pin.style.left = (sx * 0.5 + 0.5) * innerWidth + 'px'; o.pin.style.top = (-sy * 0.5 + 0.5) * innerHeight + 'px';
      o.pin.style.opacity = o.g.visible ? 1 : 0.3;
    } else o.pin.style.display = 'none';
  }
  stepEffects(dt);
  // upload map texture / fort blocks at most ~10x per second
  if (texDirty && now - texLast > 100) { tex.needsUpdate = true; texDirty = false; texLast = now; }
  if (blkDirty) { blocks.instanceMatrix.needsUpdate = true; if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true; blkDirty = false; }
  renderer.render(scene, camera);
  // HUD
  $('fill').style.width = Math.min(1, (now - lastAct) / cdUsed) * 100 + '%';
  const fx = fxUntil[me] || {};
  const html = Object.keys(fx).filter(k => fx[k] > now).map(k => {
    const i = CFG.pickups[k]; return `<div class="chip" style="border-color:${i.color};color:${i.color}">${i.icon} ${i.name} <span style="margin-left:auto">${Math.ceil((fx[k] - now) / 1000)}s</span></div>`;
  }).join('');
  if (html !== fxHtml) { $('fx').innerHTML = html; fxHtml = html; }
  requestAnimationFrame(frame);
}

function showBoard(m) {
  $('online').textContent = m.online;
  $('rows').innerHTML = m.board.map(r =>
    `<div><span class="dot" style="background:hsl(${r.hue},65%,52%)"></span><span class="n">${esc(r.name)}${r.id === me ? ' (you)' : ''}</span><b>${r.count}</b></div>`).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ft; function flash(t) { $('msg').textContent = t; clearTimeout(ft); ft = setTimeout(() => $('msg').textContent = '', 1500); }
