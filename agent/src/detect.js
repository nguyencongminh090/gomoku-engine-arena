// Works out what kind of engine sits behind a process and whether it can play a given room config.
// Anything uncertain is refused: a wrong guess would make a game fail halfway through.
const LIMITS = { rapfi: { maxW: 22, maxH: 22 }, classic: { maxW: 20, maxH: 20 } };
const ABOUT_REPLY = /^name\s*=/i;

// Sends `commands` one by one, each followed by ABOUT as a sentinel (every engine answers it when idle),
// and returns the lines the engine printed between the command and the sentinel.
function exchange(proc, command, timeoutMs) {
  return new Promise((resolve) => {
    const lines = [];
    const finish = (answered) => {
      clearTimeout(timer);
      proc.off('line', onLine);
      resolve({ answered, lines });
    };
    const onLine = (line) => { if (ABOUT_REPLY.test(line.trim())) finish(true); else lines.push(line); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    proc.on('line', onLine);
    if (command) proc.write(command);
    proc.write('ABOUT');
  });
}

async function detectEngine(proc, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const unknown = { kind: 'unknown', name: 'unknown', version: '', limits: { maxW: 0, maxH: 0 } };
    const timer = setTimeout(() => { proc.off('line', onLine); resolve(unknown); }, timeoutMs);
    const onLine = (line) => {
      const text = line.trim();
      if (!ABOUT_REPLY.test(text)) return;
      clearTimeout(timer);
      proc.off('line', onLine);
      const name = /name\s*=\s*"([^"]*)"/i.exec(text);
      const version = /version\s*=\s*"([^"]*)"/i.exec(text);
      if (!name) return resolve(unknown);
      const kind = /rapfi/i.test(name[1]) ? 'rapfi' : 'classic';
      return resolve({ kind, name: name[1], version: version ? version[1] : '', limits: { ...LIMITS[kind] } });
    };
    proc.on('line', onLine);
    proc.write('ABOUT');
  });
}

// Static checks that need no engine round trip.
function checkConfig(kind, cfg) {
  const limits = LIMITS[kind];
  const refuse = (code, args, reason) => ({ ok: false, code, args, reason });
  if (!limits) return refuse('unknownEngine', {}, 'engine type not recognised');
  if (cfg.w > limits.maxW || cfg.h > limits.maxH) {
    return refuse('boardLimit', { w: cfg.w, h: cfg.h, maxW: limits.maxW, maxH: limits.maxH }, `board ${cfg.w}x${cfg.h} exceeds this engine's limit ${limits.maxW}x${limits.maxH}`);
  }
  if (kind === 'classic') {
    if (cfg.w !== cfg.h) return refuse('classicSquareOnly', {}, 'classic Gomocup engine supports only square boards');
    if (cfg.rule !== 'freestyle') return refuse('classicFreestyleOnly', {}, 'classic Gomocup engine supports only the freestyle rule');
  }
  return { ok: true };
}

// Applies the room configuration to the engine for real, command by command, and refuses on the first ERROR.
async function probeConfigure(proc, adapter, cfg, { timeoutMs = 3000 } = {}) {
  for (const command of [...adapter.start(), ...adapter.configure(cfg)]) {
    const { answered, lines } = await exchange(proc, command, timeoutMs);
    if (!answered) return { ok: false, code: 'engineNoAnswer', args: { command }, reason: `engine did not answer after "${command}"` };
    const errors = lines.map((l) => adapter.parseLine(l)).filter((m) => m && m.type === 'error').map((m) => m.text);
    if (errors.length) return { ok: false, code: 'engineRejected', args: { command, error: errors.join('; ').slice(0, 200) }, reason: `engine rejected "${command}": ${errors.join('; ')}` };
  }
  return { ok: true };
}

module.exports = { detectEngine, checkConfig, probeConfigure, LIMITS };
