// ======================= Territory 3D client (three.js r128) =======================
const $ = id => document.getElementById(id);
const TS = 16; // texture pixels per tile
const LEAN = 35 * Math.PI / 180;  // characters lean back toward the camera so they don't get squashed from above
const PITCH = 66 * Math.PI / 180; // camera angle: 90 = straight down. Flat 2D map, upright 3D characters
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
  tctx.fillStyle = o ? `hsl(${p ? p.hue : 0},${p ? 60 : 0}%,${p ? 46 : 32}%)` : '#1a1f2a';
  tctx.fillRect(px, py, TS, TS);
  tctx.fillStyle = 'rgba(0,0,0,.30)'; // subtle grid line
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
    a.g = makeCharacter(p.char, p.hue, LEAN); a.an = null; a.spd = 0; a.char = p.char; a.hue = p.hue; a.name = p.name;
    a.label = textSprite(p.name); a.label.position.set(0, 2.35, 0); a.g.tilt.add(a.label);
    a.g.root.position.set(a.x, 0, a.y); scene.add(a.g.root);
    a.faceT = 0; a.lx = a.x; a.ly = a.y;
  }
}

// ---------- boost pickups ----------
function makePickup(type) {
  const info = CFG.pickups[type], c = new THREE.Color(info.color), g = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.7 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 20, 1, true), bas(c, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  const base = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), bas(c, { side: THREE.DoubleSide }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.05; beam.position.y = 1.6;
  const icon = textSprite(info.icon, { font: '56px sans-serif' }); icon.userData.k = 0.55; icon.position.y = 2.15;
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
        if (id === me) {
          const d = Math.hypot(x - mine.x, y - mine.y);
          if (d > 2) { mine.x = x; mine.y = y; } else { mine.x += (x - mine.x) * 0.1; mine.y += (y - mine.y) * 0.1; }
        }
      }
      for (const id in avatars) if (!seen.has(+id)) { const a = avatars[id]; if (a.g) { scene.remove(a.g.root); disposeObj(a.g.root); } delete avatars[id]; }
    } else if (m.t === 'chat') {
      const a = avatars[m.id]; if (!a || !a.g) return;
      if (a.bubble) { a.g.tilt.remove(a.bubble); disposeObj(a.bubble); }
      a.bubble = textSprite(m.msg, { font: '28px system-ui,sans-serif', bubble: true, scale: 0.0105 });
      a.bubble.position.set(0, 2.9, 0); a.g.tilt.add(a.bubble); a.bubbleUntil = performance.now() + 5000;
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
let last = 0, fxHtml = '';
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (renderer.domElement.width !== Math.floor(innerWidth * renderer.getPixelRatio())) {
    renderer.setSize(innerWidth, innerHeight, false);
  }
  { const hh = dist / 2, hw = hh * innerWidth / innerHeight; if (camera.top !== hh || camera.right !== hw) { camera.top = hh; camera.bottom = -hh; camera.right = hw; camera.left = -hw; camera.updateProjectionMatrix(); } }
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
    if (a.bubble && now > a.bubbleUntil) { a.g.tilt.remove(a.bubble); disposeObj(a.bubble); a.bubble = null; }
    if (a.bubble) a.bubble.position.y = 2.35 + 46 * (dist / innerHeight); // keep the bubble just above the name at any zoom
  }
  // camera
  if (follow) { tgt.x += (mine.x - tgt.x) * Math.min(1, dt * 8); tgt.z += (mine.y - tgt.z) * Math.min(1, dt * 8); }
  camera.position.set(tgt.x, 80 * Math.sin(PITCH), tgt.z + 80 * Math.cos(PITCH)); camera.lookAt(tgt.x, 0, tgt.z);
  camera.updateMatrixWorld();
  const upp = dist / innerHeight; // world units per screen pixel: keeps text the same size at any zoom
  scene.traverse(o => { if (o.isSprite && o.userData.w) o.scale.set(o.userData.w * upp * o.userData.k, o.userData.h * upp * o.userData.k, 1); });
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
  stepEffects(dt); stepPuffs(dt);
  // upload map texture at most ~10x per second
  if (texDirty && now - texLast > 100) { tex.needsUpdate = true; texDirty = false; texLast = now; }
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
