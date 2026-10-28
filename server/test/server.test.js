const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../src/server');

const roomCfg = {
  rule: 'freestyle', w: 15, h: 15, games: 2, matchMs: 60000, turnMs: 10000,
  openingsText: '-\n-',
};
const hello = (token, kind = 'rapfi') => JSON.stringify({ type: 'hello', token, engine: { name: 'E', version: '1', kind }, limits: { maxW: 22, maxH: 22 } });

async function withServer(fn, opts = {}) {
  const srv = await startServer({ port: 0, dbPath: ':memory:', ...opts });
  const base = `http://127.0.0.1:${srv.port}`;
  const ws = `ws://127.0.0.1:${srv.port}`;
  const post = async (body = roomCfg) => {
    const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const sockets = [];
  const open = (url) => new Promise((resolve, reject) => {
    const s = new WebSocket(url);
    s.inbox = [];
    s.closed = new Promise((r) => s.on('close', (code) => r(code)));
    s.on('message', (d) => s.inbox.push(JSON.parse(d.toString())));
    s.on('open', () => resolve(s));
    s.on('error', reject);
    sockets.push(s);
  });
  const until = async (pred, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('timed out');
  };
  try { await fn({ srv, base, ws, post, open, until }); } finally {
    for (const s of sockets) s.terminate();
    await srv.close();
  }
}

test('agent with bad token is refused', async () => {
  await withServer(async ({ ws, post, open }) => {
    const room = (await post()).body;
    const a = await open(`${ws}/ws/agent`);
    a.send(hello('nonsense.token'));
    assert.equal(await a.closed, 4401);
    const b = await open(`${ws}/ws/agent`);
    b.send(hello(room.tokenA.slice(0, -1) + 'x'));
    assert.equal(await b.closed, 4401);
    const c = await open(`${ws}/ws/agent`);
    c.send(JSON.stringify({ type: 'ready', ok: true })); // anything but hello first
    assert.notEqual(await c.closed, 1000);
  });
});

test('valid hello gets config', async () => {
  await withServer(async ({ ws, post, open, until }) => {
    const room = (await post()).body;
    const a = await open(`${ws}/ws/agent`);
    a.send(hello(room.tokenA));
    const cfg = await until(() => a.inbox.find((m) => m.type === 'config'));
    assert.deepEqual(cfg, { type: 'config', rule: 'freestyle', w: 15, h: 15, matchMs: 60000, turnMs: 10000 });
  });
});

test('second connection with same token replaces first', async () => {
  await withServer(async ({ ws, post, open, until }) => {
    const room = (await post()).body;
    const first = await open(`${ws}/ws/agent`);
    first.send(hello(room.tokenA));
    await until(() => first.inbox.length);
    const second = await open(`${ws}/ws/agent`);
    second.send(hello(room.tokenA));
    assert.equal(await first.closed, 4000);
    await until(() => second.inbox.find((m) => m.type === 'config'));
    assert.equal(second.readyState, WebSocket.OPEN);
  });
});

test('two agents play: moves flow and viewers watch', async () => {
  await withServer(async ({ ws, post, open, until }) => {
    const room = (await post()).body;
    const view = await open(`${ws}/ws/view/${room.viewId}`);
    await until(() => view.inbox.find((m) => m.type === 'snapshot'));
    const a = await open(`${ws}/ws/agent`); a.send(hello(room.tokenA));
    const b = await open(`${ws}/ws/agent`); b.send(hello(room.tokenB));
    await until(() => a.inbox.find((m) => m.type === 'config') && b.inbox.find((m) => m.type === 'config'));
    a.send(JSON.stringify({ type: 'ready', ok: true }));
    b.send(JSON.stringify({ type: 'ready', ok: true }));
    const go = await until(() => a.inbox.find((m) => m.type === 'go'));
    assert.equal(go.gameId, 0);
    a.send(JSON.stringify({ type: 'move', gameId: 0, ply: 0, x: 7, y: 7 }));
    const goB = await until(() => b.inbox.find((m) => m.type === 'go'));
    assert.deepEqual(goB.stones, [{ x: 7, y: 7, c: 1 }]);
    await until(() => view.inbox.find((m) => m.type === 'event' && m.event.type === 'move' && m.event.x === 7));
  });
});

test('viewer move ignored', async () => {
  await withServer(async ({ ws, post, open, until, base }) => {
    const room = (await post()).body;
    const view = await open(`${ws}/ws/view/${room.viewId}`);
    await until(() => view.inbox.length);
    view.send(JSON.stringify({ type: 'move', gameId: 0, ply: 0, x: 1, y: 1 }));
    view.send('garbage');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(view.readyState, WebSocket.OPEN);
    const snap = await (await fetch(`${base}/api/rooms/${room.viewId}/view`)).json();
    assert.equal(snap.snapshot.current, null);
  });
});

test('oversize message closes connection', async () => {
  await withServer(async ({ ws, post, open }) => {
    const room = (await post()).body;
    const a = await open(`${ws}/ws/agent`);
    a.send(hello(room.tokenA));
    a.send(JSON.stringify({ type: 'log', level: 'info', text: 'x'.repeat(20000) }));
    assert.equal(await a.closed, 1009);
  });
});

test('flood closes connection', async () => {
  await withServer(async ({ ws, post, open }) => {
    const room = (await post()).body;
    const a = await open(`${ws}/ws/agent`);
    a.send(hello(room.tokenA));
    for (let i = 0; i < 60; i++) a.send(JSON.stringify({ type: 'log', level: 'info', text: 'x' }));
    assert.equal(await a.closed, 4429);
  });
});

test('garbage from an agent does not crash the server', async () => {
  await withServer(async ({ ws, post, open, until }) => {
    const room = (await post()).body;
    const a = await open(`${ws}/ws/agent`);
    a.send(hello(room.tokenA));
    for (const junk of ['{', '[]', 'null', '{"type":"move"}', '{"type":"__proto__"}']) a.send(junk);
    a.send(Buffer.from([1, 2, 3]), { binary: true });
    await a.closed;
    const b = await open(`${ws}/ws/agent`);
    b.send(hello(room.tokenB));
    await until(() => b.inbox.find((m) => m.type === 'config'));
  });
});

test('unknown ws paths are refused', async () => {
  await withServer(async ({ ws, open }) => {
    await assert.rejects(() => open(`${ws}/ws/view/nope`));
    await assert.rejects(() => open(`${ws}/ws/elsewhere`));
  });
});

test('http: create, bad config, view, delete, ip limit, static files', async () => {
  await withServer(async ({ base, post, ws, open }) => {
    const bad = await post({ ...roomCfg, w: 3 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'badConfig');
    const notJson = await fetch(`${base}/api/rooms`, { method: 'POST', body: '{' });
    assert.equal(notJson.status, 400);
    const room = (await post()).body;
    assert.equal((await fetch(`${base}/api/rooms/${room.viewId}/view`)).status, 200);
    assert.equal((await fetch(`${base}/api/rooms/zzz/view`)).status, 404);
    const del = (secret) => fetch(`${base}/api/rooms/${room.roomId}`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}` } });
    assert.equal((await del('wrong')).status, 403);
    const a = await open(`${ws}/ws/agent`);
    a.send(hello(room.tokenA));
    assert.equal((await del(room.creatorSecret)).status, 204);
    assert.equal(await a.closed, 4410);
    assert.equal((await fetch(`${base}/api/rooms/${room.viewId}/view`)).status, 404);
    for (let i = 0; i < 5; i++) assert.equal((await post()).status, 201);
    assert.equal((await post()).status, 429);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
  });
});

test('a finished game is saved and a restarted server resumes the match', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const dbPath = path.join(dir, 't.sqlite');
  let room;
  try {
    await withServer(async ({ ws, post, open, until }) => {
      room = (await post()).body;
      const a = await open(`${ws}/ws/agent`); a.send(hello(room.tokenA));
      const b = await open(`${ws}/ws/agent`); b.send(hello(room.tokenB));
      await until(() => a.inbox.length && b.inbox.length);
      a.send(JSON.stringify({ type: 'ready', ok: true }));
      b.send(JSON.stringify({ type: 'ready', ok: true }));
      for (let i = 0; i < 5; i++) {
        await until(() => a.inbox.filter((m) => m.type === 'go').length > i);
        a.send(JSON.stringify({ type: 'move', gameId: 0, ply: 2 * i, x: i, y: 0 }));
        if (i < 4) {
          await until(() => b.inbox.filter((m) => m.type === 'go').length > i);
          b.send(JSON.stringify({ type: 'move', gameId: 0, ply: 2 * i + 1, x: 2 * i, y: 10 + (i % 2) }));
        }
      }
      await until(() => a.inbox.some((m) => m.type === 'gameOver'));
    }, { dbPath });
    await withServer(async ({ base }) => {
      const snap = (await (await fetch(`${base}/api/rooms/${room.viewId}/view`)).json()).snapshot;
      assert.equal(snap.records.length, 1);
      assert.deepEqual(snap.records[0].result, { winner: 'A', reason: 'five' });
      assert.equal(snap.records[0].moves.length, 9);
    }, { dbPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function raw(port, text) {
  const net = require('node:net');
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let out = '';
    s.on('data', (d) => { out += d; });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
    setTimeout(() => s.destroy(), 500);
  });
}

test('malformed request targets get 400/404 and never crash the server', async () => {
  await withServer(async ({ srv, base }) => {
    for (const target of ['//', '/%00', '/%00.html', '/api/%00', 'http://[']) {
      const reply = await raw(srv.port, `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      assert.match(reply, /^HTTP\/1\.1 (400|404)/, target);
    }
    const upgrade = await raw(srv.port, 'GET // HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    assert.match(upgrade, /^HTTP\/1\.1 (400|404)/);
    assert.equal((await fetch(`${base}/`)).status, 200); // still alive
  });
});

test('trustProxy uses the rightmost X-Forwarded-For entry, which the proxy itself appended', async () => {
  await withServer(async ({ base }) => {
    const post = (xff) => fetch(`${base}/api/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify(roomCfg),
    });
    for (let i = 0; i < 5; i++) assert.equal((await post(`10.0.0.${i}, 9.9.9.9`)).status, 201);
    assert.equal((await post('10.0.0.99, 9.9.9.9')).status, 429); // spoofed left entry changes nothing
    assert.equal((await post('8.8.8.8')).status, 201);
  }, { trustProxy: true });
});

test('engine info and logs are not broadcast to viewers (the other side could read the principal variation)', async () => {
  await withServer(async ({ ws, post, open, until }) => {
    const room = (await post()).body;
    const view = await open(`${ws}/ws/view/${room.viewId}`);
    await until(() => view.inbox.length);
    const a = await open(`${ws}/ws/agent`); a.send(hello(room.tokenA));
    await until(() => a.inbox.find((m) => m.type === 'config'));
    a.send(JSON.stringify({ type: 'info', data: { text: 'depth 9 pv K7 J8' } }));
    a.send(JSON.stringify({ type: 'log', level: 'info', text: 'secret' }));
    a.send(JSON.stringify({ type: 'ready', ok: true }));
    await until(() => view.inbox.find((m) => m.type === 'event' && m.event.type === 'status' && m.event.players.A.ready));
    assert.equal(view.inbox.some((m) => m.type === 'event' && ['info', 'log'].includes(m.event.type)), false);
  });
});
