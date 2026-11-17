const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ================= Config (tweak these to change the game feel) =================
const W = 64, H = 64;            // world size in tiles (smaller = more fights)
const COOLDOWN_MS = 800;         // base time between attacks on shielded tiles and fortify presses
const MIN_COOLDOWN_MS = 120;     // fastest possible attack/fortify rate
const MAX_DEF = 3;               // max fortification on a tile
const SPEED = 6.25;              // base walking speed, tiles per second (25% faster than before)
const ROUND_MS = Number(process.env.ROUND_MS) || 60000;   // length of a round
const RESULT_MS = Number(process.env.RESULT_MS) || 8000;  // how long the results screen shows between rounds
const PICKUP_LIFE_MS = 15000;    // how long a boost stays on the map before vanishing
const BOOST_MS = 15000;          // how long a collected boost lasts
const EXPLOSION_TILES = 15;      // tiles taken by the Explosion boost
const PORT = process.env.PORT || 3000;
const SAVE_FILE = process.env.SAVE_FILE || path.join(__dirname, 'world.json');

// Characters, each with a built-in perk (multipliers / bonuses)
const CHARS = {
  fox:     { name: 'Fox',     icon: '🦊', perk: 'Swift: walks 30% faster', speed: 1.3 },
  cat:     { name: 'Cat',     icon: '🐱', perk: 'Quick Paws: attacks & fortifies 30% faster', cd: 0.7 },
  frog:    { name: 'Frog',    icon: '🐸', perk: 'Wide Paint: claims a plus-shaped patch (5 tiles) as you walk', brush: 1 },
  panda:   { name: 'Panda',   icon: '🐼', perk: 'Sturdy: tiles you claim start with 1 shield', startDef: 1 },
  robot:   { name: 'Robot',   icon: '🤖', perk: 'Overclock: Space fortify adds 2 shields per tile', fortify: 2 },
  penguin: { name: 'Penguin', icon: '🐧', perk: 'Ice Breaker: each hit removes 2 shields', hit: 2 },
};
const CHAR_KEYS = Object.keys(CHARS);

// Boosts that appear on the map
const PICKUPS = {
  rapid:   { name: 'Rapid Fire', icon: '⚡', color: '#ffd23f', weight: 3, desc: 'Attack & fortify ~3x faster' },
  boom:    { name: 'Explosion',  icon: '💥', color: '#ff5a36', weight: 2, desc: `Instantly claims ${EXPLOSION_TILES} tiles around you, enemy tiles too` },
  breaker: { name: 'Breaker',    icon: '🔨', color: '#b06bff', weight: 2, desc: 'Walk over any enemy tile to capture it instantly, shields ignored' },
  haste:   { name: 'Haste',      icon: '🚀', color: '#3fe0ff', weight: 2, desc: 'Walk 60% faster' },
};
const HASTE = 1.6, RAPID = 0.3;

// ================= World state =================
const owner = new Uint16Array(W * H); // 0 = neutral, else player id
const def = new Uint8Array(W * H);    // fortification 0..MAX_DEF
const players = new Map();            // id -> player
const tokens = new Map();             // token -> id
let nextId = 1;

const newPlayerState = () => ({ count: 0, x: W / 2, y: H / 2, dx: 0, dy: 0, last: 0, online: 0, fx: {}, socks: new Set() });
const savable = () => ({
  nextId,
  players: [...players.values()].map(({ id, token, name, hue, char, wins }) => ({ id, token, name, hue, char, wins: wins || 0 })),
});
function load() {
  try {
    const sv = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    sv.players.forEach(p => {
      players.set(p.id, { ...p, char: CHARS[p.char] ? p.char : CHAR_KEYS[p.id % CHAR_KEYS.length], ...newPlayerState() });
      tokens.set(p.token, p.id);
    });
    nextId = sv.nextId;
    console.log('Loaded', players.size, 'players');
  } catch { /* fresh start */ }
}
function save() {
  fs.writeFile(SAVE_FILE + '.tmp', JSON.stringify(savable()), err => {
    if (!err) fs.rename(SAVE_FILE + '.tmp', SAVE_FILE, () => {});
  });
}
load();
setInterval(save, 30000);
process.on('SIGINT', () => { fs.writeFileSync(SAVE_FILE, JSON.stringify(savable())); process.exit(); });

