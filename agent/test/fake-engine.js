#!/usr/bin/env node
// Scriptable stand-in for a Gomocup/Rapfi engine. Behaviour via environment:
//   FAKE_THINK_MS     search length (default 30)
//   FAKE_KIND         ABOUT flavour: rapfi (default) | classic | unknown
//   FAKE_STOP_DELAY   ms between STOP and the move line it provokes (default 0)
//   FAKE_SILENT_STOP  1 = never answers an aborted search
//   FAKE_HANG         1 = ignores STOP entirely, thinks until killed
//   FAKE_STRAY        1 = prints an extra unsolicited "9,9" after every move
//   FAKE_NO_RULE      1 = answers INFO RULE with ERROR (engine without that extension)
//   FAKE_LOG          file that receives every received line
// The move is the first empty cell in row-major order, so it identifies the position that was searched.
const fs = require('node:fs');
const readline = require('node:readline');

const env = process.env;
const thinkMs = Number(env.FAKE_THINK_MS || 30);
const kind = env.FAKE_KIND || 'rapfi';
const out = (s) => process.stdout.write(`${s}\n`);

let w = 0, h = 0, started = false;
let stones = new Set();
let block = null; // { search: bool } while reading a BOARD/YXBOARD block
let timer = null;
let thinking = false;

function pickMove() {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!stones.has(`${x},${y}`)) return `${x},${y}`;
  return '-1,-1';
}

function finish() {
  thinking = false;
  timer = null;
  const mv = pickMove();
  const [x, y] = mv.split(',');
  stones.add(`${x},${y}`);
  out(env.FAKE_STRAY === '1' ? `${mv}\n9,9` : mv); // one write, so both lines arrive together
}

function think() {
  thinking = true;
  timer = setTimeout(finish, thinkMs);
}

readline.createInterface({ input: process.stdin }).on('line', (raw) => {
  if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, `${raw}\n`);
  const line = raw.trim();
  if (!line) return;
  const [cmd, ...rest] = line.split(/\s+/);
  const CMD = cmd.toUpperCase();
  if (CMD === 'END') process.exit(0);
  if (thinking) {
    if ((CMD === 'STOP' || CMD === 'YXSTOP') && env.FAKE_HANG !== '1') {
      clearTimeout(timer);
      thinking = false;
      if (env.FAKE_SILENT_STOP !== '1') setTimeout(() => { const mv = pickMove(); stones.add(mv); out(mv); }, Number(env.FAKE_STOP_DELAY || 0));
    }
    return; // everything else is ignored while thinking
  }
  if (block) {
    if (CMD === 'DONE') {
      const b = block;
      block = null;
      if (b.search) think();
      return;
    }
    const [x, y] = line.split(',');
    stones.add(`${Number(x)},${Number(y)}`);
    return;
  }
  switch (CMD) {
    case 'ABOUT':
      if (kind === 'rapfi') out('name="Rapfi", version="0.43.02 (fake)", author="Rapfi developers", country="China"');
      else if (kind === 'classic') out('name="OldBrain", version="1.0", author="Someone", country="VN"');
      else out('what is this');
      break;
    case 'START': w = h = Number(rest[0]); started = true; stones = new Set(); out('OK'); break;
    case 'RECTSTART': [w, h] = rest[0].split(',').map(Number); started = true; stones = new Set(); out('OK'); break;
    case 'RESTART': stones = new Set(); out('OK'); break;
    case 'INFO':
      if (rest[0] && rest[0].toUpperCase() === 'RULE' && env.FAKE_NO_RULE === '1') out('ERROR Unknown info rule');
      break;
    case 'BOARD': case 'YXBOARD':
      if (!started) { out('ERROR game not started'); break; }
      stones = new Set();
      block = { search: CMD === 'BOARD' };
      break;
    case 'BEGIN': if (!started) out('ERROR game not started'); else think(); break;
    case 'TURN': { const [x, y] = rest[0].split(','); stones.add(`${Number(x)},${Number(y)}`); think(); break; }
    default: out(`UNKNOWN ${cmd}`);
  }
});
