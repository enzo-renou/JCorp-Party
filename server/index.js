'use strict';
const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const compression = require('compression');
const { Room } = require('./room');
const U = require('./util');

const PORT = process.env.PORT || 3000;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const ROOM_EMPTY_MS = 10 * 60 * 1000;
const MAX_ROOMS = 200;
const RATE_MAX = Number(process.env.RATE_MAX) || 120; // évènements max / socket / 5 s (le dessin en envoie beaucoup)

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10_000, pingTimeout: 20_000, maxHttpBufferSize: 1e5 });

/** @type {Map<string, Room>} */
const rooms = new Map();

// ------------------------------------------------------------------ HTTP
const root = path.join(__dirname, '..');
app.use(compression());
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
try {
  const flagsDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
  app.use('/flags', express.static(flagsDir, { maxAge: '7d' }));
} catch { console.warn('flag-icons introuvable : les drapeaux ne s’afficheront pas (npm install).'); }

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  if (!text) return res.status(400).end();
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#140f2e', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
  } catch { res.status(500).end(); }
});

// Photos « Qui est ce joueur ? » : le serveur va chercher l'image sur Wikipédia et la relaie.
// Ainsi le nom du fichier (qui contient la réponse) n'est jamais visible côté navigateur.
const photos = require('./photos');
const photoCache = new Map();
const photoFails = new Map(); // titre → heure du dernier échec (on ne retente pas en boucle)
app.get('/api/wikiimg/:id', async (req, res) => {
  try {
    const { cultureById } = require('./games/culture');
    const q = cultureById(req.params.id);
    if (!q || !q.wiki) return res.status(404).end();
    let img = photoCache.get(q.wiki) || photos.findLocal(q.wiki);
    if (!img) {
      if (Date.now() - (photoFails.get(q.wiki) || 0) < 5 * 60_000) return res.status(502).end();
      try {
        img = await photos.fetchWikiImage(q.wiki);
        photos.saveLocal(q.wiki, img);
      } catch (e) { photoFails.set(q.wiki, Date.now()); console.warn(`[photo] ${q.wiki} : ${e.message}`); throw e; }
    }
    photoCache.set(q.wiki, img);
    res.set({ 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400' }).send(img.buf);
  } catch (e) {
    res.status(502).end();
  }
});

// ------------------------------------------------------------------ Salons
function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O pour éviter les confusions
  let code;
  do { code = Array.from({ length: 4 }, () => letters[U.randInt(letters.length)]).join(''); } while (rooms.has(code));
  return code;
}

function closeRoom(room) {
  for (const p of room.players.values()) {
    clearTimeout(p.graceTimer); clearTimeout(p.hostTimer);
    if (p.socketId) io.to(p.socketId).emit('roomClosed');
  }
  room.game?.destroy();
  room.clearTimer();
  rooms.delete(room.code);
}

// ------------------------------------------------------------------ Sockets
io.on('connection', (socket) => {
  let rl = { start: Date.now(), n: 0 };
  socket.use((_packet, next) => {
    const now = Date.now();
    if (now - rl.start > 5000) rl = { start: now, n: 0 };
    if (++rl.n > RATE_MAX) return;
    next();
  });

  /** @type {{room: Room|null, pid: string|null}} */
  const me = { room: null, pid: null };
  const ack = (cb, data) => typeof cb === 'function' && cb(data);

  function leaveCurrent() {
    if (me.room && me.pid) {
      const room = me.room;
      const p = room.get(me.pid);
      if (p && p.socketId === socket.id) room.remove(me.pid);
      if (!room.anyConnected() && room.phase === 'lobby') closeRoom(room);
    }
    if (me.room) socket.leave(me.room.code);
    me.room = null; me.pid = null;
  }

  function bind(room, player) {
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) old.emit('sessionReplaced');
    }
    me.room = room; me.pid = player.id;
    socket.join(room.code);
    room.attach(player.id, socket.id);
  }

  socket.on('room:create', (data, cb) => {
    data = data || {};
    const name = U.sanitize(data.name, 14);
    if (!name) return ack(cb, { error: 'Choisis un pseudo !' });
    if (rooms.size >= MAX_ROOMS) return ack(cb, { error: 'Le serveur est plein, réessaie plus tard.' });
    leaveCurrent();
    const room = new Room(io, makeCode());
    rooms.set(room.code, room);
    const { player } = room.addPlayer(name, data.avatar);
    bind(room, player);
    ack(cb, { ok: true, code: room.code, pid: player.id, token: player.token });
  });

  socket.on('room:join', (data, cb) => {
    data = data || {};
    const name = U.sanitize(data.name, 14);
    const code = String(data.code || '').toUpperCase().trim();
    if (!name) return ack(cb, { error: 'Choisis un pseudo !' });
    const room = rooms.get(code);
    if (!room) return ack(cb, { error: "Ce code ne correspond à aucune partie." });
    leaveCurrent();
    const res = room.addPlayer(name, data.avatar, !!data.spectator);
    if (res.error) return ack(cb, { error: res.error });
    bind(room, res.player);
    ack(cb, { ok: true, code: room.code, pid: res.player.id, token: res.player.token });
  });

  socket.on('room:rejoin', (data, cb) => {
    data = data || {};
    const room = rooms.get(String(data.code || '').toUpperCase());
    const p = room?.get(String(data.pid || ''));
    if (!room || !p || p.gone || p.token !== data.token) return ack(cb, { error: 'expired' });
    if (me.room && me.room !== room) leaveCurrent();
    bind(room, p);
    ack(cb, { ok: true, code: room.code, pid: p.id, token: p.token });
  });

  socket.on('room:leave', (_d, cb) => { leaveCurrent(); ack(cb, { ok: true }); });

  socket.on('player:avatar', (avatar) => {
    const p = me.room?.get(me.pid);
    if (!p || me.room.phase !== 'lobby') return;
    p.avatar = U.sanitizeAvatar(avatar);
    me.room.update();
  });

  socket.on('room:rounds', (n) => me.room?.setRounds(me.pid, Number(n)));
  socket.on('room:start', (_d, cb) => ack(cb, me.room ? me.room.start(me.pid) : { error: 'Pas de salon.' }));
  socket.on('room:pick', (data, cb) => ack(cb, me.room ? me.room.pickGame(me.pid, data?.key, data?.options) : { error: 'Pas de salon.' }));
  socket.on('room:next', () => me.room?.nextRound(me.pid));
  socket.on('room:again', () => me.room?.again(me.pid));
  socket.on('room:kick', (id) => {
    const room = me.room;
    if (!room || me.pid !== room.hostId || id === me.pid) return;
    const t = room.get(String(id));
    if (!t) return;
    room.banned.add(t.name.toLowerCase());
    if (t.socketId) io.to(t.socketId).emit('kicked');
    room.remove(t.id);
  });

  socket.on('game:action', (msg) => {
    try { me.room?.action(me.pid, msg); } catch (e) { console.error('[action]', e); }
  });

  socket.on('disconnect', () => {
    if (me.room && me.pid) me.room.detach(me.pid, socket.id);
  });
});