// ================= HTTP (static files + config) =================
const CONFIG = {
  chars: CHARS, pickups: PICKUPS,
  base: { speed: SPEED, cd: COOLDOWN_MS, minCd: MIN_COOLDOWN_MS },
  haste: HASTE, rapid: RAPID, pickupLife: PICKUP_LIFE_MS, boostMs: BOOST_MS, roundMs: ROUND_MS,
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(CONFIG));
  }
  const f = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const p = path.join(__dirname, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
  if (!p.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ================= Game =================
const wss = new WebSocketServer({ server });
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const broadcast = m => { const s = JSON.stringify(m); wss.clients.forEach(c => c.readyState === 1 && c.send(s)); };
const sendP = (p, m) => p.socks.forEach(ws => send(ws, m));
const online = () => [...players.values()].filter(p => p.online > 0);

const idx = (x, y) => y * W + x;
const inBounds = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < W && y < H;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const touches = (id, x, y) => DIRS.some(([dx, dy]) => {
  const nx = x + dx, ny = y + dy;
  return inBounds(nx, ny) && owner[idx(nx, ny)] === id;
});

// A player's current stats = character perk x any active boosts
function stats(p) {
  const c = CHARS[p.char], now = Date.now(), has = t => (p.fx[t] || 0) > now;
  return {
    speed: SPEED * (c.speed || 1) * (has('haste') ? HASTE : 1),
    brush: c.brush || 0,
    cd: Math.max(MIN_COOLDOWN_MS, COOLDOWN_MS * (c.cd || 1) * (has('rapid') ? RAPID : 1)),
    startDef: c.startDef || 0, fortify: c.fortify || 1, hit: c.hit || 1, breaker: has('breaker'),
  };
}

function setTile(x, y, o, d) {
  const i = idx(x, y), prev = owner[i];
  if (prev !== o) {
    if (prev && players.has(prev)) players.get(prev).count--;
    if (o && players.has(o)) players.get(o).count++;
  }
  owner[i] = o; def[i] = d; mapDirty = true;
  broadcast({ t: 'tile', x, y, o, d });
}

// Claim (or attack) one tile a player is standing on. Neutral tiles and unshielded enemy tiles flip instantly;
// shielded enemy tiles lose shield at the player's attack cooldown. Breaker ignores shields.
function claimTile(p, x, y, st, primary, now) {
  if (!inBounds(x, y)) return;
  const i = idx(x, y), o = owner[i];
  if (o === p.id) return;
  const holder = o ? players.get(o) : null; // the owner standing on their tile holds it - nobody can take or hit it
  if (holder && holder.online > 0 && Math.floor(holder.x) === x && Math.floor(holder.y) === y) return;
  if (o === 0 || def[i] === 0 || st.breaker) { setTile(x, y, p.id, st.startDef); return; }
  if (!primary || now - p.last < st.cd) return;
  p.last = now;
  setTile(x, y, o, Math.max(0, def[i] - st.hit));
  sendP(p, { t: 'ok', cd: st.cd });
}
function stepOn(p, now) {
  const st = stats(p), tx = Math.floor(p.x), ty = Math.floor(p.y);
  if (p.count === 0) { // new (or wiped-out) players get a free 3x3 start where they stand
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (inBounds(nx, ny) && owner[idx(nx, ny)] === 0) setTile(nx, ny, p.id, 0);
    }
  }
  claimTile(p, tx, ty, st, true, now);
  if (st.brush) for (const [dx, dy] of DIRS) claimTile(p, tx + dx, ty + dy, st, false, now);
}
// Space: fortify your own tiles in the 3x3 around you
function fortify(p, now) {
  if (round.phase !== 'play') return 'Round over';
  const st = stats(p), tx = Math.floor(p.x), ty = Math.floor(p.y);
  if (now - p.last < st.cd) return 'Cooling down';
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = tx + dx, y = ty + dy;
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    if (owner[i] === p.id && def[i] < MAX_DEF) { setTile(x, y, p.id, Math.min(MAX_DEF, def[i] + st.fortify)); n++; }
  }
  if (!n) return 'Nothing to fortify here - stand on your own land';
  p.last = now;
  sendP(p, { t: 'ok', cd: st.cd });
}

