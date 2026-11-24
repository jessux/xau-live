// Logique partagée (navigateur + `node test.js`) : zones buy/sell à partir du prix seul, stratégies, graphique.

// Zones : pivots (plus haut / plus bas local sur ±win bougies 1 min), pivots proches regroupés.
// Zone sous le prix = achat (support), au-dessus = vente (résistance). ticks = [[ts, mid], ...] triés.
function zones(ticks, price, win = 2, merge = 1.5) {
  const bars = [];
  for (const [t, p] of ticks) {
    const k = Math.floor(t / 60000), b = bars[bars.length - 1];
    if (b && b.k === k) { b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); } else bars.push({ k, h: p, l: p });
  }
  const piv = [];
  for (let i = win; i < bars.length - win; i++) {
    const s = bars.slice(i - win, i + win + 1);
    if (s.every(x => x.h <= bars[i].h)) piv.push(bars[i].h);
    if (s.every(x => x.l >= bars[i].l)) piv.push(bars[i].l);
  }
  piv.sort((a, b) => a - b);
  const out = [];
  for (const p of piv) {
    const z = out[out.length - 1];
    if (z && p - z.hi <= merge && p - z.lo <= 3) { z.hi = p; z.n++; } else out.push({ lo: p, hi: p, n: 1 });
  }
  return out.map(z => ({ lo: z.lo - .3, hi: z.hi + .3, n: z.n, side: (z.lo + z.hi) / 2 < price ? 'buy' : 'sell' }));
}

// Cascade (strategie/SYNTHESE_SIGNAL.md, A) : armée à t0 ∈ [t − ttl, t] si le prix y est à ≤ tol du plus haut des `hi` ms
// précédentes, puis chute d'au moins `chute` en ≤ `dur` ms (la chute peut finir après t). h = [[ts, prix], ...] trié.
// → { H (plus haut), t0 } pour le t0 le plus récent, ou null.
function cascade(h, t, { chute, tol = 0, hi = 10000, dur = 5000, ttl = 15000 }) {
  let i = h.length;
  while (i > 0 && h[i - 1][0] >= t - ttl - hi) i--;
  const w = h.slice(i);
  for (let k = w.length - 1; k >= 0; k--) {
    if (w[k][0] > t) continue;
    if (w[k][0] < t - ttl) break;
    let lo = Infinity, H = -Infinity;
    for (let j = k + 1; j < w.length && w[j][0] - w[k][0] <= dur; j++) lo = Math.min(lo, w[j][1]);
    if (w[k][1] - lo < chute) continue;
    for (let j = k; j >= 0 && w[k][0] - w[j][0] <= hi; j--) H = Math.max(H, w[j][1]);
    if (w[k][1] >= H - tol) return { H, t0: w[k][0] };
  }
  return null;
}

