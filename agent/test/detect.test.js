const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
const { EngineProcess } = require('../src/engine-process');
const { detectEngine, checkConfig, probeConfigure } = require('../src/detect');
const rapfi = require('../src/adapters/rapfi');

const FAKE = path.join(__dirname, 'fake-engine.js');
const procs = [];
after(() => { for (const p of procs) if (p.child) p.child.kill('SIGKILL'); });

function engine(env = {}) {
  const p = new EngineProcess(process.execPath, { args: [FAKE], env: { ...process.env, ...env } });
  procs.push(p);
  p.start();
  return p;
}

const cfg = { rule: 'freestyle', w: 15, h: 15, matchMs: 1000, turnMs: 100 };

test('rapfi about is classified rapfi', async () => {
  const info = await detectEngine(engine({ FAKE_KIND: 'rapfi' }));
  assert.deepEqual(info, { kind: 'rapfi', name: 'Rapfi', version: '0.43.02 (fake)', limits: { maxW: 22, maxH: 22 } });
});

test('classic about is classified classic', async () => {
  const info = await detectEngine(engine({ FAKE_KIND: 'classic' }));
  assert.equal(info.kind, 'classic');
  assert.equal(info.name, 'OldBrain');
  assert.deepEqual(info.limits, { maxW: 20, maxH: 20 });
});

test('unknown about is unknown', async () => {
  assert.equal((await detectEngine(engine({ FAKE_KIND: 'unknown' }))).kind, 'unknown');
});

test('an engine that never answers ABOUT is unknown', async () => {
  const p = new EngineProcess(process.execPath, { args: ['-e', "process.stdin.pipe(process.stdout)"] }); // echoes ABOUT back, which is not an ABOUT reply
  procs.push(p); p.start();
  const info = await detectEngine(p, { timeoutMs: 300 });
  assert.equal(info.kind, 'unknown');
});

test('classic rejects rect board', () => {
  const r = checkConfig('classic', { ...cfg, h: 12 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /square/);
});

test('classic rejects standard rule', () => {
  const r = checkConfig('classic', { ...cfg, rule: 'standard' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /freestyle/);
  assert.equal(checkConfig('classic', { ...cfg, rule: 'caro' }).ok, false);
  assert.equal(checkConfig('classic', cfg).ok, true);
});

test('unknown engines and oversize boards are refused', () => {
  assert.equal(checkConfig('unknown', cfg).ok, false);
  assert.equal(checkConfig('classic', { ...cfg, w: 21, h: 21 }).ok, false);
  assert.equal(checkConfig('rapfi', { ...cfg, rule: 'caro', w: 22, h: 5 }).ok, true);
  assert.equal(checkConfig('rapfi', { ...cfg, w: 23, h: 23 }).ok, false);
});

test('rapfi accepts a valid configuration', async () => {
  const p = engine();
  assert.deepEqual(await probeConfigure(p, rapfi, { ...cfg, rule: 'caro', w: 15, h: 12 }), { ok: true });
});

test('rapfi ERROR on RULE is reported with the command', async () => {
  const p = engine({ FAKE_NO_RULE: '1' });
  const r = await probeConfigure(p, rapfi, { ...cfg, rule: 'caro' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /INFO RULE 8/);
  assert.match(r.reason, /Unknown info rule/);
});

test('probe reports an engine that stops answering', async () => {
  const p = new EngineProcess(process.execPath, { args: ['-e', "process.stdin.pipe(process.stdout)"] });
  procs.push(p); p.start();
  const r = await probeConfigure(p, rapfi, cfg, { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /START 15/);
});

test('refusals carry a code and args for the UI', async () => {
  assert.deepEqual(checkConfig('unknown', cfg), { ok: false, code: 'unknownEngine', args: {}, reason: 'engine type not recognised' });
  const sq = checkConfig('classic', { ...cfg, h: 12 });
  assert.equal(sq.code, 'classicSquareOnly');
  assert.equal(checkConfig('classic', { ...cfg, rule: 'caro' }).code, 'classicFreestyleOnly');
  const big = checkConfig('rapfi', { ...cfg, w: 23, h: 23 });
  assert.deepEqual([big.code, big.args], ['boardLimit', { w: 23, h: 23, maxW: 22, maxH: 22 }]);
  const p = engine({ FAKE_NO_RULE: '1' });
  const r = await probeConfigure(p, rapfi, { ...cfg, rule: 'caro' });
  assert.equal(r.code, 'engineRejected');
  assert.deepEqual(r.args, { command: 'INFO RULE 8', error: 'Unknown info rule' });
  const dead = new EngineProcess(process.execPath, { args: ['-e', "process.stdin.pipe(process.stdout)"] }); procs.push(dead); dead.start();
  assert.equal((await probeConfigure(dead, rapfi, cfg, { timeoutMs: 200 })).code, 'engineNoAnswer');
});