// ---- Boost pickups on the map ----
const pickups = new Map(); // id -> {id,type,x,y,exp}
let nextPickup = 1;
const fxMsg = p => ({ t: 'fx', id: p.id, fx: Object.fromEntries(Object.entries(p.fx).filter(([, e]) => e > Date.now()).map(([k, e]) => [k, e - Date.now()])) });

function pickType() {
  const total = Object.values(PICKUPS).reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of Object.entries(PICKUPS)) { if ((r -= v.weight) < 0) return k; }
  return 'rapid';
}
function spawnPickups() {
  if (round.phase !== 'play') return;
  const on = online();
  if (!on.length) return;
  const max = Math.min(14, 3 + on.length * 2);
  if (pickups.size >= max) return;
  const target = on[Math.floor(Math.random() * on.length)]; // spawn near the action
  const ang = Math.random() * Math.PI * 2, dist = 5 + Math.random() * 12;
  const x = Math.max(1, Math.min(W - 1, target.x + Math.cos(ang) * dist));
  const y = Math.max(1, Math.min(H - 1, target.y + Math.sin(ang) * dist));
  const pk = { id: nextPickup++, type: pickType(), x: +x.toFixed(2), y: +y.toFixed(2), exp: Date.now() + PICKUP_LIFE_MS };
  pickups.set(pk.id, pk);
  broadcast({ t: 'pickup+', id: pk.id, type: pk.type, x: pk.x, y: pk.y, left: PICKUP_LIFE_MS });
}
function explode(p) {
  const cands = [], cx = Math.floor(p.x), cy = Math.floor(p.y);
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!inBounds(x, y) || owner[idx(x, y)] === p.id) continue;
    cands.push([x, y, Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y)]);
  }
  cands.sort((a, b) => a[2] - b[2]);
  const sd = stats(p).startDef;
  cands.slice(0, EXPLOSION_TILES).forEach(([x, y]) => setTile(x, y, p.id, sd));
  broadcast({ t: 'boom', x: p.x, y: p.y });
}
function collect(p, pk) {
  pickups.delete(pk.id);
  broadcast({ t: 'pickup-', id: pk.id, by: p.id });
  if (pk.type === 'boom') explode(p);
  else { p.fx[pk.type] = Date.now() + BOOST_MS; broadcast(fxMsg(p)); }
  sendP(p, { t: 'got', type: pk.type });
}
setInterval(spawnPickups, 2500);

function leaderboard() {
  return [...players.values()].filter(p => p.count > 0)
    .sort((a, b) => b.count - a.count).slice(0, 10)
    .map(p => ({ id: p.id, name: p.name, hue: p.hue, count: p.count }));
}
setInterval(() => broadcast({ t: 'board', board: leaderboard(), online: online().length, n: round.n, phase: round.phase, left: (round.phase === 'play' ? round.endsAt : round.resultsUntil) - Date.now() }), 1000);

// ================= Rounds: 60s of play, then a results screen, then a fresh map =================
const round = { n: 1, phase: 'play', endsAt: Date.now() + ROUND_MS, resultsUntil: 0, results: null };
let mapDirty = false;
function resetMap() {
  owner.fill(0); def.fill(0); mapDirty = false; pickups.clear();
  players.forEach(p => { p.count = 0; p.fx = {}; p.dx = 0; p.dy = 0; p.last = 0; });
}
function startRound() {
  resetMap(); round.n++; round.phase = 'play'; round.endsAt = Date.now() + ROUND_MS; round.results = null;
  for (const p of online()) {
    p.x = 6 + Math.random() * (W - 12); p.y = 6 + Math.random() * (H - 12);
    sendP(p, { t: 'spawn', x: p.x, y: p.y });
  }
  broadcast({ t: 'round', n: round.n, left: ROUND_MS });
}
function endRound() {
  const ranked = [...players.values()].filter(p => p.count > 0).sort((a, b) => b.count - a.count);
  if (ranked[0]) ranked[0].wins = (ranked[0].wins || 0) + 1;
  round.phase = 'results'; round.resultsUntil = Date.now() + RESULT_MS; pickups.clear();
  round.results = {
    n: round.n, total: W * H,
    board: ranked.slice(0, 8).map(p => ({ id: p.id, name: p.name, hue: p.hue, count: p.count, wins: p.wins || 0 })),
  };
  for (const p of online()) {
    p.dx = p.dy = 0;
    const r = ranked.indexOf(p);
    sendP(p, { t: 'rank', rank: r < 0 ? 0 : r + 1, count: p.count, of: ranked.length });
  }
  broadcast({ t: 'roundEnd', ...round.results, next: RESULT_MS });
  save();
}
setInterval(() => {
  const now = Date.now();
  if (!online().length) { // nobody here: keep a fresh, full-length round waiting
    if (mapDirty || round.phase !== 'play') { resetMap(); round.phase = 'play'; round.results = null; }
    round.endsAt = now + ROUND_MS; return;
  }
  if (round.phase === 'play' && now >= round.endsAt) endRound();
  else if (round.phase === 'results' && now >= round.resultsUntil) startRound();
}, 250);

