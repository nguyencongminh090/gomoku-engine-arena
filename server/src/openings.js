const { Board } = require('./board');
const { checkWin } = require('./rules');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// One opening per line: "x,y" cells separated by whitespace or ';'. "-" is the empty board.
// Stones alternate colour 1, 2, 1, ... in the order written.
function parseOpenings(text, w, h, rule) {
  const openings = [];
  for (const [lineNo, line] of String(text).split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed === '-') {
      openings.push([]);
      continue;
    }
    const board = new Board(w, h);
    const cells = [];
    for (const token of trimmed.split(/[\s;]+/).filter(Boolean)) {
      const m = /^(\d+),(\d+)$/.exec(token);
      if (!m) throw fail('syntax', `line ${lineNo + 1}: bad cell "${token}"`);
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (!board.inBounds(x, y)) throw fail('range', `line ${lineNo + 1}: ${x},${y} is outside the board`);
      if (board.get(x, y) !== 0) throw fail('duplicate', `line ${lineNo + 1}: ${x},${y} repeated`);
      board.set(x, y, (cells.length % 2) + 1);
      if (checkWin(board, x, y, rule)) throw fail('winning', `line ${lineNo + 1}: opening already contains a win`);
      cells.push({ x, y });
    }
    openings.push(cells);
  }
  if (openings.length === 0) throw fail('empty', 'no openings given');
  return openings;
}

module.exports = { parseOpenings };
