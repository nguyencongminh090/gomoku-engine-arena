// INFO RULE values understood by Rapfi.
const RULES = { freestyle: 0, standard: 1, caro: 8 };

const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// Number of consecutive stones of `c` from (x,y) stepping (dx,dy), excluding (x,y).
function run(board, x, y, dx, dy, c) {
  let n = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (board.inBounds(cx, cy) && board.get(cx, cy) === c) {
    n++;
    cx += dx;
    cy += dy;
  }
  return n;
}

// Does the opponent of `c` sit on (x,y)? Off-board and empty cells do not block.
function blockedBy(board, x, y, c) {
  return board.inBounds(x, y) && board.get(x, y) !== 0 && board.get(x, y) !== c;
}

// True when the stone just placed at (x,y) wins. Only the four lines through (x,y) are examined.
function checkWin(board, x, y, rule) {
  const c = board.get(x, y);
  if (c === 0) return false;
  for (const [dx, dy] of DIRECTIONS) {
    const fwd = run(board, x, y, dx, dy, c);
    const back = run(board, x, y, -dx, -dy, c);
    const n = 1 + fwd + back;
    if (rule === 'freestyle') {
      if (n >= 5) return true;
    } else if (rule === 'standard') {
      if (n === 5) return true;
    } else if (rule === 'caro') {
      if (n >= 6) return true;
      if (n === 5) {
        const a = blockedBy(board, x + (fwd + 1) * dx, y + (fwd + 1) * dy, c);
        const b = blockedBy(board, x - (back + 1) * dx, y - (back + 1) * dy, c);
        if (!(a && b)) return true;
      }
    } else {
      throw new Error(`unknown rule: ${rule}`);
    }
  }
  return false;
}

module.exports = { RULES, checkWin };
