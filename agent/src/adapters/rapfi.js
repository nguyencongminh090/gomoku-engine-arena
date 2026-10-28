const { RULES } = require('../../../server/src/rules');
const { parseLine } = require('./common');

const UNLIMITED = 2147483647;

// Rapfi: understands Free Caro / Standard, rectangular boards and the Yixin STOP commands.
module.exports = {
  name: 'rapfi',
  capabilities: new Set(['rect', 'standard', 'caro', 'stop']),
  start: () => [],
  configure: ({ rule, w, h, matchMs, turnMs }) => [
    w === h ? `START ${w}` : `RECTSTART ${w},${h}`,
    `INFO RULE ${RULES[rule]}`,
    `INFO TIMEOUT_MATCH ${matchMs}`,
    `INFO TIMEOUT_TURN ${turnMs > 0 ? turnMs : UNLIMITED}`,
  ],
  // BOARD replaces the whole position and starts the search. Colours are absolute (1 = first stone's side),
  // which Rapfi resolves from the first entry, so no relative mapping is needed.
  // The move budget is sent with every search: after a reconnect it is shorter than the configured one.
  beginSearch: ({ stones, timeLeftMs, turnMs }) => {
    const budget = [`INFO TIMEOUT_TURN ${turnMs > 0 ? turnMs : UNLIMITED}`, `INFO TIME_LEFT ${timeLeftMs}`];
    return stones.length === 0
      ? ['RESTART', ...budget, 'BEGIN']
      : [...budget, 'BOARD', ...stones.map((s) => `${s.x},${s.y},${s.c}`), 'DONE'];
  },
  parseLine,
  stopCommand: () => 'YXSTOP',
};
