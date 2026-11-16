const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
let W = 0, H = 0, owner, def, players = {}, me = 0, cooldown = 800, maxDef = 3;
let off, offCtx, img;               // offscreen 1px-per-tile image
let cam = { x: 0, y: 0, z: 6 };     // world->screen: screen = (tile - cam) * z
let lastAct = 0, ws;

$('name').value = localStorage.getItem('name') || '';
$('go').onclick = () => { localStorage.setItem('name', $('name').value); connect(); $('login').style.display = 'none'; };
$('name').onkeydown = e => e.key === 'Enter' && $('go').click();

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: $('name').value, token: localStorage.getItem('token') }));
  ws.onclose = () => { flash('Disconnected - reconnecting...'); setTimeout(connect, 2000); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'init') {
      ({ w: W, h: H, cooldown, maxDef } = m); me = m.you; players = m.players;
      localStorage.setItem('token', m.token);
      owner = Uint16Array.from(m.owner); def = Uint8Array.from(m.def);
      off = document.createElement('canvas'); off.width = W; off.height = H;
      offCtx = off.getContext('2d'); img = offCtx.createImageData(W, H);
      repaintAll();
      cam.z = Math.min(innerWidth, innerHeight) / 40;
      centerOnMine();
      requestAnimationFrame(draw);
    } else if (m.t === 'tile') {
      owner[m.y * W + m.x] = m.o; def[m.y * W + m.x] = m.d; paint(m.x, m.y); updateMine();
    } else if (m.t === 'player') players[m.id] = { name: m.name, hue: m.hue };
    else if (m.t === 'board') showBoard(m);
    else if (m.t === 'err') flash(m.msg);
    else if (m.t === 'ok') lastAct = performance.now();
  };
}

const color = id => { const p = players[id]; return p ? hsl(p.hue, 65, 52) : [90, 90, 90]; };
function hsl(h, s, l) { // -> [r,g,b]
  s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}
function paint(x, y) {
  const i = y * W + x, o = owner[i], p = i * 4;
  let c = o ? color(o) : [26, 31, 42];
  if (o) { const t = 1 - def[i] * 0.12; c = c.map(v => v * t); } // fortified = slightly darker
  img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  offCtx.putImageData(img, 0, 0, x, y, 1, 1);
}
function repaintAll() { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paint(x, y); }
function updateMine() { let n = 0; for (let i = 0; i < owner.length; i++) if (owner[i] === me) n++; $('mine').textContent = n; }
function centerOnMine() {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < owner.length; i++) if (owner[i] === me) { sx += i % W; sy += (i / W) | 0; n++; }
  const cx = n ? sx / n : W / 2, cy = n ? sy / n : H / 2;
  cam.x = cx - innerWidth / 2 / cam.z; cam.y = cy - innerHeight / 2 / cam.z; updateMine();
}

function draw() {
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, -cam.x * cam.z, -cam.y * cam.z, W * cam.z, H * cam.z);
  if (cam.z >= 10) { // grid + shield pips when zoomed in
    const x0 = Math.max(0, Math.floor(cam.x)), y0 = Math.max(0, Math.floor(cam.y));
    const x1 = Math.min(W, Math.ceil(cam.x + innerWidth / cam.z)), y1 = Math.min(H, Math.ceil(cam.y + innerHeight / cam.z));
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath();
    for (let x = x0; x <= x1; x++) { const sx = (x - cam.x) * cam.z; ctx.moveTo(sx, (y0 - cam.y) * cam.z); ctx.lineTo(sx, (y1 - cam.y) * cam.z); }
    for (let y = y0; y <= y1; y++) { const sy = (y - cam.y) * cam.z; ctx.moveTo((x0 - cam.x) * cam.z, sy); ctx.lineTo((x1 - cam.x) * cam.z, sy); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const d = def[y * W + x];
      for (let k = 0; k < d; k++) ctx.fillRect((x - cam.x) * cam.z + 3 + k * 5, (y - cam.y) * cam.z + 3, 3, 3);
    }
  }
  ctx.strokeStyle = '#2a3140'; ctx.strokeRect(-cam.x * cam.z, -cam.y * cam.z, W * cam.z, H * cam.z);
  const f = Math.min(1, (performance.now() - lastAct) / cooldown);
  $('fill').style.width = f * 100 + '%';
  requestAnimationFrame(draw);
}

// ---- input: drag to pan, wheel to zoom, tap to act ----
let drag = null;
cv.onpointerdown = e => { drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false }; cv.setPointerCapture(e.pointerId); };
cv.onpointermove = e => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
  if (drag.moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; }
};
cv.onpointerup = e => {
  if (drag && !drag.moved && ws && ws.readyState === 1) {
    const x = Math.floor(e.clientX / cam.z + cam.x), y = Math.floor(e.clientY / cam.z + cam.y);
    if (x >= 0 && y >= 0 && x < W && y < H) ws.send(JSON.stringify({ t: 'click', x, y }));
  }
  drag = null;
};
cv.onwheel = e => {
  e.preventDefault();
  const wx = e.clientX / cam.z + cam.x, wy = e.clientY / cam.z + cam.y;
  cam.z = Math.max(2, Math.min(40, cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  cam.x = wx - e.clientX / cam.z; cam.y = wy - e.clientY / cam.z;
};

function showBoard(m) {
  $('online').textContent = m.online;
  $('rows').innerHTML = m.board.map(r =>
    `<div><span class="dot" style="background:hsl(${r.hue},65%,52%)"></span><span class="n">${esc(r.name)}${r.id === me ? ' (you)' : ''}</span><b>${r.count}</b></div>`).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ft; function flash(t) { $('msg').textContent = t; clearTimeout(ft); ft = setTimeout(() => $('msg').textContent = '', 2000); }
