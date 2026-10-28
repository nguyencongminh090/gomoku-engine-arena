// Wire messages between server and agents. Everything is one JSON object per WebSocket text frame.
const MAX_MESSAGE_BYTES = 16384;
const RULE_NAMES = ['freestyle', 'standard', 'caro'];
const ENGINE_KINDS = ['rapfi', 'classic', 'unknown']; // 'unknown' lets an agent say hello and then refuse at `ready`

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string';
const no = (reason) => ({ ok: false, reason });
const isScalar = (v) => (isStr(v) ? v.length <= 200 : typeof v === 'number' || typeof v === 'boolean');
const isArgs = (v) => isObj(v) && Object.keys(v).length <= 8 && Object.values(v).every(isScalar);

function decode(raw) {
  const text = Buffer.isBuffer(raw) ? raw : String(raw);
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) return no('oversize');
  let msg;
  try { msg = JSON.parse(text.toString()); } catch { return no('badJson'); }
  if (!isObj(msg)) return no('badShape');
  return { ok: true, msg };
}

const CLIENT = {
  hello: (m) => isStr(m.token) && m.token.length > 0 && m.token.length <= 256
    && isObj(m.engine) && isStr(m.engine.name) && isStr(m.engine.version) && ENGINE_KINDS.includes(m.engine.kind)
    && isObj(m.limits) && isInt(m.limits.maxW) && isInt(m.limits.maxH),
  // `code` + `args` let the UI translate a refusal; `reason` stays as English text for logs and unknown codes.
  ready: (m) => typeof m.ok === 'boolean' && (m.reason === undefined || isStr(m.reason))
    && (m.code === undefined || (isStr(m.code) && m.code.length <= 64))
    && (m.args === undefined || isArgs(m.args)),
  move: (m) => isInt(m.gameId) && m.gameId >= 0 && isInt(m.ply) && m.ply >= 0 && isInt(m.x) && isInt(m.y),
  info: (m) => isObj(m.data),
  log: (m) => isStr(m.level) && isStr(m.text),
};

// Parses a frame sent by an agent or a viewer. Viewers may not send anything.
function parseClientMessage(raw, role) {
  const d = decode(raw);
  if (!d.ok) return d;
  if (role !== 'agent') return no('viewerReadOnly');
  const check = Object.hasOwn(CLIENT, d.msg.type) ? CLIENT[d.msg.type] : null;
  if (!check) return no('unknownType');
  return check(d.msg) ? d : no('badMessage');
}

const isStones = (v) => Array.isArray(v) && v.every((s) => isObj(s) && isInt(s.x) && isInt(s.y) && (s.c === 1 || s.c === 2));

const SERVER = {
  config: (m) => RULE_NAMES.includes(m.rule) && isInt(m.w) && isInt(m.h) && isInt(m.matchMs) && isInt(m.turnMs),
  go: (m) => isInt(m.gameId) && isInt(m.ply) && isStones(m.stones) && (m.toMove === 1 || m.toMove === 2)
    && isInt(m.timeLeftMs) && isInt(m.turnMs),
  stop: () => true,
  gameOver: (m) => isInt(m.gameId) && isObj(m.result),
  ping: () => true,
};

// Used by the agent to validate what the server sent it.
function parseServerMessage(raw) {
  const d = decode(raw);
  if (!d.ok) return d;
  const check = Object.hasOwn(SERVER, d.msg.type) ? SERVER[d.msg.type] : null;
  if (!check) return no('unknownType');
  return check(d.msg) ? d : no('badMessage');
}

const out = (type, body) => JSON.stringify({ type, ...body });

module.exports = {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  parseServerMessage,
  // `go.toMove` is the colour (1|2) to play; `timeLeftMs` is that player's remaining match time.
  config: ({ rule, w, h, matchMs, turnMs }) => out('config', { rule, w, h, matchMs, turnMs }),
  go: ({ gameId, ply, stones, toMove, timeLeftMs, turnMs }) => out('go', { gameId, ply, stones, toMove, timeLeftMs, turnMs }),
  stop: () => out('stop', {}),
  gameOver: ({ gameId, result }) => out('gameOver', { gameId, result }),
  ping: () => out('ping', {}),
};
