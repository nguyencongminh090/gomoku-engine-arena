// SVG board for an m x n position. Cells are a whole number of device pixels and grid lines sit on the
// pixel grid, so every line renders with the same thickness (same reason as in GomokuBoardSite).
(function () {
  const TS = (window.TestSite = window.TestSite || {});
  const LABEL_MARGIN = 24; // css px reserved around the grid for edge labels

  const letter = (x) => String.fromCharCode(65 + x);
  // Edge label as shown to players: column letter, row counted from the bottom (so the top row of a 15-high board is 15).
  const label = (x, y, h) => `${letter(x)}${h - y}`;

  function geometry({ w, h, availW, availH, dpr = 1 }) {
    const m = LABEL_MARGIN;
    const raw = Math.min((availW - 2 * m) / w, (availH - 2 * m) / h);
    const cell = Math.max(Math.floor(raw * dpr), 8) / dpr;
    return { cell, margin: m, width: w * cell + 2 * m, height: h * cell + 2 * m };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // stones: [{x,y,c}] in play order (c: 1 black, 2 white). opts: { numberFrom, last, width, height, dpr }
  function svg(w, h, stones, g, opts = {}) {
    const dpr = opts.dpr || 1;
    const { cell, margin: m } = g;
    const snap = (v) => (Math.round(v * dpr - 0.5) + 0.5) / dpr; // centre of a device pixel
    const cx = (x) => m + (x + 0.5) * cell;
    const cy = (y) => m + (y + 0.5) * cell;
    const lw = 1 / dpr;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="board ${w}x${h}">`];
    out.push(`<rect class="bd-bg" x="0" y="0" width="${g.width}" height="${g.height}"/>`);
    const x0 = snap(cx(0));
    const x1 = snap(cx(w - 1));
    const y0 = snap(cy(0));
    const y1 = snap(cy(h - 1));
    for (let i = 0; i < w; i++) { const x = snap(cx(i)); out.push(`<line class="bd-line" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke-width="${lw}"/>`); }
    for (let j = 0; j < h; j++) { const y = snap(cy(j)); out.push(`<line class="bd-line" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke-width="${lw}"/>`); }
    const fs = Math.max(9, Math.min(13, cell * 0.4));
    for (let i = 0; i < w; i++) out.push(`<text class="bd-label" x="${cx(i)}" y="${m - 8}" font-size="${fs}" text-anchor="middle">${letter(i)}</text>`);
    for (let j = 0; j < h; j++) out.push(`<text class="bd-label" x="${m - 8}" y="${cy(j) + fs * 0.35}" font-size="${fs}" text-anchor="end">${h - j}</text>`);
    const r = cell * 0.43;
    stones.forEach((s, i) => {
      out.push(`<circle class="bd-stone c${s.c}" cx="${cx(s.x)}" cy="${cy(s.y)}" r="${r}"/>`);
      if (opts.numberFrom !== undefined && i >= opts.numberFrom) {
        out.push(`<text class="bd-num c${s.c}" x="${cx(s.x)}" y="${cy(s.y) + fs * 0.35}" font-size="${fs}" text-anchor="middle">${i + 1 - opts.numberFrom}</text>`);
      }
    });
    if (opts.last) out.push(`<rect class="bd-last" x="${cx(opts.last.x) - r - 2}" y="${cy(opts.last.y) - r - 2}" width="${2 * (r + 2)}" height="${2 * (r + 2)}" rx="3" fill="none" stroke-width="2"/>`);
    out.push('</svg>');
    return out.join('');
  }

  // Draws into `el`, sized from the space its parent offers.
  function render(el, w, h, stones, opts = {}) {
    const wrap = el.parentElement || el;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const availW = Math.max(wrap.clientWidth, 200);
    const availH = Math.max(Math.min(window.innerHeight * 0.78, availW * 1.2), 200);
    const g = geometry({ w, h, availW, availH, dpr });
    el.style.width = `${g.width}px`;
    el.style.height = `${g.height}px`;
    el.innerHTML = svg(w, h, stones, g, { ...opts, dpr });
    return g;
  }

  TS.board = { geometry, label, svg, render, esc };
}());
