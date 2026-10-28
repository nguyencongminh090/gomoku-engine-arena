const { parseLine } = require('./common');

const UNLIMITED = 2147483647; // Gomocup reads timeout_turn 0 as "as fast as possible"

// Classic Gomocup (Piskvork) engine: square freestyle board only. In BOARD blocks 1 = the side to move, 2 = its opponent.
module.exports = {
  name: 'gomocup',
  capabilities: new Set(['stop']),
  start: () => [],
  configure: ({ w, matchMs, turnMs }) => [
    `START ${w}`,
    `INFO timeout_match ${matchMs}`,
    `INFO timeout_turn ${turnMs > 0 ? turnMs : UNLIMITED}`,
    'INFO rule 0',
  ],
  // An empty position is an empty BOARD block, which replaces whatever the engine still holds from the
  // previous game; BEGIN would not clear it (and Rapfi answers it with ERROR Board is not empty).
  beginSearch: ({ stones, toMove, timeLeftMs, turnMs }) => [
    `INFO timeout_turn ${turnMs > 0 ? turnMs : UNLIMITED}`,
    `INFO time_left ${timeLeftMs}`,
    'BOARD',
    ...stones.map((s) => `${s.x},${s.y},${s.c === toMove ? 1 : 2}`),
    'DONE',
  ],
  parseLine,
  stopCommand: () => 'YXSTOP', // not every classic engine honours it; the session restarts it after the grace period
};
