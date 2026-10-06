/* =========================================================================
   charts.js — визуализация на canvas без внешних библиотек
   LineChart · Gauge · Waveform · Harmonics · ProfileChart
   ========================================================================= */
(function (global) {
  'use strict';

  const COL = {
    grid:'#1a2634', grid2:'#22313f', axis:'#2d4155', text:'#75879c', text2:'#a9bccf',
    bg:'rgba(9,14,19,.55)', ok:'#37d67a', warn:'#f5a524', err:'#ff4d4f', accent:'#29b6f6'
  };
  const fmt = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '—'
    : Number(v).toFixed(d === undefined ? 2 : d).replace('.', ',');
  const FONT = '11px "Cascadia Mono", Consolas, monospace';

  function fit(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || cv.parentElement.clientWidth || 300;
    const h = cv.clientHeight || 160;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  // сглаживание ломаной (Catmull-Rom → Безье) для «приборного» вида трендов
  function smooth(ctx, pts) {
    if (pts.length < 3) { pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); return; }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
        p2[0], p2[1]);
    }
  }

  /* ============================== ЛИНЕЙНЫЙ ГРАФИК ========================= */
  class LineChart {
    constructor(cv, cfg) {
      this.cv = cv;
      this.cfg = Object.assign({
        series: [], window: 120, yMin: null, yMax: null, dec: 2, minInterval: 90,
        area: true, refs: [], name: ''
      }, cfg || {});
      this.range = null;
      this.last = 0;
    }
    _range(hist, from) {
      let mn = Infinity, mx = -Infinity;
      for (const s of this.cfg.series) {
        const arr = hist[s.key];
        if (!arr) continue;
        const k = s.k || 1;
        for (let i = from; i < arr.length; i++) {
          const v = arr[i] * k;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      if (this.cfg.yMin !== null && this.cfg.yMin !== undefined) mn = Math.min(mn, this.cfg.yMin);
      if (this.cfg.yMax !== null && this.cfg.yMax !== undefined) mx = Math.max(mx, this.cfg.yMax);
      for (const r of this.cfg.refs) { mn = Math.min(mn, r.v); mx = Math.max(mx, r.v); }
      const pad = (mx - mn) * 0.12 || Math.max(Math.abs(mx) * 0.1, 0.5);
      let lo = mn - pad, hi = mx + pad;
      if (hi - lo < 1e-6) hi = lo + 1;
      return [lo, hi];
    }
    render(hist, tNow, force) {
      const now = performance.now();
      if (!force && now - this.last < this.cfg.minInterval) return;
      this.last = now;
      const { ctx, w, h } = fit(this.cv);
      const cfg = this.cfg;
      const win = cfg.window;
      const tArr = hist.t || [];
      let from = 0;
      let t0, t1;
      if (win && tArr.length) {
        t1 = tNow; t0 = Math.max(0, tNow - win);
        while (from < tArr.length && tArr[from] < t0) from++;
      } else {
        t0 = tArr.length ? tArr[0] : 0; t1 = tArr.length ? tArr[tArr.length - 1] : 1;
      }
      const mL = 46, mR = 12, mT = 12, mB = 20;
      const pw = Math.max(10, w - mL - mR), ph = Math.max(10, h - mT - mB);
      const rng = this.range ? [this.range[0] + (0) , this.range[1]] : null;
      const [lo, hi] = this._range(hist, from);
      // сглаживание диапазона
      if (!this.range) this.range = [lo, hi];
      else {
        this.range[0] += (lo - this.range[0]) * 0.18;
        this.range[1] += (hi - this.range[1]) * 0.18;
      }
      const rlo = this.range[0], rhi = this.range[1], span = (rhi - rlo) || 1;
      const X = t => mL + (t - t0) / Math.max(1e-6, (t1 - t0)) * pw;
      const Y = v => mT + ph - (v - rlo) / span * ph;

      // сетка
      ctx.font = FONT; ctx.textBaseline = 'middle';
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const y = mT + ph * i / steps;
        ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke();
        ctx.fillStyle = COL.text; ctx.textAlign = 'right';
        ctx.fillText(fmt(rhi - span * i / steps, cfg.dec), mL - 6, y);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let i = 0; i <= 3; i++) {
        const t = t0 + (t1 - t0) * i / 3;
        const x = mL + pw * i / 3;
        ctx.fillStyle = COL.text;
        ctx.fillText(fmt(t, 0) + ' с', x, mT + ph + 5);
      }
      // уставки
      for (const r of cfg.refs) {
        if (r.v < rlo || r.v > rhi) continue;
        const y = Y(r.v);
        ctx.save();
        ctx.strokeStyle = r.color || COL.warn; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke();
        ctx.restore();
        if (r.label) {
          ctx.fillStyle = r.color || COL.warn; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.fillText(r.label, mL + pw - 4, y - 2);
        }
      }
      // серии
      ctx.save();
      ctx.beginPath(); ctx.rect(mL, mT - 2, pw, ph + 4); ctx.clip();
      for (const s of cfg.series) {
        const arr = hist[s.key];
        if (!arr || arr.length < 2) continue;
        const k = s.k || 1;
        const pts = [];
        for (let i = from; i < arr.length; i++) pts.push([X(tArr[i]), Y(arr[i] * k)]);
        if (pts.length < 2) continue;
        if (s.area && cfg.area && cfg.series.length === 1) {
          const g = ctx.createLinearGradient(0, mT, 0, mT + ph);
          g.addColorStop(0, s.color + '44'); g.addColorStop(1, s.color + '02');
          ctx.beginPath(); ctx.moveTo(pts[0][0], mT + ph);
          pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
          ctx.lineTo(pts[pts.length - 1][0], mT + ph); ctx.closePath();
          ctx.fillStyle = g; ctx.fill();
        }
        ctx.beginPath();
        ctx.lineWidth = s.width || 1.7;
        ctx.strokeStyle = s.color;
        ctx.lineJoin = 'round';
        smooth(ctx, pts);
        ctx.stroke();
      }
      // текущие значения — маркеры
      for (const s of cfg.series) {
        const arr = hist[s.key];
        if (!arr || !arr.length) continue;
        const x = X(tArr[tArr.length - 1]), y = Y(arr[arr.length - 1] * (s.k || 1));
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.3); ctx.fillStyle = s.color; ctx.fill();
      }
      ctx.restore();
      // рамка
      ctx.strokeStyle = COL.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + ph); ctx.lineTo(mL + pw, mT + ph); ctx.stroke();
      // легенда (с переносом на вторую строку)
      let lx = mL + 4, ly = mT - 1;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (const s of cfg.series) {
        const arr = hist[s.key] || [];
        const last = arr.length ? arr[arr.length - 1] : null;
        const txt = (s.label || s.key) + ' ' + fmt(last, s.dec === undefined ? cfg.dec : s.dec) + (s.unit ? ' ' + s.unit : '');
        const tw = ctx.measureText(txt).width;
        if (lx + tw + 24 > mL + pw) { lx = mL + 4; ly += 13; }
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, ly + 4, 9, 3);
        ctx.fillStyle = COL.text2;
        ctx.fillText(txt, lx + 13, ly);
        lx += tw + 30;
      }
      if (!tArr.length) {
        ctx.fillStyle = COL.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('нет данных — запустите испытание', mL + pw / 2, mT + ph / 2);
      }
    }
  }

  /* ================================= ПРИБОР ============================== */
  class Gauge {
    constructor(cv, cfg) { this.cv = cv; this.cfg = Object.assign({ min:0, max:100, dec:1, unit:'', label:'' }, cfg || {}); }
    render(v) {
      const { ctx, w, h } = fit(this.cv);
      const c = this.cfg;
      const cx = w / 2, cy = h * 0.86, r = Math.min(w / 2 - 8, h * 0.78 - 8);
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      const fract = Math.max(0, Math.min(1, (v - c.min) / (c.max - c.min)));
      const col = (c.alarm !== undefined && (c.low ? v <= c.alarm : v >= c.alarm)) ? COL.err
                : (c.warn !== undefined && (c.low ? v <= c.warn : v >= c.warn)) ? COL.warn : (c.color || COL.accent);
      // фон дуги
      ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.strokeStyle = '#16202c';
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
      // деления
      for (let i = 0; i <= 10; i++) {
        const a = a0 + (a1 - a0) * i / 10;
        const r1 = r - 8, r2 = r - (i % 5 === 0 ? 15 : 12);
        ctx.strokeStyle = i % 5 === 0 ? COL.axis : COL.grid2; ctx.lineWidth = i % 5 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      // зоны уставок
      const zone = (from, to, color) => {
        const fa = Math.max(0, Math.min(1, (from - c.min) / (c.max - c.min)));
        const ta = Math.max(0, Math.min(1, (to - c.min) / (c.max - c.min)));
        if (ta <= fa) return;
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, r - 13, a0 + (a1 - a0) * fa, a0 + (a1 - a0) * ta); ctx.stroke();
      };
      if (c.warn !== undefined) {
        if (c.low) { zone(c.min, c.alarm !== undefined ? c.alarm : c.warn, 'rgba(255,77,79,.7)'); zone(c.alarm !== undefined ? c.alarm : c.warn, c.warn, 'rgba(245,165,36,.7)'); }
        else { zone(c.warn, c.alarm !== undefined ? c.alarm : c.max, 'rgba(245,165,36,.7)'); if (c.alarm !== undefined) zone(c.alarm, c.max, 'rgba(255,77,79,.7)'); }
      }
      // дуга значения
      const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
      grad.addColorStop(0, col + '99'); grad.addColorStop(1, col);
      ctx.strokeStyle = grad; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * fract); ctx.stroke();
      // стрелка
      const a = a0 + (a1 - a0) * fract;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20)); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, 6.3); ctx.fillStyle = col; ctx.fill();
      // значение
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eaf3ff'; ctx.font = '600 17px "Cascadia Mono", Consolas, monospace';
      ctx.fillText(fmt(v, c.dec), cx, cy - 16);
      ctx.fillStyle = COL.text; ctx.font = FONT;
      ctx.fillText(c.unit, cx, cy + 16);
    }
  }

  /* ============================== ОСЦИЛЛОГРАММА ========================== */
  class Waveform {
    constructor(cv, cfg) { this.cv = cv; this.cfg = cfg || {}; }
    render(u, f, thd, opts) {
      const { ctx, w, h } = fit(this.cv);
      const mL = 34, mR = 8, mT = 8, mB = 16;
      const pw = w - mL - mR, ph = h - mT - mB;
      const cy = mT + ph / 2;
      const A = ph / 2 - 6;
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const y = mT + ph * i / 4; ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke(); }
      for (let i = 0; i <= 6; i++) { const x = mL + pw * i / 6; ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + ph); ctx.stroke(); }
      ctx.strokeStyle = COL.axis; ctx.beginPath(); ctx.moveTo(mL, cy); ctx.lineTo(mL + pw, cy); ctx.stroke();
      // амплитуда по напряжению
      const amp = Math.max(0, Math.min(1, (u || 0) / 6.4));
      const t0 = (opts && opts.phase) || 0;
      if (amp < 0.01) {
        ctx.fillStyle = COL.text; ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('напряжение отсутствует', mL + pw / 2, cy);
        return;
      }
      const cycles = 1.6;
      const harm = [1, 0.055 * (thd || 0), 0.035 * (thd || 0), 0.02 * (thd || 0)];
      const draw = (phase, color, lw) => {
        ctx.beginPath();
        for (let i = 0; i <= 460; i++) {
          const x = i / 460;
          const a = 2 * Math.PI * cycles * x + phase;
          let v = 0;
          for (let k = 0; k < harm.length; k++) v += harm[k] * Math.sin((k + 1) * a);
          // высокочастотная коммутационная составляющая (ШИМ)
          v += 0.022 * Math.sin(a * 21 + x * 40);
          const y = cy - v * A * amp;
          i ? ctx.lineTo(mL + pw * x, y) : ctx.moveTo(mL + pw * x, y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
      };
      ctx.save(); ctx.beginPath(); ctx.rect(mL, mT, pw, ph); ctx.clip();
      draw(2.0944 + t0, 'rgba(167,139,250,.55)', 1.2);
      draw(-2.0944 + t0, 'rgba(55,214,122,.55)', 1.2);
      draw(0 + t0, '#29b6f6', 1.8);
      ctx.restore();
      ctx.font = FONT; ctx.fillStyle = COL.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.fillText('+' + fmt(u / Math.sqrt(3), 2), mL - 5, cy - A * amp * 0.5);
      ctx.fillText('0', mL - 5, cy);
      ctx.textAlign = 'left';
      ctx.fillStyle = COL.text2;
      ctx.fillText('Ua  Ub  Uc   ·   f = ' + fmt(f, 1) + ' Гц', mL + 4, mT + 8);
    }
  }

  /* ============================== СПЕКТР ГАРМОНИК ========================= */
  class Harmonics {
    constructor(cv, cfg) { this.cv = cv; this.cfg = cfg || {}; }
    render(thd) {
      const { ctx, w, h } = fit(this.cv);
      const mL = 30, mR = 8, mT = 14, mB = 18;
      const pw = w - mL - mR, ph = h - mT - mB;
      const N = 15;
      const vals = [];
      for (let k = 1; k <= N; k++) {
        if (k === 1) { vals.push(100); continue; }
        const wgt = (k % 2 === 0 ? 0.30 : 0.20) / Math.pow(k, 0.55);
        vals.push(Math.min(40, (thd || 0) * wgt * 2.4));
      }
      const maxV = 110;
      ctx.strokeStyle = COL.grid;
      for (let i = 0; i <= 3; i++) { const y = mT + ph * i / 3; ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke(); }
      const bw = pw / N;
      ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      vals.forEach((v, i) => {
        const bh = Math.max(1, v / maxV * ph);
        const x = mL + bw * i + bw * 0.18;
        const bwid = bw * 0.64;
        const over = i > 0 && v > 3;
        ctx.fillStyle = i === 0 ? 'rgba(41,182,246,.75)' : over ? 'rgba(245,165,36,.8)' : 'rgba(55,214,122,.55)';
        ctx.fillRect(x, mT + ph - bh, bwid, bh);
        ctx.fillStyle = COL.text;
        ctx.fillText(String(i + 1), mL + bw * i + bw / 2, mT + ph + 9);
        if (i > 0 && v > 0.4) {
          ctx.fillStyle = over ? COL.warn : COL.text2;
          ctx.fillText(v.toFixed(1), mL + bw * i + bw / 2, mT + ph - bh - 6);
        }
      });
      ctx.fillStyle = COL.text; ctx.textAlign = 'left';
      ctx.fillText('порядок', mL, mT + ph + 9);
      ctx.textAlign = 'right';
      ctx.fillText('THD = ' + fmt(thd, 2) + ' %', mL + pw, mT + 6);
    }
  }

  /* ============================ ПРЕДПРОСМОТР ПРОФИЛЯ ===================== */
  class ProfileChart {
    constructor(cv, cfg) { this.cv = cv; this.cfg = cfg || {}; }
    render(steps, curIndex, tNow) {
      const { ctx, w, h } = fit(this.cv);
      const mL = 34, mR = 10, mT = 12, mB = 18;
      const pw = w - mL - mR, ph = h - mT - mB;
      const total = steps.reduce((s, x) => s + x[3], 0) || 1;
      const series = [
        { i: 0, color: '#37d67a', label: 'f, %' },
        { i: 1, color: '#29b6f6', label: 'U, %' },
        { i: 2, color: '#f5a524', label: 'нагрузка, %' }
      ];
      ctx.strokeStyle = COL.grid;
      for (let i = 0; i <= 4; i++) { const y = mT + ph * i / 4; ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke(); }
      ctx.font = FONT; ctx.fillStyle = COL.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      [100, 75, 50, 25, 0].forEach((v, i) => ctx.fillText(v + '', mL - 5, mT + ph * i / 4));
      let acc = 0;
      const X = t => mL + (t / total) * pw;
      const Y = v => mT + ph - (v / 100) * ph;
      // границы ступеней
      steps.forEach((s, i) => {
        const x = X(acc);
        ctx.strokeStyle = (curIndex === i) ? 'rgba(41,182,246,.6)' : COL.grid2;
        ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + ph); ctx.stroke();
        if (curIndex === i) {
          ctx.fillStyle = 'rgba(41,182,246,.09)';
          ctx.fillRect(x, mT, X(acc + s[3]) - x, ph);
        }
        acc += s[3];
      });
      ctx.strokeStyle = COL.axis;
      ctx.beginPath(); ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + ph); ctx.lineTo(mL + pw, mT + ph); ctx.stroke();
      acc = 0;
      series.forEach(s => {
        ctx.beginPath();
        steps.forEach((st, i) => {
          const x0 = X(acc), x1 = X(acc + st[3]), y = Y(st[s.i]);
          i ? ctx.lineTo(x0, y) : ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          acc += st[3];
        });
        acc = 0;
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.8; ctx.stroke();
      });
      // маркер текущего времени
      if (curIndex >= 0 && tNow !== undefined) {
        let start = 0;
        for (let i = 0; i < curIndex; i++) start += steps[i][3];
        const x = X(Math.min(total, start + Math.max(0, tNow)));
        ctx.strokeStyle = '#eaf3ff'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + ph); ctx.stroke();
        ctx.fillStyle = '#eaf3ff';
        ctx.beginPath(); ctx.arc(x, mT, 2.6, 0, 6.3); ctx.fill();
      }
      // легенда
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = FONT;
      let lx = mL + 4;
      series.forEach(s => {
        ctx.fillStyle = s.color; ctx.fillRect(lx, mT + 2, 9, 3);
        ctx.fillStyle = COL.text2; ctx.fillText(s.label, lx + 13, mT - 1);
        lx += ctx.measureText(s.label).width + 28;
      });
      ctx.fillStyle = COL.text; ctx.textAlign = 'right';
      ctx.fillText('t = ' + fmt(total, 0) + ' с', mL + pw, mT + 10);
    }
  }

  global.Charts = { LineChart, Gauge, Waveform, Harmonics, ProfileChart, COL, fmt };
})(window);
