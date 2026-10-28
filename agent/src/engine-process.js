const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const readline = require('node:readline');

// Wraps one engine executable. Emits 'line' (stdout), 'stderr', 'exit' (current child only) and 'restart'.
// Runs in the engine's own directory so it finds its config and network files
// (as extension_vncaro/server/bridge/process.py does).
class EngineProcess extends EventEmitter {
  constructor(exePath, { args = [], env = process.env, cwd } = {}) {
    super();
    this.exePath = exePath;
    this.args = args;
    this.env = env;
    this.cwd = cwd || path.dirname(path.resolve(exePath));
    this.child = null;
  }

  get running() { return this.child !== null; }

  start() {
    if (this.child) return;
    const child = spawn(path.resolve(this.exePath), this.args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    // Late events from a replaced child must never be mistaken for the current one.
    const current = () => this.child === child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => { if (current()) this.emit('line', line); });
    readline.createInterface({ input: child.stderr }).on('line', (line) => { if (current()) this.emit('stderr', line); });
    child.stdin.on('error', () => {}); // EPIPE when the engine has already gone
    child.on('error', (err) => { if (current()) { this.child = null; this.emit('exit', null, err); } });
    child.on('exit', (code) => { if (current()) { this.child = null; this.emit('exit', code); } });
  }

  write(line) {
    if (this.child && this.child.stdin.writable) this.child.stdin.write(`${line}\n`);
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    this.write('END');
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    await exited;
    clearTimeout(timer);
  }

  restart() {
    const old = this.child;
    this.child = null; // detach first: the old child's remaining events are now ignored
    if (old) old.kill('SIGKILL');
    this.start();
    this.emit('restart');
  }
}

module.exports = { EngineProcess };
