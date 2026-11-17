const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ================= Config (tweak these to change the game feel) =================
// The game files the browser needs. If one ended up in the repo root instead of public/, we still find it.
const CLIENT_FILES = ['index.html', 'game.js', 'characters.js', 'scenery.js', 'themes.js', 'shared.js', 'three.min.js'];
const listDir = d => { try { return fs.readdirSync(d).join(', ') || '(empty)'; } catch { return '(folder not found)'; } };
function findClientFile(name) {
  for (const p of [path.join(__dirname, 'public', name), path.join(__dirname, name)]) if (fs.existsSync(p)) return p;
  return null;
}
const sharedPath = findClientFile('shared.js');
if (!sharedPath) { // say exactly what is wrong, in plain words, instead of a cryptic stack trace
  console.error('\n==============================================================');
  console.error('MISSING FILE: shared.js was not found in your repository.');
  console.error('Upload it from the zip\'s public folder into the public folder on GitHub.');
  console.error('What the server can see right now:');
  console.error('  main folder : ' + listDir(__dirname));
  console.error('  public/     : ' + listDir(path.join(__dirname, 'public')));
  console.error('==============================================================\n');
  process.exit(1);
}
const Shared = require(sharedPath); // maps + movement physics, same file the browser uses
for (const f of CLIENT_FILES) if (!findClientFile(f)) console.error('WARNING: ' + f + ' is missing from the repo - the game will not work until it is uploaded to the public folder.');
if (sharedPath !== path.join(__dirname, 'public', 'shared.js')) console.error('NOTE: shared.js is in the main folder instead of public/. It works, but please move it into public/.');
const W = Shared.W, H = Shared.H;  // world size in tiles (set in public/shared.js)
const COOLDOWN_MS = 800;         // base time between attacks on shielded tiles and fortify presses
const MIN_COOLDOWN_MS = 120;     // fastest possible attack/fortify rate
const MAX_DEF = 3;               // max fortification on a tile
const SPEED = 6.25;              // base walking speed, tiles per second (25% faster than before)
const ROUND_MS = Number(process.env.ROUND_MS) || 60000;   // length of a round
const RESULT_MS = Number(process.env.RESULT_MS) || 12000; // results + map vote screen between rounds
const PICKUP_LIFE_MS = 15000;    // how long a boost stays on the map before vanishing
const BOOST_MS = 15000;          // how long a collected boost lasts
const EXPLOSION_TILES = 15;      // tiles taken by the Explosion boost
const PORT = process.env.PORT || 3000;
const SAVE_FILE = process.env.SAVE_FILE || path.join(__dirname, 'world.json');