// Stratégies : signal(ctx, params) → 'buy' | 'sell' | { side, limit, ttl (s) } (ordre limite) | undefined.
// ctx = { h: [[ts, mid, imb, wallBid]], zones, mid, prev, last (fin du dernier trade / ordre) }
const mids = (h, n) => h.slice(-n).map(x => x[1]);
const mono = (a, dir, n) => a.length === n && a.every((x, i) => i === 0 || (x - a[i - 1]) * dir > 0);
const BASE = { sl: 2, tp: 4, maxMin: 10, maxSpread: 0.8, pause: 30 };
const STRATS = {
  rebond: {
    nom: 'Rebond sur zone', p: { ...BASE, dist: 1, ticks: 3 }, g: { dist: [0.3, 0.5, 1], ticks: [2, 3, 5] }, signal(c, p) {
      const m = mids(c.h, p.ticks + 1);
      for (const z of c.zones) {
        if (z.side === 'buy' && c.mid >= z.lo && c.mid - z.hi <= p.dist && mono(m, 1, p.ticks + 1)) return 'buy';
        if (z.side === 'sell' && c.mid <= z.hi && z.lo - c.mid <= p.dist && mono(m, -1, p.ticks + 1)) return 'sell';
      }
    }
  },
  cassure: {
    nom: 'Cassure de zone', p: { ...BASE, marge: 0.5 }, g: { marge: [0.2, 0.5, 1] }, signal(c, p) {
      for (const z of c.zones) {
        if (c.prev <= z.hi + p.marge && c.mid > z.hi + p.marge) return 'buy';
        if (c.prev >= z.lo - p.marge && c.mid < z.lo - p.marge) return 'sell';
      }
    }
  },
  momentum: {
    nom: 'Momentum ticks', p: { ...BASE, sl: 1.5, tp: 3, ticks: 5, move: 1 }, g: { ticks: [3, 5, 8], move: [0.5, 1, 1.5] }, signal(c, p) {
      const m = mids(c.h, p.ticks + 1), d = m[m.length - 1] - m[0];
      if (Math.abs(d) >= p.move && mono(m, Math.sign(d), p.ticks + 1)) return d > 0 ? 'buy' : 'sell';
    }
  },
  desequilibre: {
    nom: 'Déséquilibre carnet', p: { ...BASE, sl: 1.5, tp: 2, seuil: 0.2, ticks: 3 }, g: { seuil: [0.1, 0.15, 0.2, 0.3], ticks: [2, 3, 5] }, signal(c, p) {
      const im = c.h.slice(-p.ticks).map(x => x[2]);
      if (im.length < p.ticks) return;
      if (im.every(x => x >= p.seuil)) return 'buy';
      if (im.every(x => x <= -p.seuil)) return 'sell';
    }
  },
  mur: {
    nom: 'Rebond sur mur', p: { ...BASE, sl: 1.5, tp: 2, dist: 0.5 }, g: { dist: [0.2, 0.5, 1] }, signal(c, p) {
      if (c.wallBid && c.mid - c.wallBid <= p.dist && c.mid > c.prev) return 'buy';
      if (c.wallAsk && c.wallAsk - c.mid <= p.dist && c.mid < c.prev) return 'sell';
    }
  },
  moyenne: {
    nom: 'Retour à la moyenne', p: { ...BASE, sl: 3, tp: 2, win: 120, k: 2.5 }, g: { win: [60, 120, 300], k: [1.5, 2, 2.5, 3] }, signal(c, p) {
      const m = mids(c.h, p.win);
      if (m.length < p.win) return;
      const mu = m.reduce((a, x) => a + x, 0) / m.length, sd = Math.sqrt(m.reduce((a, x) => a + (x - mu) ** 2, 0) / m.length);
      if (sd > 0 && c.mid > mu + p.k * sd) return 'sell';
      if (sd > 0 && c.mid < mu - p.k * sd) return 'buy';
    }
  },
  // Approximation : pas de flux de transactions ici, « mangé » = le mur d'achat (tenu ≥ 2 s, à ≤ dist du prix)
  // disparaît pendant que le prix passe dessous. Déclencheur des 5 dernières s (postérieur au dernier trade / ordre),
  // cascade armée dans les 15 s avant lui → vente limite au plus haut H de la cascade, valable ttl s.
  mange: {
    nom: 'Acheteur mangé (vente)', p: { ...BASE, chute: 0.8, dist: 1, ttl: 120 }, g: { chute: [0.5, 0.8, 1.2], dist: [0.5, 1, 2] }, signal(c, p) {
      const h = c.h, n = h.length, now = h[n - 1][0];
      for (let e = n - 1; e > 0 && now - h[e][0] <= 5000 && h[e][0] > c.last; e--) {
        const W = h[e - 1][3], same = x => x && Math.abs(x - W) <= 0.3;
        if (!W || same(h[e][3]) || h[e][1] > W || h[e - 1][1] - W > p.dist) continue;
        let i = e - 1;
        while (i > 0 && same(h[i - 1][3])) i--;
        if (h[e - 1][0] - h[i][0] < 2000) continue;
        const a = cascade(h, h[e][0], { chute: p.chute, tol: 0.1 });
        if (a && a.H > c.mid) return { side: 'sell', limit: a.H, ttl: p.ttl };
      }
    }
  },
};