// Nettoyage des salons abandonnés
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const idle = now - room.lastActivity;
    if ((!room.anyConnected() && idle > ROOM_EMPTY_MS) || idle > ROOM_IDLE_MS) closeRoom(room);
  }
}, 60_000).unref();

// ------------------------------------------------------------------ Sauvegarde des salons (survivre à un redémarrage)
const fs = require('fs');
const STATE_FILE = process.env.STATE_FILE || path.join(root, '.state', 'rooms.json');
const PERSIST = process.env.FAST_TEST !== '1' && process.env.NO_PERSIST !== '1';
function saveRooms() {
  if (!PERSIST) return;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...rooms.values()].map((r) => r.serialize())));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) { console.error('[save]', e.message); }
}
function loadRooms() {
  if (!PERSIST) return;
  try {
    const list = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    let n = 0;
    for (const d of list) {
      if (Date.now() - (d.lastActivity || d.savedAt || 0) > ROOM_IDLE_MS) continue;
      rooms.set(d.code, Room.restore(io, d)); n++;
    }
    if (n) console.log(`   ♻️  ${n} salon(s) restauré(s) après le redémarrage`);
  } catch { /* pas de sauvegarde */ }
}
loadRooms();
setInterval(saveRooms, 10_000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveRooms(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎉 JCorp Party prêt !`);
  console.log(`   Sur cet ordi :        http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`   Même Wi-Fi (amis) :   http://${i.address}:${PORT}`);
  }
  console.log('');
});

module.exports = { app, server, io, rooms };
