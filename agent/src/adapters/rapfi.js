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
  beginSearch: ({ stones, timeLeftMs }) => (stones.length === 0
    ? ['RESTART', `INFO TIME_LEFT ${timeLeftMs}`, 'BEGIN']
    : [`INFO TIME_LEFT ${timeLeftMs}`, 'BOARD', ...stones.map((s) => `${s.x},${s.y},${s.c}`), 'DONE']),
  parseLine,
  stopCommand: () => 'YXSTOP',
};