// Moteur : 1 position de 1 oz max par stratégie. Achat au ask, sortie au bid (le spread est payé).
// params[k] = { on, ...STRATS[k].p } ; onTrade(trade fermé). tick(..., false) = historique sans trader.
// ob = carnet au moment du tick : { imb (-1..1), wallBid, wallAsk (prix) }. S.h = [[ts, mid, imb, wallBid], ...]
// Ordre limite en attente (S.ord) : exécuté au prix limite dès que le bid (vente) / l'ask (achat) l'atteint, sinon expiré.
// cache (Map, optionnel) : zones partagées entre plusieurs passes sur les mêmes ticks (elles ne dépendent que du prix).
function engine(params, onTrade, cache) {
  const S = { h: [], zones: [], zt: 0, pos: {}, ord: {}, last: {} };
  return {
    S, tick(ts, bid, ask, trade = true, ob = {}) {
      const mid = (bid + ask) / 2, prev = S.h.length ? S.h[S.h.length - 1][1] : mid;
      S.h.push([ts, mid, ob.imb, ob.wallBid]);
      if (S.h.length > 18000) S.h.splice(0, S.h.length - 14400); // ~4 h à 1 tick/s
      if (ts - S.zt >= 60000) { S.zones = cache?.get(ts) ?? zones(S.h, mid); cache?.set(ts, S.zones); S.zt = ts; }
      for (const z of S.zones) z.side = (z.lo + z.hi) / 2 < mid ? 'buy' : 'sell';
      if (!trade) return;
      for (const k in STRATS) {
        const p = params[k], pos = S.pos[k], o = S.ord[k];
        if (pos) {
          const dir = pos.side === 'buy' ? 1 : -1, exit = dir > 0 ? bid : ask, pnl = (exit - pos.entry) * dir;
          const reason = pnl <= -p.sl ? 'stop' : pnl >= p.tp ? 'objectif' : ts - pos.entry_ts >= p.maxMin * 60000 ? 'temps' : null;
          if (reason) { delete S.pos[k]; S.last[k] = ts; onTrade({ ...pos, exit_ts: ts, exit, pnl, reason }); }
        } else if (o) {
          if (o.side === 'sell' ? bid >= o.limit : ask <= o.limit) { delete S.ord[k]; S.pos[k] = { strategy: k, side: o.side, entry_ts: ts, entry: o.limit }; }
          else if (ts >= o.until) { delete S.ord[k]; S.last[k] = ts; }
        } else if (p.on && ask - bid <= p.maxSpread && ts - (S.last[k] || 0) >= p.pause * 1000) {
          const sig = STRATS[k].signal({ h: S.h, zones: S.zones, mid, prev, wallBid: ob.wallBid, wallAsk: ob.wallAsk, last: S.last[k] || 0 }, p);
          if (sig?.limit) S.ord[k] = { side: sig.side, limit: sig.limit, placed: ts, until: ts + sig.ttl * 1000 };
          else if (sig) S.pos[k] = { strategy: k, side: sig, entry_ts: ts, entry: sig === 'buy' ? ask : bid };
        }
      }
    }
  };
}

// Backtest d'une stratégie seule sur des ticks [[ts, bid, ask, imb, wall_bid, wall_ask], ...] → trades fermés.
function backtest(T, k, p, cache) {
  const params = Object.fromEntries(Object.keys(STRATS).map(s => [s, { ...STRATS[s].p, on: false }]));
  params[k] = { ...params[k], ...p, on: true };
  const tr = [], E = engine(params, t => tr.push(t), cache);
  for (const r of T) E.tick(r[0], r[1], r[2], true, { imb: r[3], wallBid: r[4], wallAsk: r[5] });
  return tr;
}
const stats = tr => ({ n: tr.length, pnl: tr.reduce((a, t) => a + t.pnl, 0), win: tr.filter(t => t.pnl > 0).length });

