const { parseLine } = require('./common');

// Classic Gomocup (Piskvork) engine: square freestyle board only. In BOARD blocks 1 = the side to move, 2 = its opponent.
module.exports = {
  name: 'gomocup',
  capabilities: new Set(['stop']),
  start: () => [],
  configure: ({ w, matchMs, turnMs }) => [
    `START ${w}`,
    `INFO timeout_match ${matchMs}`,
    `INFO timeout_turn ${turnMs}`,
    'INFO rule 0',
  ],
  beginSearch: ({ stones, toMove, timeLeftMs }) => (stones.length === 0
    ? [`INFO time_left ${timeLeftMs}`, 'BEGIN']
    : [`INFO time_left ${timeLeftMs}`, 'BOARD', ...stones.map((s) => `${s.x},${s.y},${s.c === toMove ? 1 : 2}`), 'DONE']),
  parseLine,
  stopCommand: () => 'YXSTOP', // not every classic engine honours it; the session restarts it after the grace period
};
