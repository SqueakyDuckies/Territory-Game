const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---- Config (tweak these to change the game feel) ----
const W = 160, H = 160;          // world size in tiles
const COOLDOWN_MS = 800;         // time between actions per player
const MAX_DEF = 3;               // max fortification on a tile
const SPEED = 5;                 // avatar speed, tiles per second
const REACH = 6;                 // how far (tiles) your avatar can claim/attack
const EMOJIS = ['🦊','🐸','🐱','🐼','🦄','🐙','🤖','👾','🐧','🐲'];
const PORT = process.env.PORT || 3000;
const SAVE_FILE = process.env.SAVE_FILE || path.join(__dirname, 'world.json');

// ---- World state ----
const owner = new Uint16Array(W * H); // 0 = neutral, else player id
const def = new Uint8Array(W * H);    // fortification 0..MAX_DEF
const players = new Map();            // id -> {id, token, name, hue, count}
const tokens = new Map();             // token -> id
let nextId = 1;

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    s.players.forEach(p => { players.set(p.id, { ...p, count: 0, x: W / 2, y: H / 2, dx: 0, dy: 0, last: 0, online: 0 }); tokens.set(p.token, p.id); });
    nextId = s.nextId;
    owner.set(s.owner); def.set(s.def);
    owner.forEach(o => { if (o && players.has(o)) players.get(o).count++; });
    console.log('Loaded world', players.size, 'players');
  } catch { /* fresh world */ }
}
function save() {
  const data = {
    nextId,
    players: [...players.values()].map(({ id, token, name, hue, emoji }) => ({ id, token, name, hue, emoji })),
    owner: Array.from(owner), def: Array.from(def),
  };
  fs.writeFile(SAVE_FILE + '.tmp', JSON.stringify(data), err => {
    if (!err) fs.rename(SAVE_FILE + '.tmp', SAVE_FILE, () => {});
  });
}
load();
setInterval(save, 30000);
process.on('SIGINT', () => { fs.writeFileSync(SAVE_FILE, JSON.stringify({
  nextId, players: [...players.values()].map(({ id, token, name, hue, emoji }) => ({ id, token, name, hue, emoji })),
  owner: Array.from(owner), def: Array.from(def) })); process.exit(); });

// ---- HTTP (static files) ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const p = path.join(__dirname, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
  if (!p.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ---- WebSocket game ----
const wss = new WebSocketServer({ server });
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const broadcast = m => { const s = JSON.stringify(m); wss.clients.forEach(c => c.readyState === 1 && c.send(s)); };

const idx = (x, y) => y * W + x;
const inBounds = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < W && y < H;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const touches = (id, x, y) => DIRS.some(([dx, dy]) => {
  const nx = x + dx, ny = y + dy;
  return inBounds(nx, ny) && owner[idx(nx, ny)] === id;
});

function setTile(x, y, o, d) {
  const i = idx(x, y);
  const prev = owner[i];
  if (prev !== o) {
    if (prev && players.has(prev)) players.get(prev).count--;
    if (o && players.has(o)) players.get(o).count++;
  }
  owner[i] = o; def[i] = d;
  broadcast({ t: 'tile', x, y, o, d });
}

function handleClick(p, x, y) {
  if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > REACH) return 'Too far - walk closer';
  const i = idx(x, y), o = owner[i];
  if (o === p.id) { // fortify own tile
    if (def[i] >= MAX_DEF) return 'Already max fortified';
    setTile(x, y, p.id, def[i] + 1);
    return;
  }
  if (p.count === 0) { // spawn: claim 3x3 of neutral tiles around the click
    if (o !== 0) return 'Pick an empty tile to spawn';
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && owner[idx(nx, ny)] === 0) setTile(nx, ny, p.id, 0);
    }
    return;
  }
  if (!touches(p.id, x, y)) return 'Must be next to your territory';
  if (o !== 0 && def[i] > 0) { // chip away at enemy fortification
    setTile(x, y, o, def[i] - 1);
    return;
  }
  setTile(x, y, p.id, 0); // claim neutral, or capture unfortified enemy tile
}

