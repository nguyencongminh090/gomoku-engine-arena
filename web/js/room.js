(function () {
  const TS = window.TestSite;
  const t = TS.t;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const roomId = params.get('r');
  let viewId = params.get('v');
  let secrets = null;
  try { secrets = JSON.parse(sessionStorage.getItem(`room:${roomId}`)); } catch (e) { /* storage unavailable */ }
  if (secrets) viewId = secrets.viewId;

  const origin = location.origin;
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent`;

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const c of children) e.append(c);
    return e;
  }

  function copyRow(id, value) {
    const input = el('input', { id, type: 'text', readOnly: true, value });
    const btn = el('button', { type: 'button', className: 'copy' }, t('room.copy'));
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(value); } catch (e) { input.select(); document.execCommand && document.execCommand('copy'); }
      btn.textContent = t('room.copied');
      setTimeout(() => { btn.textContent = t('room.copy'); }, 1500);
    });
    return el('div', { className: 'copyrow' }, input, btn);
  }

  function renderPlayers() {
    const box = $('players');
    box.textContent = '';
    if (!secrets) { $('noSecrets').hidden = false; return; }
    $('secretNote').hidden = false;
    for (const p of ['A', 'B']) {
      const token = secrets[`token${p}`];
      const cmd = `engine-agent --engine /path/to/engine --token ${token} --server ${wsUrl}`;
      box.append(el('section', { className: 'card' },
        el('h2', {}, t('room.player', { p })),
        el('label', {}, t('room.token'), copyRow(`token${p}`, token)),
        el('label', {}, t('room.command'), copyRow(`cmd${p}`, cmd))));
    }
    $('deleteBtn').hidden = false;
  }

  function renderStatus(model) {
    const list = $('statusList');
    list.textContent = '';
    for (const p of ['A', 'B']) {
      const s = model.players[p];
      const parts = [t('room.player', { p }), s.engine ? `(${s.engine})` : '', s.connected ? t('watch.connected') : t('watch.disconnected'), s.ready ? `· ${t('watch.ready')}` : ''];
      if (s.reason) parts.push(`· ${t('watch.refused', { reason: TS.i18n.refusal(s) })}`);
      list.append(el('li', {}, el('span', { className: `dot${s.connected ? ' on' : ''}` }), parts.filter(Boolean).join(' ')));
    }
    list.append(el('li', {}, t(`watch.state.${model.state}`)));
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!roomId && !viewId) { $('roomMsg').textContent = t('room.missing'); return; }
    renderPlayers();
    if (viewId) {
      const url = `${origin}/watch.html?v=${encodeURIComponent(viewId)}`;
      $('watchUrl').value = url;
      $('watchOpen').href = url;
      const copy = document.querySelector('[data-copy="watchUrl"]');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); copy.textContent = t('room.copied'); setTimeout(() => { copy.textContent = t('room.copy'); }, 1500); } catch (e) { $('watchUrl').select(); } });
      let last = null;
      TS.live.connect(viewId, { onModel: (m) => { last = m; renderStatus(m); }, onState: () => {} });
      document.addEventListener('langchange', () => { renderPlayers(); if (last) renderStatus(last); });
    }
    $('deleteBtn').addEventListener('click', async () => {
      if (!secrets || !confirm(t('room.confirmDelete'))) return;
      const res = await fetch(`/api/rooms/${encodeURIComponent(secrets.roomId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${secrets.creatorSecret}` } });
      if (res.status === 204) { try { sessionStorage.removeItem(`room:${roomId}`); } catch (e) { /* ignore */ } $('roomMsg').textContent = t('room.deleted'); $('deleteBtn').hidden = true; }
      else $('roomMsg').textContent = t('room.deleteFailed');
    });
  });
}());
