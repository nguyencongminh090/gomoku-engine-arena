// Client model of one match, built from the server's snapshot and event stream. `reduce` is pure.
(function () {
  const TS = (window.TestSite = window.TestSite || {});
  const other = (p) => (p === 'A' ? 'B' : 'A');

  const stonesOf = (opening, moves) => {
    const stones = opening.map((s, i) => ({ x: s.x, y: s.y, c: (i % 2) + 1 }));
    for (const m of moves) stones.push({ x: m.x, y: m.y, c: (stones.length % 2) + 1 });
    return stones;
  };

  // Position after the first `ply` stones (opening included) of a finished game record.
  const positionAt = (record, ply) => stonesOf(record.opening, record.moves).slice(0, ply);

  function fromSnapshot(snap, now) {
    const cur = snap.current;
    return {
      state: snap.state, cfg: snap.cfg, players: snap.players, score: snap.score, records: snap.records, winner: undefined,
      current: cur && { ...cur, receivedAt: now },
    };
  }

  function reduce(model, msg, now = Date.now()) {
    if (msg.type === 'snapshot') return fromSnapshot(msg.snapshot, now);
    if (msg.type !== 'event' || !model) return model;
    const e = msg.event;
    switch (e.type) {
      case 'status':
        return { ...model, state: e.state === 'done' ? 'done' : e.state, players: e.players };
      case 'gameStart': {
        const left = model.cfg.matchMs;
        return {
          ...model, state: 'playing',
          current: {
            gameIndex: e.gameIndex, firstPlayer: e.firstPlayer, ply: e.opening.length,
            toMove: e.opening.length % 2 === 0 ? e.firstPlayer : other(e.firstPlayer),
            stones: stonesOf(e.opening, []), moves: [], timeLeftMs: { A: left, B: left }, receivedAt: now,
          },
        };
      }
      case 'move': {
        const cur = model.current;
        if (!cur || cur.gameIndex !== e.gameIndex) return model;
        return {
          ...model,
          current: {
            ...cur, ply: e.ply + 1, toMove: other(e.player),
            stones: [...cur.stones, { x: e.x, y: e.y, c: (e.ply % 2) + 1 }],
            moves: [...cur.moves, { ply: e.ply, player: e.player, x: e.x, y: e.y, elapsedMs: e.elapsedMs }],
            timeLeftMs: e.timeLeftMs, receivedAt: now,
          },
        };
      }
      case 'gameOver':
        return { ...model, state: 'between', current: null, records: [...model.records, e.record], score: e.score };
      case 'matchOver':
        return { ...model, state: 'done', current: null, score: e.score, winner: e.winner };
      default:
        return model;
    }
  }

  // Remaining time to show for a player: the mover's clock keeps running since the last update.
  function clockMs(model, player, now = Date.now()) {
    const cur = model && model.current;
    if (!cur) return model ? model.cfg.matchMs : 0;
    const base = cur.timeLeftMs[player];
    return cur.toMove === player ? Math.max(0, base - (now - cur.receivedAt)) : base;
  }

  // Opens the view socket, feeds `onModel` and reconnects after a drop. Returns { close }.
  function connect(viewId, { onModel, onState }) {
    let model = null;
    let ws = null;
    let closed = false;
    const open = () => {
      onState('connecting');
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/view/${encodeURIComponent(viewId)}`);
      ws.onopen = () => onState('open');
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        model = reduce(model, msg);
        if (model) onModel(model);
      };
      ws.onclose = (ev) => {
        if (closed) return;
        onState(ev.code === 4410 ? 'gone' : 'lost');
        if (ev.code !== 4410) setTimeout(open, 2000);
      };
    };
    open();
    return { close() { closed = true; if (ws) ws.close(); } };
  }

  TS.live = { reduce, clockMs, positionAt, stonesOf, connect };
}());
