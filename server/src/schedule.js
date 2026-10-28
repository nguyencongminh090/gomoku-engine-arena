// Opening i is played in games 2i and 2i+1 with the first mover swapped.
function buildSchedule(openings, games) {
  if (openings.length < Math.ceil(games / 2)) {
    const err = new Error(`need at least ${Math.ceil(games / 2)} openings for ${games} games, got ${openings.length}`);
    err.code = 'tooFew';
    throw err;
  }
  return Array.from({ length: games }, (_, gameIndex) => ({
    gameIndex,
    opening: openings[gameIndex >> 1],
    firstPlayer: gameIndex % 2 === 0 ? 'A' : 'B',
  }));
}

module.exports = { buildSchedule };
