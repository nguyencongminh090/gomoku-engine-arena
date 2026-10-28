// Authoritative m x n board. Cells hold 0 (empty), 1 or 2 (player colour).
class Board {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h);
    this.count = 0;
  }

  static fromStones(w, h, stones) {
    const board = new Board(w, h);
    for (const { x, y, c } of stones) board.set(x, y, c);
    return board;
  }

  inBounds(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x, y) {
    return this.cells[y * this.w + x];
  }

  set(x, y, player) {
    const i = y * this.w + x;
    if (this.cells[i] === 0 && player !== 0) this.count++;
    else if (this.cells[i] !== 0 && player === 0) this.count--;
    this.cells[i] = player;
  }

  isFull() {
    return this.count === this.w * this.h;
  }
}

module.exports = { Board };
