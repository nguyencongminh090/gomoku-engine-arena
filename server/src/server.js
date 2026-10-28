const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const P = require('./protocol');
const { Match } = require('./match');
const { RoomRegistry } = require('./rooms');
const { openDb } = require('./db');

const WEB_ROOT = path.resolve(__dirname, '../../web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const MAX_BODY_BYTES = 32768;
const HELLO_TIMEOUT_MS = 10000;
const MAX_BAD_FRAMES = 5;

// Close codes (4xxx are ours).
const CLOSE = { replaced: 4000, badToken: 4401, badFrames: 4400, helloTimeout: 4408, roomGone: 4410, flood: 4429 };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Allows `limit` messages per second per connection.
function makeLimiter(limit) {
  let start = Date.now();
  let n = 0;
  return () => {
    const t = Date.now();
    if (t - start >= 1000) { start = t; n = 0; }
    return ++n <= limit;
  };
}

async function startServer({
  port = 0, host = '127.0.0.1', dbPath, tls, now = Date.now, trustProxy = false,
  tickMs = 250, rateLimit = 20, maxPerIp,
}) {
  const db = openDb(dbPath);
  const registry = new RoomRegistry({ db, now, ...(maxPerIp ? { maxPerIp } : {}) });
  const entries = new Map(); // roomId -> { room, match, agents: {A, B}, viewers: Set }

  function broadcast(entry, message) {
    const text = JSON.stringify(message);
    for (const v of entry.viewers) if (v.readyState === 1) v.send(text);
  }

  function entryFor(room) {
    let entry = entries.get(room.id);
    if (entry) return entry;
    entry = { room, agents: { A: null, B: null }, viewers: new Set() };
    entry.match = new Match({
      cfg: room.cfg, schedule: room.schedule, now,
      completed: db.loadMatch(room.id).games,
      send: (player, text) => {
        const ws = entry.agents[player];
        if (ws && ws.readyState === 1) ws.send(text);
      },
      onEvent: (event) => {
        if (event.type === 'gameOver') { db.saveGame(room.id, event.record); registry.touch(room.id); }
        broadcast(entry, { type: 'event', event });
      },
    });
    entries.set(room.id, entry);
    return entry;
  }

  function dropEntry(roomId) {
    const entry = entries.get(roomId);
    if (!entry) return;
    entries.delete(roomId);
    for (const ws of [...Object.values(entry.agents), ...entry.viewers]) if (ws) ws.close(CLOSE.roomGone, 'room closed');
  }

  // ---- HTTP ----
  const clientIp = (req) => {
    if (trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress;
  };

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', ...]
    if (req.method === 'POST' && parts.length === 2) {
      let cfg;
      try { cfg = JSON.parse(await readBody(req)); } catch (e) {
        return json(res, e.status || 400, { error: 'badJson' });
      }
      try {
        const created = registry.create(clientIp(req), cfg);
        return json(res, 201, created);
      } catch (e) {
        if (e.code === 'badConfig') return json(res, 400, { error: 'badConfig', message: e.message, detail: e.detail });
        if (e.code === 'ipLimit') return json(res, 429, { error: 'ipLimit', message: e.message });
        throw e;
      }
    }
    if (req.method === 'GET' && parts.length === 4 && parts[3] === 'view') {
      const room = registry.getByViewId(parts[2]);
      if (!room) return json(res, 404, { error: 'notFound' });
      return json(res, 200, { snapshot: entryFor(room).match.snapshot() });
    }
    if (req.method === 'DELETE' && parts.length === 3) {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!bearer || !registry.delete(parts[2], bearer[1])) return json(res, 403, { error: 'forbidden' });
      dropEntry(parts[2]);
      res.writeHead(204);
      return res.end();
    }
    return json(res, 404, { error: 'notFound' });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(WEB_ROOT, `.${rel}`);
    if (!file.startsWith(WEB_ROOT + path.sep)) { res.writeHead(404); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff', 'cache-control': 'no-cache',
      });
      return res.end(data);
    });
    return undefined;
  }

  const handler = (req, res) => {
    const url = new URL(req.url, 'http://x');
    const run = url.pathname.startsWith('/api/') ? handleApi(req, res, url) : Promise.resolve(serveStatic(req, res, url));
    run.catch((e) => {
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      console.error('request failed:', e);
    });
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  // ---- WebSocket ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: P.MAX_MESSAGE_BYTES });
  const sockets = new Set();

  function track(ws) {
    sockets.add(ws);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => sockets.delete(ws));
    ws.on('error', () => ws.terminate());
  }

  function onAgent(ws) {
    track(ws);
    const allowed = makeLimiter(rateLimit);
    let ctx = null; // { entry, player } once authenticated
    let bad = 0;
    const helloTimer = setTimeout(() => { if (!ctx) ws.close(CLOSE.helloTimeout, 'hello timeout'); }, HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (!allowed()) return ws.close(CLOSE.flood, 'too many messages');
      const parsed = isBinary ? { ok: false } : P.parseClientMessage(data, 'agent');
      if (!parsed.ok) { if (++bad > MAX_BAD_FRAMES) ws.close(CLOSE.badFrames, 'too many bad messages'); return undefined; }
      const { msg } = parsed;
      if (!ctx) {
        if (msg.type !== 'hello') return ws.close(CLOSE.badFrames, 'hello expected');
        const found = registry.resolveToken(msg.token);
        const room = found && registry.get(found.roomId);
        if (!room) return ws.close(CLOSE.badToken, 'bad token');
        clearTimeout(helloTimer);
        const entry = entryFor(room);
        const old = entry.agents[found.player];
        entry.agents[found.player] = ws;
        if (old && old !== ws) old.close(CLOSE.replaced, 'replaced by a newer connection');
        ctx = { entry, player: found.player };
        registry.touch(room.id);
        entry.match.agentConnected(found.player, msg);
        return undefined;
      }
      if (msg.type === 'hello') return undefined;
      if (msg.type === 'move') registry.touch(ctx.entry.room.id);
      ctx.entry.match.agentMessage(ctx.player, msg);
      return undefined;
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (ctx && ctx.entry.agents[ctx.player] === ws) {
        ctx.entry.agents[ctx.player] = null;
        ctx.entry.match.agentDisconnected(ctx.player);
      }
    });
  }

  function onViewer(ws, room) {
    track(ws);
    const entry = entryFor(room);
    entry.viewers.add(ws);
    const allowed = makeLimiter(rateLimit);
    ws.on('message', () => { if (!allowed()) ws.close(CLOSE.flood, 'too many messages'); }); // viewers are read-only
    ws.on('close', () => entry.viewers.delete(ws));
    ws.send(JSON.stringify({ type: 'snapshot', snapshot: entry.match.snapshot() }));
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const refuse = () => { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); };
    if (parts[0] !== 'ws') return refuse();
    if (parts[1] === 'agent' && parts.length === 2) return wss.handleUpgrade(req, socket, head, onAgent);
    if (parts[1] === 'view' && parts.length === 3) {
      const room = registry.getByViewId(parts[2]);
      if (!room) return refuse();
      return wss.handleUpgrade(req, socket, head, (ws) => onViewer(ws, room));
    }
    return refuse();
  });

  // ---- timers ----
  const timers = [
    setInterval(() => { for (const { match } of entries.values()) match.tick(); }, tickMs),
    setInterval(() => {
      registry.sweep();
      for (const [id, entry] of entries) if (!registry.get(entry.room.id)) dropEntry(id);
    }, 60000),
    setInterval(() => {
      for (const ws of sockets) {
        if (!ws.alive) { ws.terminate(); continue; }
        ws.alive = false;
        ws.ping();
      }
    }, 20000),
  ];
  for (const t of timers) t.unref();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    port: server.address().port,
    registry,
    close: async () => {
      for (const t of timers) clearInterval(t);
      for (const ws of sockets) ws.terminate();
      wss.close();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      db.close();
    },
  };
}

module.exports = { startServer };