// Optimisation : toute la grille (stop × objectif × réglages propres) ; trades entrés avant 60 % des ticks = « réglage »,
// après = « contrôle » (période jamais vue). Retenu seulement si gagnant sur les deux (≥ minN trades chacun),
// en maximisant la plus faible des deux moitiés.
const SLTP = { sl: [1, 1.5, 2, 3], tp: [1, 2, 3, 4] };
function optimise(T, k, current, cache, minN = 3) {
  const cut = T[Math.floor(T.length * 0.6)][0];
  const grid = Object.entries({ ...SLTP, ...STRATS[k].g }).reduce((acc, [n, vs]) => acc.flatMap(o => vs.map(v => ({ ...o, [n]: v }))), [{}]);
  const bt = p => { const tr = backtest(T, k, p, cache); return { p, train: stats(tr.filter(t => t.entry_ts < cut)), test: stats(tr.filter(t => t.entry_ts >= cut)) }; };
  const ok = grid.map(bt).filter(r => r.train.n >= minN && r.test.n >= minN && r.train.pnl > 0 && r.test.pnl > 0)
    .sort((a, b) => Math.min(b.train.pnl, b.test.pnl) - Math.min(a.train.pnl, a.test.pnl));
  return { actuel: bt(current), best: ok[0] || null, essais: grid.length };
}

