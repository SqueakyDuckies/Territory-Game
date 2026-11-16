const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const EMOJIS = ['🦊','🐸','🐱','🐼','🦄','🐙','🤖','👾','🐧','🐲'];
let W = 0, H = 0, owner, def, players = {}, me = 0, cooldown = 800, speed = 5, reach = 6;
let off, offCtx, img;
let cam = { x: 0, y: 0, z: 28 };
let lastAct = 0, ws, follow = true;
const avatars = {};                 // id -> {x, y, tx, ty, bubble, bubbleUntil}
let mine = { x: 0, y: 0 };          // locally predicted own position
const keys = new Set(); let padDir = [0, 0], sent = '0,0';
let emoji = localStorage.getItem('emoji') || EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

$('name').value = localStorage.getItem('name') || '';
$('emojis').innerHTML = EMOJIS.map(e => `<span data-e="${e}" class="${e === emoji ? 'sel' : ''}">${e}</span>`).join('');
$('emojis').onclick = e => {
  if (!e.target.dataset.e) return;
  emoji = e.target.dataset.e; localStorage.setItem('emoji', emoji);
  [...$('emojis').children].forEach(c => c.classList.toggle('sel', c.dataset.e === emoji));
};
$('go').onclick = () => { localStorage.setItem('name', $('name').value); connect(); $('login').style.display = 'none'; };
$('name').onkeydown = e => e.key === 'Enter' && $('go').click();

const sendJ = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => sendJ({ t: 'join', name: $('name').value, token: localStorage.getItem('token'), emoji });
  ws.onclose = () => { flash('Disconnected - reconnecting...'); setTimeout(connect, 2000); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'init') {
      ({ w: W, h: H, cooldown, speed, reach } = m); me = m.you; players = m.players;
      localStorage.setItem('token', m.token);
      owner = Uint16Array.from(m.owner); def = Uint8Array.from(m.def);
      off = document.createElement('canvas'); off.width = W; off.height = H;
      offCtx = off.getContext('2d'); img = offCtx.createImageData(W, H);
      repaintAll(); updateMine();
      mine = { x: m.x, y: m.y }; sent = '0,0';
      cam.z = Math.max(18, Math.min(innerWidth, innerHeight) / 18);
      cam.x = mine.x - innerWidth / 2 / cam.z; cam.y = mine.y - innerHeight / 2 / cam.z;
      if (!draw.running) { draw.running = true; last = performance.now(); requestAnimationFrame(draw); }
    } else if (m.t === 'tile') {
      owner[m.y * W + m.x] = m.o; def[m.y * W + m.x] = m.d; paint(m.x, m.y); updateMine();
    } else if (m.t === 'player') { players[m.id] = { name: m.name, hue: m.hue, emoji: m.emoji }; repaintAll(); }
    else if (m.t === 'pos') {
      const seen = new Set();
      for (const [id, x, y] of m.p) {
        seen.add(id);
        const a = avatars[id] || (avatars[id] = { x, y });
        a.tx = x; a.ty = y;
        if (id === me) { // gently correct prediction toward server position
          const d = Math.hypot(x - mine.x, y - mine.y);
          if (d > 2) { mine.x = x; mine.y = y; } else { mine.x += (x - mine.x) * 0.1; mine.y += (y - mine.y) * 0.1; }
        }
      }
      for (const id in avatars) if (!seen.has(+id)) delete avatars[id];
    } else if (m.t === 'chat') {
      const a = avatars[m.id]; if (a) { a.bubble = m.msg; a.bubbleUntil = performance.now() + 5000; }
    } else if (m.t === 'board') showBoard(m);
    else if (m.t === 'err') flash(m.msg);
    else if (m.t === 'ok') lastAct = performance.now();
  };
}

const color = id => { const p = players[id]; return p ? hsl(p.hue, 65, 52) : [90, 90, 90]; };
function hsl(h, s, l) {
  s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}
function paint(x, y) {
  const i = y * W + x, o = owner[i], p = i * 4;
  let c = o ? color(o) : [26, 31, 42];
  if (o) { const t = 1 - def[i] * 0.12; c = c.map(v => v * t); }
  img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  offCtx.putImageData(img, 0, 0, x, y, 1, 1);
}
function repaintAll() { if (!owner) return; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paint(x, y); }
function updateMine() { let n = 0; for (let i = 0; i < owner.length; i++) if (owner[i] === me) n++; $('mine').textContent = n; }

// ---- input ----
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
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); syncDir(); }
});
addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); syncDir(); });
addEventListener('blur', () => { keys.clear(); padDir = [0, 0]; syncDir(); });
document.querySelectorAll('#pad b').forEach(b => {
  const d = b.dataset.d.split(',').map(Number);
  b.onpointerdown = e => { e.preventDefault(); padDir = [padDir[0] || d[0], padDir[1] || d[1]]; if (d[0]) padDir[0] = d[0]; if (d[1]) padDir[1] = d[1]; syncDir(); };
  const up = () => { if (d[0]) padDir[0] = 0; if (d[1]) padDir[1] = 0; syncDir(); };
  b.onpointerup = b.onpointerleave = b.onpointercancel = up;
});

