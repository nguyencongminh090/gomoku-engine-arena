(function () {
  const TS = window.TestSite;
  const t = TS.t;
  const { live, board } = TS;
  const $ = (id) => document.getElementById(id);
  const viewId = new URLSearchParams(location.search).get('v');

  let model = null;
  let connState = 'connecting';
  // view = { live: true } follows the running game; { gameIndex, ply } replays a finished one.
  let view = { live: true };

  const el = (tag, props = {}, ...children) => { const e = document.createElement(tag); Object.assign(e, props); for (const c of children) e.append(c); return e; };
  const fmtClock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtSec = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const resultText = (r) => `${r.winner ? t('watch.winnerOf', { p: r.winner }) : t('watch.drawGame')} — ${t(`result.${r.reason}`)}`;

  // The position and move list the board currently shows.
  function shown() {
    if (!model) return null;
    if (!view.live) {
      const rec = model.records.find((r) => r.gameIndex === view.gameIndex);
      if (rec) {
        const all = live.stonesOf(rec.opening, rec.moves);
        const ply = Math.min(Math.max(view.ply, 0), all.length);
        return { title: t('watch.game', { n: rec.gameIndex + 1 }), stones: all.slice(0, ply), total: all.length, ply, opening: rec.opening.length, moves: rec.moves, result: rec.result, first: rec.firstPlayer, replay: true };
      }
    }
    if (model.current) {
      const c = model.current;
      return { title: t('watch.game', { n: c.gameIndex + 1 }), stones: c.stones, total: c.stones.length, ply: c.stones.length, opening: c.stones.length - c.moves.length, moves: c.moves, first: c.firstPlayer, replay: false };
    }
    const last = model.records.at(-1);
    if (last) {
      const all = live.stonesOf(last.opening, last.moves);
      return { title: t('watch.game', { n: last.gameIndex + 1 }), stones: all, total: all.length, ply: all.length, opening: last.opening.length, moves: last.moves, result: last.result, first: last.firstPlayer, replay: false };
    }
    return { title: '', stones: [], total: 0, ply: 0, opening: 0, moves: [], replay: false };
  }

  function renderBoard(s) {
    if (!model) return;
    const { w, h } = model.cfg;
    const last = s.stones.length > s.opening ? s.stones[s.stones.length - 1] : null;
    board.render($('board'), w, h, s.stones, { numberFrom: s.opening, last });
  }

  function renderScore() {
    const sc = model.score;
    $('scoreLine').textContent = `A ${sc.A} – ${sc.B} B${sc.draws ? `  (${sc.draws} ${t('watch.draws')})` : ''}`;
  }

  function renderStatus(s) {
    const parts = [t(`watch.state.${model.state}`)];
    if (model.state === 'done') parts.push(model.winner ? t('watch.winner', { p: model.winner }) : t('watch.drawMatch'));
    else if (model.current && !s.replay) parts.push(t('watch.toMove', { p: model.current.toMove }));
    if (s.result) parts.push(resultText(s.result));
    $('statusLine').textContent = parts.join(' · ');
  }

  function renderPlayers() {
    const box = $('playerCards');
    box.textContent = '';
    for (const p of ['A', 'B']) {
      const st = model.players[p];
      const turn = model.current && model.current.toMove === p && view.live;
      const sub = [st.engine || '', st.connected ? t('watch.connected') : t('watch.disconnected')];
      if (st.reason) sub.push(t('watch.refused', { reason: st.reason }));
      const card = el('div', { className: `pcard${turn ? ' turn' : ''}` },
        el('span', { className: 'name' }, el('span', { className: `dot${st.connected ? ' on' : ''}` }), `${p}`),
        el('span', { className: 'clock', id: `clock${p}` }, fmtClock(live.clockMs(model, p))),
        el('span', { className: 'sub' }, sub.filter(Boolean).join(' · ')));
      box.append(card);
    }
  }

  function renderGames() {
    const ul = $('gameList');
    ul.textContent = '';
    const add = (label, active, onClick) => {
      const b = el('button', { type: 'button' }, label);
      if (active) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', onClick);
      ul.append(el('li', {}, b));
    };
    if (model.current) add(`${t('watch.game', { n: model.current.gameIndex + 1 })} — ${t('watch.live')}`, view.live, () => { view = { live: true }; render(); });
    for (const r of model.records) {
      add(`${t('watch.game', { n: r.gameIndex + 1 })} — ${resultText(r.result)}`, !view.live && view.gameIndex === r.gameIndex,
        () => { view = { live: false, gameIndex: r.gameIndex, ply: r.opening.length + r.moves.length }; render(); });
    }
  }

  function renderMoves(s) {
    const ol = $('moveList');
    ol.textContent = '';
    if (!s.moves.length) { ol.append(el('li', { className: 'muted' }, t('watch.noMoves'))); return; }
    const h = model.cfg.h;
    s.moves.forEach((m) => {
      const b = el('button', { type: 'button' }, `${m.ply + 1 - s.opening}. ${m.player} ${board.label(m.x, m.y, h)} (${fmtSec(m.elapsedMs)})`);
      if (s.replay && s.ply === m.ply + 1) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => {
        const rec = model.records.find((r) => r.gameIndex === (view.live ? -1 : view.gameIndex));
        if (rec) { view = { live: false, gameIndex: rec.gameIndex, ply: m.ply + 1 }; render(); }
      });
      ol.append(el('li', {}, b));
    });
  }

  function renderReplayBar(s) {
    const bar = $('replayBar');
    bar.hidden = !s.replay;
    if (!s.replay) return;
    const range = $('stepRange');
    range.min = String(s.opening);
    range.max = String(s.total);
    range.value = String(s.ply);
  }

  function renderConn() {
    $('conn').textContent = connState === 'open' ? '' : connState === 'gone' ? t('watch.notFound') : connState === 'lost' ? t('watch.lost') : t('watch.connecting');
  }

  function render() {
    renderConn();
    if (!model) return;
    const s = shown();
    renderScore();
    renderStatus(s);
    renderPlayers();
    renderBoard(s);
    renderGames();
    renderMoves(s);
    renderReplayBar(s);
  }

  function tickClocks() {
    if (!model) return;
    for (const p of ['A', 'B']) { const c = $(`clock${p}`); if (c) c.textContent = fmtClock(live.clockMs(model, p)); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!viewId) { connState = 'gone'; renderConn(); return; }
    const step = (d) => { if (!view.live) { view = { ...view, ply: view.ply + d }; render(); } };
    $('stepPrev').addEventListener('click', () => step(-1));
    $('stepNext').addEventListener('click', () => step(1));
    $('stepRange').addEventListener('input', (ev) => { if (!view.live) { view = { ...view, ply: Number(ev.target.value) }; render(); } });
    $('backLive').addEventListener('click', () => { view = { live: true }; render(); });
    let resizeTimer = null;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
    document.addEventListener('langchange', render);
    live.connect(viewId, { onModel: (m) => { model = m; render(); }, onState: (s) => { connState = s; renderConn(); } });
    setInterval(tickClocks, 250);
    renderConn();
  });
}());
