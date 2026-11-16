const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---- Config (tweak these to change the game feel) ----
const W = 160, H = 160;          // world size in tiles
const COOLDOWN_MS = 800;         // time between actions per player
const MAX_DEF = 3;               // max fortification on a tile
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
    s.players.forEach(p => { players.set(p.id, { ...p, count: 0 }); tokens.set(p.token, p.id); });
    nextId = s.nextId;
    owner.set(s.owner); def.set(s.def);
    owner.forEach(o => { if (o && players.has(o)) players.get(o).count++; });
    console.log('Loaded world', players.size, 'players');
  } catch { /* fresh world */ }
}
function save() {
  const data = {
    nextId,
    players: [...players.values()].map(({ id, token, name, hue }) => ({ id, token, name, hue })),
    owner: Array.from(owner), def: Array.from(def),
  };
  fs.writeFile(SAVE_FILE + '.tmp', JSON.stringify(data), err => {
    if (!err) fs.rename(SAVE_FILE + '.tmp', SAVE_FILE, () => {});
  });
}
load();
setInterval(save, 30000);
process.on('SIGINT', () => { fs.writeFileSync(SAVE_FILE, JSON.stringify({
  nextId, players: [...players.values()].map(({ id, token, name, hue }) => ({ id, token, name, hue })),
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
setInterval(() => broadcast({ t: 'board', board: leaderboard(), online: wss.clients.size }), 2000);

const cleanName = s => String(s || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Player';

wss.on('connection', ws => {
  let me = null, last = 0, msgs = 0;
  const rl = setInterval(() => { msgs = 0; }, 1000);
  ws.on('close', () => clearInterval(rl));
  ws.on('message', raw => {
    if (++msgs > 20 || raw.length > 512) return; // basic flood protection
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      let id = tokens.get(m.token);
      if (id) { me = players.get(id); me.name = cleanName(m.name); }
      else {
        const token = crypto.randomBytes(16).toString('hex');
        me = { id: nextId++, token, name: cleanName(m.name), hue: Math.floor(Math.random() * 360), count: 0 };
        players.set(me.id, me); tokens.set(token, me.id);
      }
      send(ws, {
        t: 'init', you: me.id, token: me.token, w: W, h: H, cooldown: COOLDOWN_MS, maxDef: MAX_DEF,
        owner: Array.from(owner), def: Array.from(def),
        players: Object.fromEntries([...players.values()].map(p => [p.id, { name: p.name, hue: p.hue }])),
      });
      broadcast({ t: 'player', id: me.id, name: me.name, hue: me.hue });
    } else if (m.t === 'click' && me) {
      const now = Date.now();
      if (now - last < COOLDOWN_MS) return send(ws, { t: 'err', msg: 'Cooling down' });
      if (!inBounds(m.x, m.y)) return;
      const err = handleClick(me, m.x, m.y);
      if (err) return send(ws, { t: 'err', msg: err });
      last = now;
      send(ws, { t: 'ok' });
    }
  });
});

server.listen(PORT, () => console.log(`Territory running on http://localhost:${PORT}`));