// Movement tick (20/s) + position broadcast (10/s) + pickup expiry/collection
const TICK = 50;
let tickN = 0;
setInterval(() => {
  const now = Date.now();
  for (const p of (round.phase === 'play' ? online() : [])) {
    const len = Math.hypot(p.dx, p.dy);
    if (len > 0) {
      const sp = stats(p).speed;
      p.x = Math.max(0.5, Math.min(W - 0.5, p.x + (p.dx / len) * sp * TICK / 1000));
      p.y = Math.max(0.5, Math.min(H - 0.5, p.y + (p.dy / len) * sp * TICK / 1000));
    }
    stepOn(p, now);
    for (const pk of pickups.values()) {
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < 1.0) { collect(p, pk); }
    }
  }
  for (const pk of pickups.values()) {
    if (pk.exp <= now) { pickups.delete(pk.id); broadcast({ t: 'pickup-', id: pk.id }); }
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
    if (me) {
      me.socks.delete(ws); me.online--;
      if (me.online <= 0) { me.online = 0; me.dx = me.dy = 0; }
    }
  });
  ws.on('message', raw => {
    if (++msgs > 40 || raw.length > 512) return; // basic flood protection
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      const id = tokens.get(m.token);
      if (id) { me = players.get(id); me.name = cleanName(m.name); }
      else {
        const token = crypto.randomBytes(16).toString('hex');
        me = {
          id: nextId++, token, name: cleanName(m.name), hue: Math.floor(Math.random() * 360), char: 'fox',
          ...newPlayerState(), x: 10 + Math.random() * (W - 20), y: 10 + Math.random() * (H - 20),
        };
        players.set(me.id, me); tokens.set(token, me.id);
      }
      me.char = CHARS[m.char] ? m.char : (CHARS[me.char] ? me.char : CHAR_KEYS[me.id % CHAR_KEYS.length]);
      me.online++; me.socks.add(ws);
      send(ws, {
        t: 'init', you: me.id, token: me.token, w: W, h: H, char: me.char, x: me.x, y: me.y,
        owner: Array.from(owner), def: Array.from(def),
        players: Object.fromEntries([...players.values()].map(p => [p.id, { name: p.name, hue: p.hue, char: p.char }])),
        pickups: [...pickups.values()].map(k => ({ id: k.id, type: k.type, x: k.x, y: k.y, left: k.exp - Date.now() })),
        fx: Object.fromEntries(online().map(p => [p.id, fxMsg(p).fx])),
        round: { n: round.n, phase: round.phase, left: (round.phase === 'play' ? round.endsAt : round.resultsUntil) - Date.now() },
        results: round.phase === 'results' ? round.results : null,
      });
      broadcast({ t: 'player', id: me.id, name: me.name, hue: me.hue, char: me.char });
    } else if (m.t === 'move' && me) {
      me.dx = Math.max(-1, Math.min(1, Number(m.dx) || 0));
      me.dy = Math.max(-1, Math.min(1, Number(m.dy) || 0));
    } else if (m.t === 'chat' && me) {
      const now = Date.now(), msg = cleanChat(m.msg);
      if (!msg || now - lastChat < 1000) return;
      lastChat = now;
      broadcast({ t: 'chat', id: me.id, msg });
    } else if (m.t === 'fort' && me) {
      const err = fortify(me, Date.now());
      if (err) send(ws, { t: 'err', msg: err });
    }
  });
});

server.listen(PORT, () => console.log(`Territory running on http://localhost:${PORT}`));