// ---- Progression ----
// Everyone starts with the 3 "starter" characters. Winning a round (with 2+ real players) earns 1 win. Wins are a currency:
// spend 5 for a Good character, 10 for a Great one, 20 for an OP one. Unlocks are permanent.
const MIN_PLAYERS_FOR_WIN = Number(process.env.MIN_PLAYERS) || 2; // a solo round earns nothing
const MIN_TILES_TO_COUNT = 20;                                    // you must actually play (claim 20+ tiles) to count as a player
const TIERS = {
  starter: { label: 'Starter', cost: 0 },
  good:    { label: 'Good',    cost: 5 },
  great:   { label: 'Great',   cost: 10 },
  op:      { label: 'OP',      cost: 20 },
};
// Active abilities (press Q). Great and OP characters have one.
const ABILITIES = {
  leap:      { name: 'Leap',      icon: '💨', cd: 9000,  dur: 1000, mult: 2.2, desc: 'Burst forward at 2.2x speed for 1 second' },
  blink:     { name: 'Blink',     icon: '✨', cd: 5500,  dist: 6.5,              desc: 'Teleport 6.5 tiles ahead, claiming what you cross' },
  shockwave: { name: 'Shockwave', icon: '🌀', cd: 14000, radius: 4.5, dmg: 2,    desc: 'Smash 2 shields off every enemy tile within 4.5 tiles' },
  inferno:   { name: 'Inferno',   icon: '🔥', cd: 12000, radius: 3.2, dmg: 3,    desc: 'Burn everything within 3 tiles: claim it, or break 3 shields' },
};
// Characters. Stats: speed (walk multiplier), cd (attack/fortify cooldown multiplier), startDef (shields on tiles you claim),
// fortify (shields per Space press), fortRadius, hit (shields removed per attack), brush (1 = paint a plus shape),
// magnet (pickup grab range multiplier), fxMult (how long boosts last)
const CHARS = {
  // --- starters: small, simple perks ---
  fox:     { tier: 'starter', name: 'Fox',     icon: '🦊', perk: 'Swift: +12% walk speed', speed: 1.12 },
  cat:     { tier: 'starter', name: 'Cat',     icon: '🐱', perk: 'Quick Paws: attacks & fortifies 20% faster', cd: 0.8 },
  robot:   { tier: 'starter', name: 'Robot',   icon: '🤖', perk: 'Overclock: Space fortifies 5x5 for +2 shields; attacks 10% faster; +8% walk speed', fortify: 2, fortRadius: 2, cd: 0.9, speed: 1.08 },
  // --- good (5 wins) ---
  panda:   { tier: 'good', name: 'Panda',   icon: '🐼', perk: 'Sturdy: tiles you claim start with 1 shield (walks 12% slower)', startDef: 1, speed: 0.88 },
  penguin: { tier: 'good', name: 'Penguin', icon: '🐧', perk: 'Ice Breaker: each hit removes 2 shields; tiles you capture from others start with 1 shield; attacks 20% faster; +12% walk speed', hit: 2, captureDef: 1, cd: 0.8, speed: 1.12 },
  rabbit:  { tier: 'good', name: 'Rabbit',  icon: '🐰', perk: 'Hopper: +30% walk speed; grabs pickups from 2.5x as far; boosts last 30% longer', speed: 1.3, magnet: 2.5, fxMult: 1.3 },
  // --- great (10 wins): a real perk plus an ability ---
  frog:    { tier: 'great', name: 'Frog',    icon: '🐸', perk: 'Wide Paint: paints a plus-shaped patch as you walk (the centre tile starts with 1 shield); walks 20% slower', brush: 1, startDef: 1, speed: 0.8, ability: 'leap' },
  octopus: { tier: 'great', name: 'Octopus', icon: '🐙', perk: 'Eight Arms: hits remove 2 shields; tiles start with 1 shield; attacks 15% faster', hit: 2, startDef: 1, cd: 0.85, ability: 'shockwave' },
  // --- OP (20 wins) ---
  dragon:  { tier: 'op', name: 'Dragon',  icon: '🐲', perk: 'Dragonfire: +15% speed; tiles start with 1 shield; hits remove 2 shields', speed: 1.15, startDef: 1, hit: 2, ability: 'inferno' },
  unicorn: { tier: 'op', name: 'Unicorn', icon: '🦄', perk: 'Rainbow Rider: +25% speed; boosts last 50% longer; tiles start with 1 shield', speed: 1.25, fxMult: 1.5, startDef: 1, ability: 'blink' },
};
const CHAR_KEYS = Object.keys(CHARS);
const STARTERS = CHAR_KEYS.filter(k => CHARS[k].tier === 'starter');
const costOf = k => TIERS[CHARS[k].tier].cost;

// Boosts that appear on the map
const PICKUPS = {
  rapid:   { name: 'Rapid Fire', icon: '⚡', color: '#ffd23f', weight: 3, desc: 'Attack & fortify ~3x faster' },
  boom:    { name: 'Explosion',  icon: '💥', color: '#ff5a36', weight: 2, desc: `Instantly claims ${EXPLOSION_TILES} tiles around you, enemy tiles too` },
  breaker: { name: 'Breaker',    icon: '🔨', color: '#b06bff', weight: 2, desc: 'Walk over any enemy tile to capture it instantly, shields ignored' },
  haste:   { name: 'Haste',      icon: '🚀', color: '#3fe0ff', weight: 2, desc: 'Walk 60% faster' },
  fortress:{ name: 'Fortress',   icon: '🛡️', color: '#4da3ff', weight: 2, desc: 'Tiles you claim start with 2 shields' },
  leap:    { name: 'Leap',       icon: '💨', color: '#9be8ff', weight: 0, dur: 1000, desc: 'Speeding along!' }, // not a pickup: it's what the Leap ability turns on
};
const HASTE = 1.6, RAPID = 0.3;

