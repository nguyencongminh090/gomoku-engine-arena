(function () {
  const TS = (window.TestSite = window.TestSite || {});
  const RULES = ['freestyle', 'standard', 'caro'];

  const toInt = (v) => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : typeof v === 'number' && Number.isInteger(v) ? v : NaN);
  const inRange = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

  // Mirrors the server's checks so mistakes show up before the request is sent; the server stays authoritative.
  function validate(values) {
    const errors = {};
    const w = toInt(values.w);
    const h = toInt(values.h);
    const games = toInt(values.games);
    const matchMinutes = Number(values.matchMinutes);
    const turnSeconds = Number(values.turnSeconds);
    const reconnectSec = toInt(values.reconnectSec);
    if (!RULES.includes(values.rule)) errors.rule = 'create.errRule';
    if (!inRange(w, 5, 22)) errors.w = 'create.errSize';
    if (!inRange(h, 5, 22)) errors.h = 'create.errSize';
    if (!inRange(games, 1, 200)) errors.games = 'create.errGames';
    if (!(matchMinutes > 0) || !Number.isFinite(matchMinutes) || Math.round(matchMinutes * 60000) > 24 * 3600e3) errors.matchMinutes = 'create.errMatch';
    if (!(turnSeconds >= 0) || !Number.isFinite(turnSeconds) || Math.round(turnSeconds * 1000) > 24 * 3600e3) errors.turnSeconds = 'create.errTurn';
    if (!inRange(reconnectSec, 1, 3600)) errors.reconnectSec = 'create.errReconnect';
    const openingsText = String(values.openingsText ?? '');
    const count = openingsText.split(/\r?\n/).filter((l) => l.trim() !== '').length;
    if (!errors.games && count < Math.ceil(games / 2)) errors.openings = 'create.errOpenings';
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      cfg: { rule: values.rule, w, h, games, matchMs: Math.round(matchMinutes * 60000), turnMs: Math.round(turnSeconds * 1000), reconnectSec, openingsText },
    };
  }

  const needsRapfi = ({ rule, w, h }) => rule !== 'freestyle' || Number(w) !== Number(h);

  TS.create = { validate, needsRapfi };

  // ---- page wiring (skipped when loaded without a DOM) ----
  if (typeof document === 'undefined' || !document.getElementById('createForm')) return;
  const $ = (id) => document.getElementById(id);
  const form = $('createForm');
  const fields = ['rule', 'w', 'h', 'games', 'matchMinutes', 'turnSeconds', 'reconnectSec', 'openingsText'];
  const read = () => Object.fromEntries(fields.map((f) => [f, $(f).value]));
  const showWarn = () => { $('rapfiWarn').hidden = !needsRapfi({ rule: $('rule').value, w: $('w').value, h: $('h').value }); };

  const errorBox = (field, key) => {
    const el = document.querySelector(`[data-error-for="${field}"]`);
    if (el) el.textContent = key ? TS.t(key) : '';
    const input = $(field);
    if (input) input.setAttribute('aria-invalid', key ? 'true' : 'false');
  };

  function show(errors) {
    for (const f of fields) errorBox(f, errors[f]);
    errorBox('openingsText', errors.openings);
  }

  for (const f of ['rule', 'w', 'h']) $(f).addEventListener('input', showWarn);
  showWarn();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const result = validate(read());
    show(result.ok ? {} : result.errors);
    if (!result.ok) return;
    const submit = $('submitBtn');
    submit.disabled = true;
    $('formError').textContent = '';
    try {
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result.cfg) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        try { sessionStorage.setItem(`room:${body.roomId}`, JSON.stringify(body)); } catch (e) { /* the room page then shows the no-secrets notice */ }
        location.href = `room.html?r=${encodeURIComponent(body.roomId)}&v=${encodeURIComponent(body.viewId)}`;
        return;
      }
      $('formError').textContent = res.status === 429 ? TS.t('create.errRate') : TS.t('create.errServer', { msg: body.message || res.status });
    } catch (e) {
      $('formError').textContent = TS.t('create.errNetwork');
    } finally {
      submit.disabled = false;
    }
  });
}());
