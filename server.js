/* Deadweight server: serves the game and relays multiplayer over WebSockets.
   Same model as the in-Claude room service: named rooms, per-player presence
   (pose, stance, weapon, score) and fire-and-forget events (shot, hit, death).
   Usage: npm install && npm start   (PORT=8080 by default) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const MAX_MSG = 4096;                 // bytes per presence object / event payload
const RATE = { perSec: 60, burst: 120 };  // messages per client (a player plus the bots they run)
const TOPICS = new Set(['shot', 'hit', 'death']);
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const MAX_PER_ROOM = +process.env.MAX_PER_ROOM || 16;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    // Always send a validator. game.js and index.html are a matched pair: a stale
    // cached bundle against fresh markup kills the whole script on the first
    // missing element, so only fingerprinted URLs (?v=) get a long max-age.
    const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
    const fingerprinted = /[?&]v=/.test(req.url || '');
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
      'Cache-Control': fingerprinted && ext !== '.html' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

/* rooms: name -> Map(peerId -> client) */
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function members(name) { return rooms.get(name) || new Map(); }
function broadcast(name, obj, except) { const s = JSON.stringify(obj); for (const c of members(name).values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s); }

wss.on('connection', (ws, req) => {
  const client = { ws, peer: crypto.randomBytes(8).toString('hex'), rooms: new Map(), tokens: RATE.burst, last: Date.now() };
  send(ws, { t: 'hello', peer: client.peer });

  ws.on('message', (buf) => {
    // token-bucket rate limit
    const now = Date.now(); client.tokens = Math.min(RATE.burst, client.tokens + (now - client.last) / 1000 * RATE.perSec); client.last = now;
    if (client.tokens < 1) return; client.tokens -= 1;
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const room = typeof m.room === 'string' ? m.room : '';
    switch (m.t) {
      case 'join': {
        if (!NAME_RE.test(room)) return send(ws, { t: 'error', id: m.id, code: 'invalid_argument' });
        if (!client.rooms.has(room)) {
          const mem = members(room);
          if (mem.size >= MAX_PER_ROOM) return send(ws, { t: 'error', id: m.id, code: 'limit_reached' });
          if (!rooms.has(room)) rooms.set(room, mem);
          mem.set(client.peer, client);
          client.rooms.set(room, {});
          broadcast(room, { t: 'peer', room, peer: client.peer, presence: {} }, client);
        }
        const peers = [...members(room).values()].map(c => ({ peer: c.peer, presence: c.rooms.get(room) || {} }));
        return send(ws, { t: 'joined', id: m.id, room, peers });
      }
      case 'presence': {
        if (!client.rooms.has(room) || !m.patch || typeof m.patch !== 'object') return;
        const cur = { ...client.rooms.get(room) };
        for (const k of Object.keys(m.patch)) { if (m.patch[k] === null) delete cur[k]; else cur[k] = m.patch[k]; }
        if (JSON.stringify(cur).length > MAX_MSG) return;
        client.rooms.set(room, cur);
        return broadcast(room, { t: 'peer', room, peer: client.peer, presence: cur }, client);
      }
      case 'emit': {
        if (!client.rooms.has(room) || !TOPICS.has(m.topic)) return;
        if (JSON.stringify(m.data ?? null).length > MAX_MSG) return;
        return broadcast(room, { t: 'emit', room, peer: client.peer, topic: m.topic, data: m.data ?? null }, client);
      }
      case 'leave': return leave(client, room);
    }
  });
  ws.on('close', () => { for (const r of [...client.rooms.keys()]) leave(client, r); });
  ws.on('error', () => {});
});

function leave(client, room) {
  if (!client.rooms.has(room)) return;
  client.rooms.delete(room);
  const mem = members(room); mem.delete(client.peer);
  if (!mem.size) rooms.delete(room);
  broadcast(room, { t: 'left', room, peer: client.peer });
}

// drop dead connections
setInterval(() => { for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

server.listen(PORT, () => console.log(`Deadweight running on http://localhost:${PORT}`));