function leaderboard() {
  return [...players.values()].filter(p => p.count > 0)
    .sort((a, b) => b.count - a.count).slice(0, 10)
    .map(p => ({ id: p.id, name: p.name, hue: p.hue, count: p.count }));
}
const online = () => [...players.values()].filter(p => p.online > 0);
setInterval(() => broadcast({ t: 'board', board: leaderboard(), online: online().length }), 2000);

// Movement tick (20/s) and position broadcast (10/s)
const TICK = 50;
let tickN = 0;
setInterval(() => {
  for (const p of online()) {
    const len = Math.hypot(p.dx, p.dy);
    if (len > 0) {
      p.x = Math.max(0.5, Math.min(W - 0.5, p.x + (p.dx / len) * SPEED * TICK / 1000));
      p.y = Math.max(0.5, Math.min(H - 0.5, p.y + (p.dy / len) * SPEED * TICK / 1000));
    }
  }
  if (++tickN % 2 === 0) {
    broadcast({ t: 'pos', p: online().map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2)]) });
  }
}, TICK);

const cleanName = s => String(s || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Player';
const cleanChat = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

wss.on('connection', ws => {
  let me = null, msgs = 0, lastChat = 0;
  const rl = setInterval(() => { msgs = 0; }, 1000);
  ws.on('close', () => {
    clearInterval(rl);
    if (me) { me.online--; if (me.online <= 0) { me.online = 0; me.dx = me.dy = 0; } }
  });
  ws.on('message', raw => {
    if (++msgs > 30 || raw.length > 512) return; // basic flood protection
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      const id = tokens.get(m.token);
      if (id) { me = players.get(id); me.name = cleanName(m.name); }
      else {
        const token = crypto.randomBytes(16).toString('hex');
        me = {
          id: nextId++, token, name: cleanName(m.name), hue: Math.floor(Math.random() * 360), count: 0,
          x: 10 + Math.random() * (W - 20), y: 10 + Math.random() * (H - 20), dx: 0, dy: 0, last: 0, online: 0,
        };
        players.set(me.id, me); tokens.set(token, me.id);
      }
      me.emoji = EMOJIS.includes(m.emoji) ? m.emoji : (me.emoji || EMOJIS[me.id % EMOJIS.length]);
      me.online++;
      send(ws, {
        t: 'init', you: me.id, token: me.token, w: W, h: H, cooldown: COOLDOWN_MS, maxDef: MAX_DEF,
        speed: SPEED, reach: REACH, x: me.x, y: me.y,
        owner: Array.from(owner), def: Array.from(def),
        players: Object.fromEntries([...players.values()].map(p => [p.id, { name: p.name, hue: p.hue, emoji: p.emoji }])),
      });
      broadcast({ t: 'player', id: me.id, name: me.name, hue: me.hue, emoji: me.emoji });
    } else if (m.t === 'move' && me) {
      me.dx = Math.max(-1, Math.min(1, Number(m.dx) || 0));
      me.dy = Math.max(-1, Math.min(1, Number(m.dy) || 0));
    } else if (m.t === 'chat' && me) {
      const now = Date.now(), msg = cleanChat(m.msg);
      if (!msg || now - lastChat < 1000) return;
      lastChat = now;
      broadcast({ t: 'chat', id: me.id, msg });
    } else if (m.t === 'click' && me) {
      const now = Date.now();
      if (now - me.last < COOLDOWN_MS) return send(ws, { t: 'err', msg: 'Cooling down' });
      if (!inBounds(m.x, m.y)) return;
      const err = handleClick(me, m.x, m.y);
      if (err) return send(ws, { t: 'err', msg: err });
      me.last = now;
      send(ws, { t: 'ok' });
    }
  });
});

server.listen(PORT, () => console.log(`Territory running on http://localhost:${PORT}`));