// ================= World state =================
const owner = new Uint16Array(W * H); // 0 = neutral, else player id
const def = new Uint8Array(W * H);    // fortification 0..MAX_DEF
const players = new Map();            // id -> player
const tokens = new Map();             // token -> id
let nextId = 1;

const newPlayerState = () => ({ count: 0, x: W / 2, y: H / 2, dx: 0, dy: 0, fdx: 0, fdy: 1, kx: 0, ky: 0, tpUntil: 0, flingUntil: 0, last: 0, abAt: 0, online: 0, fx: {}, socks: new Set() });
const UNLOCK_ALL = !!process.env.UNLOCK_ALL; // testing only
const newProg = () => ({ wins: 0, total: 0, ver: 0, owned: new Set(UNLOCK_ALL ? CHAR_KEYS : STARTERS) }); // wins = what you can still spend, total = ever won
const curMap = () => Shared.MAPS[round.mapId];
const savable = () => ({
  nextId,
  players: [...players.values()].map(({ id, token, name, hue, char, wins, total, ver, owned }) => ({ id, token, name, hue, char, wins: wins || 0, total: total || 0, ver: ver || 0, owned: [...owned] })),
});
function load() {
  try {
    const sv = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    sv.players.forEach(p => {
      const total = p.total === undefined ? (p.wins || 0) : p.total; // older save files only knew "wins"
      players.set(p.id, { ...p, ...newProg(), wins: p.wins || 0, total, ver: p.ver || 0, owned: new Set([...STARTERS, ...(p.owned || []).filter(k => CHARS[k])]),
        char: CHARS[p.char] ? p.char : STARTERS[0], ...newPlayerState() });
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
// A signed "save" is handed to each player's browser. It proves how many wins / unlocks they have, so progress survives the
// server restarting or sleeping (Render's free tier forgets files). Set SAVE_SECRET in Render's Environment tab to make it unforgeable.
const SECRET = process.env.SAVE_SECRET || 'territory-save-secret-please-set-SAVE_SECRET';
if (!process.env.SAVE_SECRET) console.error('NOTE: SAVE_SECRET is not set. Player saves work, but anyone who reads this code could forge one. Set SAVE_SECRET in your host\'s environment settings.');
const mac = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
const makeSave = p => { const b = Buffer.from(JSON.stringify({ v: 1, ver: p.ver, wins: p.wins, total: p.total, owned: [...p.owned] })).toString('base64url'); return b + '.' + mac(b); };
function readSave(s) {
  if (typeof s !== 'string' || s.length > 1500) return null;
  const [b, m] = s.split('.'); if (!b || !m) return null;
  const want = mac(b); if (want.length !== m.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m))) return null;
  try {
    const d = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (![d.ver, d.wins, d.total].every(n => Number.isInteger(n) && n >= 0 && n < 1e6) || !Array.isArray(d.owned)) return null;
    return { ver: d.ver, wins: d.wins, total: d.total, owned: new Set([...STARTERS, ...d.owned.filter(k => CHARS[k])]) };
  } catch { return null; }
}
const progMsg = p => ({ t: 'prog', wins: p.wins, total: p.total, owned: [...p.owned], char: p.char, save: makeSave(p) });
const pushProg = p => sendP(p, progMsg(p));
load();
setInterval(save, 30000);
process.on('SIGINT', () => { fs.writeFileSync(SAVE_FILE, JSON.stringify(savable())); process.exit(); });

// ================= HTTP (static files + config) =================
const CONFIG = {
  chars: CHARS, pickups: PICKUPS, tiers: TIERS, abilities: ABILITIES, minPlayers: MIN_PLAYERS_FOR_WIN,
  base: { speed: SPEED, cd: COOLDOWN_MS, minCd: MIN_COOLDOWN_MS },
  haste: HASTE, rapid: RAPID, pickupLife: PICKUP_LIFE_MS, boostMs: BOOST_MS, roundMs: ROUND_MS,
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(CONFIG));
  }
  const urlPath = req.url.split('?')[0], f = urlPath === '/' ? '/index.html' : urlPath; // ignore ?tags added by shared links
  let p = path.join(__dirname, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
  if (!p.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  const base = path.basename(p);
  if (!fs.existsSync(p) && CLIENT_FILES.includes(base) && fs.existsSync(path.join(__dirname, base))) p = path.join(__dirname, base); // misplaced in the repo root
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
    speed: SPEED * (c.speed || 1) * (has('haste') ? HASTE : 1) * (has('leap') ? ABILITIES.leap.mult : 1),
    brush: c.brush || 0, fortRadius: c.fortRadius || 1, magnet: c.magnet || 1,
    cd: Math.max(MIN_COOLDOWN_MS, COOLDOWN_MS * (c.cd || 1) * (has('rapid') ? RAPID : 1)),
    startDef: Math.min(MAX_DEF, (c.startDef || 0) + (has('fortress') ? 2 : 0)), fxDef: has('fortress') ? 2 : 0, captureDef: c.captureDef || 0, fortify: c.fortify || 1, hit: c.hit || 1, breaker: has('breaker'),
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
  if (!inBounds(x, y) || Shared.isLaneTile(curMap(), x, y)) return; // boost lanes can never be claimed
  const i = idx(x, y), o = owner[i];
  if (o === p.id) return;
  const holder = o ? players.get(o) : null; // the owner standing on their tile holds it - nobody can take or hit it
  if (holder && holder.online > 0 && Math.floor(holder.x) === x && Math.floor(holder.y) === y) return;
  if (o === 0 || def[i] === 0 || st.breaker) { // free claim. A brush's side tiles only get the boost shield; capturing from someone may give a shield too
    setTile(x, y, p.id, !primary ? st.fxDef : (o !== 0 ? Math.max(st.startDef, st.captureDef) : st.startDef)); return;
  }
  if (!primary || now - p.last < st.cd) return;
  p.last = now;
  setTile(x, y, o, Math.max(0, def[i] - st.hit));
  sendP(p, { t: 'ok', cd: st.cd });
}
function stepOn(p, now, x = p.x, y = p.y) {
  const st = stats(p), tx = Math.floor(x), ty = Math.floor(y);
  if (p.count === 0) { // new (or wiped-out) players get a free 3x3 start where they stand
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (inBounds(nx, ny) && owner[idx(nx, ny)] === 0 && !Shared.isLaneTile(curMap(), nx, ny)) setTile(nx, ny, p.id, 0);
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
  let n = 0; const R = st.fortRadius;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = tx + dx, y = ty + dy;
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    if (owner[i] === p.id && def[i] < MAX_DEF) { setTile(x, y, p.id, Math.min(MAX_DEF, def[i] + st.fortify)); n++; }
  }
  if (!n) return 'Nothing to fortify here - stand on your own land';
  p.last = now;
  sendP(p, { t: 'ok', cd: st.cd });
}

// ---- Abilities (Q) ----
function eachTileNear(p, r, fn) { // every non-lane tile whose centre is within r of the player
  for (let y = Math.floor(p.y - r); y <= Math.ceil(p.y + r); y++) for (let x = Math.floor(p.x - r); x <= Math.ceil(p.x + r); x++) {
    if (!inBounds(x, y) || Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > r || Shared.isLaneTile(curMap(), x, y)) continue;
    fn(x, y, idx(x, y));
  }
}
function useAbility(p, now) {
  if (round.phase !== 'play') return 'Round over';
  const key = CHARS[p.char].ability, ab = key && ABILITIES[key];
  if (!ab) return 'This character has no ability';
  if (now < p.abAt) return 'Ability recharging';
  const st = stats(p);
  p.abAt = now + ab.cd; sendP(p, { t: 'ab', cd: ab.cd });
  if (key === 'leap') { p.fx.leap = now + ab.dur; broadcast(fxMsg(p)); broadcast({ t: 'abfx', kind: 'leap', id: p.id, x: p.x, y: p.y }); }
  else if (key === 'blink') {
    let dx = p.dx, dy = p.dy; if (!dx && !dy) { dx = p.fdx; dy = p.fdy; }
    const l = Math.hypot(dx, dy) || 1, ox = p.x, oy = p.y;
    p.x = Math.max(0.5, Math.min(W - 0.5, p.x + dx / l * ab.dist)); p.y = Math.max(0.5, Math.min(H - 0.5, p.y + dy / l * ab.dist)); p.kx = p.ky = 0;
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - ox, p.y - oy) / 0.8));
    for (let i = 1; i <= n; i++) stepOn(p, now, ox + (p.x - ox) * i / n, oy + (p.y - oy) * i / n);
    sendP(p, { t: 'blink', x: p.x, y: p.y }); broadcast({ t: 'abfx', kind: 'blink', id: p.id, x: ox, y: oy, x2: p.x, y2: p.y });
  } else if (key === 'shockwave') {
    eachTileNear(p, ab.radius, (x, y, i) => { const o = owner[i]; if (o && o !== p.id && def[i] > 0) setTile(x, y, o, Math.max(0, def[i] - ab.dmg)); });
    broadcast({ t: 'abfx', kind: 'shockwave', id: p.id, x: p.x, y: p.y, r: ab.radius });
  } else if (key === 'inferno') {
    eachTileNear(p, ab.radius, (x, y, i) => {
      const o = owner[i]; if (o === p.id) return;
      if (o === 0 || def[i] - ab.dmg <= 0) setTile(x, y, p.id, st.startDef); else setTile(x, y, o, def[i] - ab.dmg);
    });
    broadcast({ t: 'abfx', kind: 'inferno', id: p.id, x: p.x, y: p.y, r: ab.radius });
  }
}

