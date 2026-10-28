const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EngineProcess } = require('../src/engine-process');
const { SearchSession } = require('../src/search');
const rapfi = require('../src/adapters/rapfi');
const gomocup = require('../src/adapters/gomocup');

const FAKE = path.join(__dirname, 'fake-engine.js');
const cfg = { rule: 'freestyle', w: 15, h: 15, matchMs: 600000, turnMs: 0 };
const req = (stones, extra = {}) => ({ stones, toMove: (stones.length % 2) + 1, timeLeftMs: 600000, turnMs: 0, w: 15, h: 15, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const procs = [];
// A failing assertion must never leave an engine behind, or the runner would not exit.
after(() => { for (const p of procs) if (p.child) p.child.kill('SIGKILL'); });

async function make(env = {}, opts = {}, adapter = rapfi) {
  const proc = new EngineProcess(FAKE, { env: { ...process.env, ...env } });
  procs.push(proc);
  proc.start();
  const session = new SearchSession(proc, adapter, opts);
  session.configure(cfg);
  await sleep(150); // let the fake print OK for START
  return { proc, session, done: () => proc.stop() };
}

test('search returns the engine move', async () => {
  const { session, done } = await make();
  assert.deepEqual(await session.search(req([])), { x: 0, y: 0 });
  assert.deepEqual(await session.search(req([{ x: 0, y: 0, c: 1 }, { x: 1, y: 0, c: 2 }])), { x: 2, y: 0 });
  await done();
});

test('abort waits for the single stray move line', async () => {
  const { session, done } = await make({ FAKE_THINK_MS: '5000', FAKE_STOP_DELAY: '200' });
  const pending = session.search(req([]));
  await sleep(100);
  const t0 = Date.now();
  await session.abort();
  assert.ok(Date.now() - t0 >= 150, 'abort returned before the engine answered');
  assert.equal(await pending, null); // aborted result is discarded
  assert.equal(session.state, 'idle');
  await done();
});

test('a new search after abort is not desynced by the stray move', async () => {
  const { session, done } = await make({ FAKE_THINK_MS: '30', FAKE_STOP_DELAY: '150' });
  const first = session.search(req([]));
  await sleep(10); // still thinking
  await session.abort();
  await first;
  // If abort had returned before the stray "0,0" arrived, it would answer this search.
  assert.deepEqual(await session.search(req([{ x: 0, y: 0, c: 1 }])), { x: 1, y: 0 });
  await done();
});

test('abort restarts a hung engine after grace', async () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-')), 'log.txt');
  const { session, proc, done } = await make({ FAKE_THINK_MS: '60000', FAKE_HANG: '1', FAKE_LOG: log }, { graceMs: 300 });
  const pid = proc.child.pid;
  const pending = session.search(req([]));
  await sleep(50);
  const t0 = Date.now();
  await session.abort();
  assert.ok(Date.now() - t0 >= 280);
  assert.equal(await pending, null);
  assert.notEqual(proc.child.pid, pid, 'engine was not restarted');
  assert.equal(session.state, 'idle');
  // The new process was re-initialised by the session: START was sent to both processes.
  const starts = () => fs.readFileSync(log, 'utf8').split('\n').filter((l) => l === 'START 15').length;
  for (let i = 0; i < 100 && starts() < 2; i++) await sleep(50);
  assert.equal(starts(), 2);
  await done();
});

test('after a restart the engine is configured again and searches work', async () => {
  const { session, proc, done } = await make({ FAKE_THINK_MS: '30' }, { graceMs: 200 });
  proc.restart();
  await sleep(200);
  assert.deepEqual(await session.search(req([])), { x: 0, y: 0 });
  await done();
});

test('extra unsolicited move line is ignored', async () => {
  const { session, done } = await make({ FAKE_STRAY: '1' });
  assert.deepEqual(await session.search(req([])), { x: 0, y: 0 });
  assert.deepEqual(await session.search(req([{ x: 0, y: 0, c: 1 }])), { x: 1, y: 0 });
  await done();
});

test('search while busy is rejected and abort when idle is a no-op', async () => {
  const { session, done } = await make({ FAKE_THINK_MS: '300' });
  await session.abort();
  const first = session.search(req([]));
  await assert.rejects(() => session.search(req([])), { code: 'busy' });
  assert.deepEqual(await first, { x: 0, y: 0 });
  await done();
});

test('engine that dies mid-search rejects the search and is restarted by the next one', async () => {
  const { session, proc, done } = await make({ FAKE_THINK_MS: '5000' });
  const pending = session.search(req([]));
  await sleep(50);
  proc.child.kill('SIGKILL');
  await assert.rejects(() => pending, /exit/);
  assert.equal(session.state, 'idle');
  proc.env.FAKE_THINK_MS = '30';
  await sleep(50);
  assert.deepEqual(await session.search(req([])), { x: 0, y: 0 });
  await done();
});

test('classic adapter: an empty-board search after a finished game starts from a clean board', async () => {
  const { session, done } = await make({ FAKE_KIND: 'classic' }, {}, gomocup);
  assert.deepEqual(await session.search(req([])), { x: 0, y: 0 });
  // Game 2 on the same engine: it moves first on an empty board, but the engine still holds game 1's stone.
  const second = await Promise.race([session.search(req([])), sleep(2000).then(() => 'stale board')]);
  assert.deepEqual(second, { x: 0, y: 0 });
  await done();
});
