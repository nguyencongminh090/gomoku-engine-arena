// Output lines shared by Gomocup-style engines.
function parseLine(raw) {
  const line = raw.trim();
  if (!line) return null;
  const move = /^(\d+),(\d+)$/.exec(line);
  if (move) return { type: 'move', x: Number(move[1]), y: Number(move[2]) };
  if (line === 'OK') return { type: 'ok' };
  if (line.startsWith('ERROR')) return { type: 'error', text: line.slice(5).trim() };
  if (line.startsWith('MESSAGE ')) return { type: 'info', data: { text: line.slice(8) } };
  return null;
}

module.exports = { parseLine };
