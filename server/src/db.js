const Database = require('better-sqlite3');

// Persistence for rooms (token hashes only) and finished games. Game record shape:
// { gameIndex, firstPlayer, opening: {x,y}[], moves: {ply,player,x,y,elapsedMs}[], result: {winner, reason} }
function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, ip TEXT NOT NULL, cfg TEXT NOT NULL,
      hash_a TEXT NOT NULL, hash_b TEXT NOT NULL, hash_secret TEXT NOT NULL,
      view_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_active INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      game_index INTEGER NOT NULL, first_player TEXT NOT NULL, opening TEXT NOT NULL,
      winner TEXT, reason TEXT NOT NULL,
      PRIMARY KEY (room_id, game_index)
    );
    CREATE TABLE IF NOT EXISTS moves (
      room_id TEXT NOT NULL, game_index INTEGER NOT NULL, ply INTEGER NOT NULL,
      player TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL,
      PRIMARY KEY (room_id, game_index, ply),
      FOREIGN KEY (room_id, game_index) REFERENCES games(room_id, game_index) ON DELETE CASCADE
    );
  `);

  const q = {
    insertRoom: db.prepare('INSERT INTO rooms VALUES (@id,@ip,@cfg,@hashA,@hashB,@hashSecret,@viewId,@createdAt,@lastActive)'),
    deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
    touchRoom: db.prepare('UPDATE rooms SET last_active = ? WHERE id = ?'),
    allRooms: db.prepare('SELECT id, ip, cfg, hash_a AS hashA, hash_b AS hashB, hash_secret AS hashSecret, view_id AS viewId, created_at AS createdAt, last_active AS lastActive FROM rooms'),
    delGame: db.prepare('DELETE FROM games WHERE room_id = ? AND game_index = ?'),
    insGame: db.prepare('INSERT INTO games VALUES (?,?,?,?,?,?)'),
    insMove: db.prepare('INSERT INTO moves VALUES (?,?,?,?,?,?,?)'),
    games: db.prepare('SELECT * FROM games WHERE room_id = ? ORDER BY game_index'),
    moves: db.prepare('SELECT * FROM moves WHERE room_id = ? AND game_index = ? ORDER BY ply'),
  };

  const saveGame = db.transaction((roomId, g) => {
    q.delGame.run(roomId, g.gameIndex); // cascades to moves
    q.insGame.run(roomId, g.gameIndex, g.firstPlayer, JSON.stringify(g.opening), g.result.winner, g.result.reason);
    for (const m of g.moves) q.insMove.run(roomId, g.gameIndex, m.ply, m.player, m.x, m.y, m.elapsedMs);
  });

  return {
    insertRoom: (r) => { q.insertRoom.run({ ...r, cfg: JSON.stringify(r.cfg) }); },
    deleteRoom: (id) => q.deleteRoom.run(id).changes > 0,
    touchRoom: (id, at) => { q.touchRoom.run(at, id); },
    allRooms: () => q.allRooms.all().map((r) => ({ ...r, cfg: JSON.parse(r.cfg) })),
    saveGame,
    loadMatch: (roomId) => ({
      games: q.games.all(roomId).map((g) => ({
        gameIndex: g.game_index,
        firstPlayer: g.first_player,
        opening: JSON.parse(g.opening),
        moves: q.moves.all(roomId, g.game_index).map((m) => ({ ply: m.ply, player: m.player, x: m.x, y: m.y, elapsedMs: m.elapsed_ms })),
        result: { winner: g.winner, reason: g.reason },
      })),
    }),
    close: () => db.close(),
  };
}

module.exports = { openDb };