// ---- Boost pickups on the map ----
const pickups = new Map(); // id -> {id,type,x,y,exp}
let nextPickup = 1;
const fxMsg = p => ({ t: 'fx', id: p.id, fx: Object.fromEntries(Object.entries(p.fx).filter(([, e]) => e > Date.now()).map(([k, e]) => [k, e - Date.now()])) });

function pickType() {
  const total = Object.values(PICKUPS).reduce((a, b) => a + b.weight, 0); // (weight 0 = never spawns on the map)
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
  const mp = curMap();
  if (mp.vortexes.some(v => Math.hypot(v.x - x, v.y - y) < 2.5) || mp.portals.some(po => Math.hypot(po.x - x, po.y - y) < 2)) return;
  const pk = { id: nextPickup++, type: pickType(), x: +x.toFixed(2), y: +y.toFixed(2), exp: Date.now() + PICKUP_LIFE_MS };
  pickups.set(pk.id, pk);
  broadcast({ t: 'pickup+', id: pk.id, type: pk.type, x: pk.x, y: pk.y, left: PICKUP_LIFE_MS });
}
function explode(p) {
  const cands = [], cx = Math.floor(p.x), cy = Math.floor(p.y);
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!inBounds(x, y) || owner[idx(x, y)] === p.id || Shared.isLaneTile(curMap(), x, y)) continue;
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
  else { p.fx[pk.type] = Date.now() + BOOST_MS * (CHARS[p.char].fxMult || 1); broadcast(fxMsg(p)); }
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
const votes = new Map(); // playerId -> mapId, collected on the results screen
const tally = () => { const c = Object.fromEntries(Shared.MAP_IDS.map(id => [id, 0])); votes.forEach(m => c[m]++); return c; };
const round = { n: 1, mapId: Shared.MAPS[process.env.START_MAP] ? process.env.START_MAP : Shared.MAP_IDS[0], phase: 'play', endsAt: Date.now() + ROUND_MS, resultsUntil: 0, results: null };
let mapDirty = false;
function resetMap() {
  owner.fill(0); def.fill(0); mapDirty = false; pickups.clear();
  players.forEach(p => { p.count = 0; p.fx = {}; p.dx = 0; p.dy = 0; p.last = 0; p.abAt = 0; });
}
function startRound() {
  const counts = tally(), max = Math.max(...Object.values(counts));
  const cands = Shared.MAP_IDS.filter(id => max === 0 || counts[id] === max); // ties (or no votes) are settled randomly
  round.mapId = cands[Math.floor(Math.random() * cands.length)]; votes.clear();
  resetMap(); round.n++; round.phase = 'play'; round.endsAt = Date.now() + ROUND_MS; round.results = null;
  for (const p of online()) {
    Object.assign(p, Shared.safeSpot(curMap()), { kx: 0, ky: 0, tpUntil: 0 });
    sendP(p, { t: 'spawn', x: p.x, y: p.y }); sendP(p, { t: 'ab', cd: 0 });
  }
  broadcast({ t: 'round', n: round.n, left: ROUND_MS, map: round.mapId, counts });
}
function endRound() {
  const ranked = [...players.values()].filter(p => p.count > 0).sort((a, b) => b.count - a.count);
  // A win only counts if at least 2 real players took part (claimed 20+ tiles) - so playing alone earns nothing - and the winner is one of them.
  const playing = online().filter(p => p.count >= MIN_TILES_TO_COUNT), solo = playing.length < MIN_PLAYERS_FOR_WIN;
  const winner = ranked[0] && !solo && playing.includes(ranked[0]) ? ranked[0] : null;
  if (winner) { winner.wins++; winner.total++; winner.ver++; }
  votes.clear(); round.phase = 'results'; round.resultsUntil = Date.now() + RESULT_MS; pickups.clear();
  round.results = {
    n: round.n, total: W * H, mapId: round.mapId, counts: tally(), solo, awarded: winner ? winner.id : 0,
    board: ranked.slice(0, 8).map(p => ({ id: p.id, name: p.name, hue: p.hue, count: p.count, wins: p.total || 0 })),
  };
  for (const p of online()) {
    p.dx = p.dy = 0;
    const r = ranked.indexOf(p);
    sendP(p, { t: 'rank', rank: r < 0 ? 0 : r + 1, count: p.count, of: ranked.length });
    if (p === winner) pushProg(p);
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
let tickN = 0, lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.12, (now - lastTick) / 1000); lastTick = now;
  for (const p of (round.phase === 'play' ? online() : [])) {
    const ox = p.x, oy = p.y, map = curMap();
    const evs = Shared.step(map, p, dt, p.dx, p.dy, stats(p).speed, now);
    let teleported = false;
    for (const ev of evs) {
      if (ev.tp) { // portal: everyone sees the flash at both ends
        teleported = true;
        broadcast({ t: 'portalfx', from: { x: ev.tp.from.x, y: ev.tp.from.y }, to: { x: ev.tp.to.x, y: ev.tp.to.y }, color: ev.tp.from.color });
      } else if (ev.fling && now >= p.flingUntil) { // vortex spits you out in a random direction
        const ang = Math.random() * Math.PI * 2;
        p.flingUntil = now + 800; p.kx = Math.cos(ang) * Shared.FLING; p.ky = Math.sin(ang) * Shared.FLING;
        sendP(p, { t: 'fling', kx: p.kx, ky: p.ky, x: p.x, y: p.y });
        broadcast({ t: 'vortexfx', x: ev.fling.x, y: ev.fling.y });
      }
    }
    if (teleported) stepOn(p, now);
    else { // claim every tile along the path so fast movers never skip one
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - ox, p.y - oy) / 0.8));
      for (let i = 1; i <= n; i++) stepOn(p, now, ox + (p.x - ox) * i / n, oy + (p.y - oy) * i / n);
    }
    for (const pk of pickups.values()) {
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < 1.0 * stats(p).magnet) { collect(p, pk); }
    }
  }
  for (const pk of pickups.values()) {
    if (pk.exp <= now) { pickups.delete(pk.id); broadcast({ t: 'pickup-', id: pk.id }); }
  }
  {
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
    if (++msgs > 40 || raw.length > 2048) return; // basic flood protection (join carries the signed save, so it can be longer)
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      const id = tokens.get(m.token);
      if (id) { me = players.get(id); me.name = cleanName(m.name); }
      else {
        const token = crypto.randomBytes(16).toString('hex');
        me = {
          id: nextId++, token, name: cleanName(m.name), hue: Math.floor(Math.random() * 360), char: STARTERS[0],
          ...newPlayerState(), ...newProg(), ...Shared.safeSpot(curMap()),
        };
        players.set(me.id, me); tokens.set(token, me.id);
      }
      const saved = readSave(m.save); // the signed save from the player's browser; the newer of (browser, server memory) wins
      if (saved && saved.ver > (me.ver || 0)) { me.wins = saved.wins; me.total = saved.total; me.ver = saved.ver; me.owned = UNLOCK_ALL ? new Set(CHAR_KEYS) : saved.owned; }
      me.char = me.owned.has(m.char) ? m.char : (me.owned.has(me.char) ? me.char : STARTERS[0]); me.abAt = 0;
      if (!me.online) Object.assign(me, Shared.safeSpot(curMap()), { kx: 0, ky: 0, tpUntil: 0 });
      me.online++; me.socks.add(ws);
      send(ws, {
        t: 'init', you: me.id, token: me.token, w: W, h: H, char: me.char, x: me.x, y: me.y,
        owner: Array.from(owner), def: Array.from(def),
        players: Object.fromEntries([...players.values()].map(p => [p.id, { name: p.name, hue: p.hue, char: p.char }])),
        pickups: [...pickups.values()].map(k => ({ id: k.id, type: k.type, x: k.x, y: k.y, left: k.exp - Date.now() })),
        fx: Object.fromEntries(online().map(p => [p.id, fxMsg(p).fx])),
        round: { n: round.n, phase: round.phase, left: (round.phase === 'play' ? round.endsAt : round.resultsUntil) - Date.now() },
        results: round.phase === 'results' ? round.results : null, map: round.mapId, votes: tally(), prog: progMsg(me),
      });
      broadcast({ t: 'player', id: me.id, name: me.name, hue: me.hue, char: me.char });
    } else if (m.t === 'move' && me) {
      me.dx = Math.max(-1, Math.min(1, Number(m.dx) || 0));
      me.dy = Math.max(-1, Math.min(1, Number(m.dy) || 0));
      if (me.dx || me.dy) { me.fdx = me.dx; me.fdy = me.dy; }
    } else if (m.t === 'chat' && me) {
      const now = Date.now(), msg = cleanChat(m.msg);
      if (!msg || now - lastChat < 1000) return;
      lastChat = now;
      broadcast({ t: 'chat', id: me.id, msg });
    } else if (m.t === 'rename' && me) { // change your name any time
      const now = Date.now(); if (now - (me.renamedAt || 0) < 1500) return; me.renamedAt = now;
      me.name = cleanName(m.name); broadcast({ t: 'player', id: me.id, name: me.name, hue: me.hue, char: me.char });
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong', c: m.c });
    } else if (m.t === 'vote' && me) {
      if (round.phase !== 'results' || !Shared.MAPS[m.map]) return;
      votes.set(me.id, m.map); broadcast({ t: 'votes', counts: tally() });
    } else if (m.t === 'ability' && me) {
      const err = useAbility(me, Date.now());
      if (err) send(ws, { t: 'err', msg: err });
    } else if (m.t === 'unlock' && me) { // spend wins on a new character
      const k = m.char, c = CHARS[k];
      if (!c) return;
      if (me.owned.has(k)) return send(ws, { t: 'err', msg: 'You already own ' + c.name });
      if (me.wins < costOf(k)) return send(ws, { t: 'err', msg: `${c.name} costs ${costOf(k)} wins - you have ${me.wins}` });
      me.wins -= costOf(k); me.owned.add(k); me.ver++;
      pushProg(me); sendP(me, { t: 'unlocked', char: k });
    } else if (m.t === 'equip' && me) { // switch character (between rounds)
      if (!me.owned.has(m.char)) return send(ws, { t: 'err', msg: 'You have not unlocked that character' });
      if (round.phase === 'play' && me.count > 0) return send(ws, { t: 'err', msg: 'Switch characters between rounds' });
      me.char = m.char; me.abAt = 0; pushProg(me); sendP(me, { t: 'ab', cd: 0 });
      broadcast({ t: 'player', id: me.id, name: me.name, hue: me.hue, char: me.char });
    } else if (m.t === 'fort' && me) {
      const err = fortify(me, Date.now());
      if (err) send(ws, { t: 'err', msg: err });
    }
  });
});

server.listen(PORT, () => console.log(`Territory running on http://localhost:${PORT}`));