// Graphique canvas : prix, zones, chiffres ronds, marques de trades { ts, price, side, exit, win }.
// hx = position x de la souris (px CSS) → réticule + retourne le tick survolé { ts, price, tol }.
function drawChart(cv, pts, zs, span, marks = [], hx = null) {
  const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1, g = cv.getContext('2d');
  cv.width = W * dpr; cv.height = H * dpr; g.scale(dpr, dpr);
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim(), fg = css('--fg'), mut = css('--mut');
  g.font = '11px system-ui,sans-serif'; g.fillStyle = mut;
  if (pts.length < 2) return g.fillText('En attente de ticks…', 10, 20);
  const t1 = pts[pts.length - 1][0], t0 = t1 - span, px = pts[pts.length - 1][1], vis = pts.filter(p => p[0] >= t0);
  let lo = Infinity, hi = -Infinity;
  for (const [, p] of vis) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  const below = zs.filter(z => z.hi < px).sort((a, b) => b.hi - a.hi)[0], above = zs.filter(z => z.lo > px).sort((a, b) => a.lo - b.lo)[0];
  if (below) lo = Math.min(lo, below.lo);
  if (above) hi = Math.max(hi, above.hi);
  const pad = Math.max((hi - lo) * .08, .5); lo -= pad; hi += pad;
  const R = 62, B = 18, X = t => (t - t0) / span * (W - R), Y = p => (hi - p) / (hi - lo) * (H - B);

  const step = [.5, 1, 2, 5, 10, 25, 50, 100].find(s => (hi - lo) / s <= 6);
  g.strokeStyle = mut; g.setLineDash([3, 3]);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    g.globalAlpha = .3; g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W - R, Y(v)); g.stroke();
    g.globalAlpha = 1; g.fillText(v.toFixed(step < 1 ? 1 : 0), W - R + 6, Y(v) + 4);
  }
  g.setLineDash([]);
  [t0, t0 + span / 2, t1].forEach((t, i) => {
    g.textAlign = ['left', 'center', 'right'][i];
    g.fillText(new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), Math.min(X(t), W - R), H - 4);
  });
  g.textAlign = 'left';

  g.save(); g.beginPath(); g.rect(0, 0, W - R, H - B); g.clip();
  // Zones : la plus proche de chaque côté = encadrée ; touchée ≥ 2 fois = bande ; 1 seule fois = pointillé sans étiquette
  const labels = [];
  for (const z of zs) {
    const near = z === below || z === above, col = css(z.side === 'buy' ? '--long' : '--short'), y = Y(z.hi), h = Math.max(Y(z.lo) - y, 2);
    g.fillStyle = g.strokeStyle = col; g.lineWidth = 1;
    if (!near && z.n < 2) {
      g.globalAlpha = .5; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, y + h / 2); g.lineTo(W - R, y + h / 2); g.stroke(); g.setLineDash([]);
      continue;
    }
    g.globalAlpha = near ? .3 : .14; g.fillRect(0, y, W - R, h);
    if (near) { g.globalAlpha = .9; g.strokeRect(0, y, W - R, h); }
    if (y + h > 0 && y < H - B) labels.push({ z, near, col, y: Math.min(Math.max(y + h / 2, 9), H - B - 9) });
  }
  g.globalAlpha = 1;
  g.strokeStyle = fg; g.lineWidth = 1.5; g.beginPath();
  vis.forEach(([t, p], i) => i ? g.lineTo(X(t), Y(p)) : g.moveTo(X(t), Y(p)));
  g.stroke();
  for (const { z, near, col, y } of labels) {
    const d = (z.lo + z.hi) / 2 - px;
    const txt = `${z.side === 'buy' ? "Zone d'achat" : 'Zone de vente'} ${z.lo.toFixed(1)}–${z.hi.toFixed(1)} · ${z.n} touche${z.n > 1 ? 's' : ''}${near ? ` · ${d > 0 ? '+' : ''}${d.toFixed(1)} $` : ''}`;
    g.font = `${near ? 'bold ' : ''}11px system-ui,sans-serif`;
    const w = g.measureText(txt).width + 8;
    g.fillStyle = css('--card'); g.globalAlpha = .85; g.fillRect(4, y - 8, w, 16);
    g.globalAlpha = 1; g.fillStyle = col; g.fillText(txt, 8, y + 4);
  }
  g.font = '11px system-ui,sans-serif';
  for (const m of marks) {
    if (m.ts < t0) continue;
    const x = X(m.ts), y = Y(m.price), d = m.side === 'buy' ? 1 : -1;
    g.fillStyle = g.strokeStyle = css(m.exit ? (m.win ? '--long' : '--short') : (d > 0 ? '--long' : '--short'));
    g.beginPath();
    if (m.exit) { g.arc(x, y, 4, 0, 7); g.stroke(); } else { g.moveTo(x, y); g.lineTo(x - 5, y + 9 * d); g.lineTo(x + 5, y + 9 * d); g.fill(); }
  }
  g.restore();
  g.fillStyle = fg; g.fillRect(W - R + 2, Y(px) - 8, R - 2, 16);
  g.fillStyle = css('--card'); g.fillText(px.toFixed(2), W - R + 6, Y(px) + 4);
  if (hx == null || hx > W - R) return null;
  const t = t0 + hx / (W - R) * span;
  let a = 0, b = pts.length - 1;
  while (a < b) { const m = (a + b) >> 1; if (pts[m][0] < t) a = m + 1; else b = m; }
  if (a > 0 && t - pts[a - 1][0] < pts[a][0] - t) a--;
  const hit = { ts: pts[a][0], price: pts[a][1], imb: pts[a][2], tol: span / (W - R) * 4 }, x = X(hit.ts);
  g.strokeStyle = mut; g.lineWidth = 1; g.setLineDash([2, 2]);
  g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - B); g.stroke(); g.setLineDash([]);
  g.fillStyle = fg; g.beginPath(); g.arc(x, Y(hit.price), 3, 0, 7); g.fill();
  return hit;
}

// Molette = zoom (fenêtre de 1 min à 4 h) + boutons de durée dans `seg` (data-s en ms). set(span) redessine.
function zoomable(cv, seg, get, set) {
  const mark = () => { for (const b of seg.children) b.classList.toggle('on', +b.dataset.s === get()); };
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    set(Math.min(4 * 3600e3, Math.max(60e3, get() * (e.deltaY > 0 ? 1.25 : 0.8)))); mark();
  }, { passive: false });
  seg.onclick = e => { if (e.target.dataset.s) { set(+e.target.dataset.s); mark(); } };
  mark();
}

if (typeof module !== 'undefined') module.exports = { zones, cascade, engine, STRATS, backtest, optimise };