// ---- render ----
let last = 0;
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // predict own movement locally
  const d = curDir(), len = Math.hypot(d[0], d[1]);
  if (len > 0) {
    mine.x = Math.max(0.5, Math.min(W - 0.5, mine.x + d[0] / len * speed * dt));
    mine.y = Math.max(0.5, Math.min(H - 0.5, mine.y + d[1] / len * speed * dt));
  }
  for (const id in avatars) {
    const a = avatars[id];
    if (+id === me) { a.x = mine.x; a.y = mine.y; }
    else { a.x += (a.tx - a.x) * Math.min(1, dt * 12); a.y += (a.ty - a.y) * Math.min(1, dt * 12); }
  }
  if (follow) {
    cam.x += (mine.x - innerWidth / 2 / cam.z - cam.x) * Math.min(1, dt * 8);
    cam.y += (mine.y - innerHeight / 2 / cam.z - cam.y) * Math.min(1, dt * 8);
  }

  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, -cam.x * cam.z, -cam.y * cam.z, W * cam.z, H * cam.z);
  const x0 = Math.max(0, Math.floor(cam.x)), y0 = Math.max(0, Math.floor(cam.y));
  const x1 = Math.min(W, Math.ceil(cam.x + innerWidth / cam.z)), y1 = Math.min(H, Math.ceil(cam.y + innerHeight / cam.z));
  if (cam.z >= 10) {
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath();
    for (let x = x0; x <= x1; x++) { const sx = (x - cam.x) * cam.z; ctx.moveTo(sx, (y0 - cam.y) * cam.z); ctx.lineTo(sx, (y1 - cam.y) * cam.z); }
    for (let y = y0; y <= y1; y++) { const sy = (y - cam.y) * cam.z; ctx.moveTo((x0 - cam.x) * cam.z, sy); ctx.lineTo((x1 - cam.x) * cam.z, sy); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dd = def[y * W + x];
      for (let k = 0; k < dd; k++) ctx.fillRect((x - cam.x) * cam.z + 3 + k * 5, (y - cam.y) * cam.z + 3, 3, 3);
    }
  }
  ctx.strokeStyle = '#2a3140'; ctx.strokeRect(-cam.x * cam.z, -cam.y * cam.z, W * cam.z, H * cam.z);

  // reach circle around you
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([6, 6]); ctx.beginPath();
  ctx.arc((mine.x - cam.x) * cam.z, (mine.y - cam.y) * cam.z, reach * cam.z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);

  // avatars (others first, you on top)
  const ids = Object.keys(avatars).map(Number).sort((a, b) => (a === me) - (b === me));
  const size = Math.max(16, cam.z * 1.1), nowT = performance.now();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const id of ids) {
    const a = avatars[id], p = players[id]; if (!p) continue;
    const sx = (a.x - cam.x) * cam.z, sy = (a.y - cam.y) * cam.z;
    if (sx < -60 || sy < -60 || sx > innerWidth + 60 || sy > innerHeight + 60) continue;
    ctx.fillStyle = `hsl(${p.hue},65%,52%)`; ctx.strokeStyle = id === me ? '#fff' : 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, size * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `${size * 0.85}px sans-serif`; ctx.fillStyle = '#fff';
    ctx.fillText(p.emoji || '🙂', sx, sy + 1);
    ctx.font = '600 12px system-ui,sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(p.name, sx, sy + size * 0.62 + 11);
    ctx.fillStyle = '#fff'; ctx.fillText(p.name, sx, sy + size * 0.62 + 11);
    if (a.bubble && nowT < a.bubbleUntil) {
      ctx.font = '13px system-ui,sans-serif';
      const tw = Math.min(220, ctx.measureText(a.bubble).width) + 16, by = sy - size * 0.62 - 20;
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.roundRect(sx - tw / 2, by - 12, tw, 24, 8); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillText(a.bubble, sx, by, 210);
    }
  }
  $('fill').style.width = Math.min(1, (nowT - lastAct) / cooldown) * 100 + '%';
  requestAnimationFrame(draw);
}

// click = act on tile, drag = look around
let drag = null;
cv.onpointerdown = e => { drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false }; cv.setPointerCapture(e.pointerId); };
cv.onpointermove = e => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 6) { drag.moved = true; follow = false; }
  if (drag.moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; }
};
cv.onpointerup = e => {
  if (drag && !drag.moved) {
    const x = Math.floor(e.clientX / cam.z + cam.x), y = Math.floor(e.clientY / cam.z + cam.y);
    if (x >= 0 && y >= 0 && x < W && y < H) sendJ({ t: 'click', x, y });
  }
  drag = null;
};
cv.onwheel = e => {
  e.preventDefault();
  const wx = e.clientX / cam.z + cam.x, wy = e.clientY / cam.z + cam.y;
  cam.z = Math.max(6, Math.min(60, cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  cam.x = wx - e.clientX / cam.z; cam.y = wy - e.clientY / cam.z;
};

function showBoard(m) {
  $('online').textContent = m.online;
  $('rows').innerHTML = m.board.map(r =>
    `<div><span class="dot" style="background:hsl(${r.hue},65%,52%)"></span><span class="n">${esc(r.name)}${r.id === me ? ' (you)' : ''}</span><b>${r.count}</b></div>`).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ft; function flash(t) { $('msg').textContent = t; clearTimeout(ft); ft = setTimeout(() => $('msg').textContent = '', 2000); }
