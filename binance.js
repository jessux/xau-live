// Règle candidate « acheteur défensif mangé » (trading-carnet/strategie/SYNTHESE_SIGNAL.md §2-3), vente seule, en papier
// sur Binance USDⓈ-M Futures : carnet local complet (diff depth@100ms + instantané REST) et aggTrade. Aucune I/O ici :
// binance.html branche les flux, `node test.js` vérifie. Prix en paquets T ≈ 0,1 bp (≈ 1 tick MNQ), seuils du document en T.
const BN_DEF = {
  tick: 0.1, bp: 0.1, chute: 20, tol: 1, hold: 2000, near: 12, ratio: 2.5, pct: 0.95, reste: 0.3, exec: 0.7, niveaux: 3, total: 1.6,
  delai: 2000, bande: [-5, 2], rond: 20, ttl: 120000, retour: 8, retourMs: 60000, sommet: 120000,
};
const bnQ = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// Carnet local. diff(e) → true (appliqué), false (ignoré / en attente d'instantané), 'resync' (trou de séquence : refaire l'instantané).
function bnBook() {
  const B = { bids: new Map(), asks: new Map(), id: 0, live: false, buf: [] };
  const put = (m, l) => { for (const [p, v] of l) +v ? m.set(+p, +v) : m.delete(+p); };
  B.diff = e => {
    if (!B.id) { B.buf.push(e); return false; }
    if (e.u < B.id) return false;
    if (B.live ? e.pu !== B.id : e.U > B.id) { B.id = 0; B.buf = [e]; return 'resync'; }
    put(B.bids, e.b); put(B.asks, e.a); B.id = e.u; B.live = true;
    return true;
  };
  B.snapshot = j => {
    B.bids.clear(); B.asks.clear(); put(B.bids, j.bids); put(B.asks, j.asks); B.id = j.lastUpdateId; B.live = false;
    const b = B.buf; B.buf = [];
    for (let i = 0; i < b.length; i++) if (B.diff(b[i]) === 'resync') { B.buf = b.slice(i); return 'resync'; }
  };
  return B;
}

// step(book, ts) après chaque diff (ts = heure de transaction T), trade({ t, p, q, m }) à chaque aggTrade.
// Chaque ordre signal planifie un ordre témoin à la même distance du dernier prix, 3 à 13 min plus tard (rand injectable).
function bnRule(cfg = {}, rand = Math.random) {
  const casc = typeof cascade === 'function' ? cascade : require('./xau.js').cascade;
  const c = { ...BN_DEF, ...cfg };
  const S = {
    T: 0, L: 0, now: 0, h: [], tr: [], prev: null, since: {}, cand: [], trig: [], plan: [], ord: [], fill: [], done: [],
    d5: [], sizes: [], p95: 0, sec: 0, arm: -Infinity, log: [], n: { cascades: 0, manges: 0, retires: 0, ordres: 0, rejets: 0, executions: 0 },
  };
  const log = (type, o = {}) => { S.log.unshift({ ts: S.now, type, ...o }); };
  // Chute de cascade : 20 T, puis (après 10 min de données) 99e centile des baisses sur 5 s de la dernière heure
  const chute = () => S.d5.length >= 600 ? bnQ(S.d5.map(x => x[1]), 0.99) : c.chute * S.T;
  const round = x => +(Math.round(x / c.tick) * c.tick).toFixed(10);
  const close = (o, statut) => { S.ord = S.ord.filter(x => x !== o); S.fill = S.fill.filter(x => x !== o); S.done.unshift({ ...o, statut, fin: S.now }); };
  const place = (p, bb) => {
    const T = S.T, m = Math.ceil((p.H + c.bande[0] * T) / (c.rond * T)) * c.rond * T;
    const limit = round(p.kind === 'signal' ? (m <= p.H + c.bande[1] * T ? m - T : p.H) : S.L + p.dist);
    if (limit <= bb) { if (p.kind === 'signal') S.n.rejets++; return log('rejeté (post-only)', { kind: p.kind, limit }); }
    S.ord.push({ kind: p.kind, patte: p.patte, pose: S.now, limit, ecart: (limit - S.L) / T, L: S.L, max: S.L });
    log('ordre', { kind: p.kind, limit });
    if (p.kind === 'signal') { S.n.ordres++; S.plan.push({ kind: 'témoin', patte: p.patte, at: S.now + (3 + 10 * rand()) * 60000, dist: limit - S.L }); }
  };
  return {
    S, c, chute,
    trade(t) {
      S.L = t.p; S.tr.push(t);
      if (t.m) return;
      for (const o of S.ord.filter(o => t.p > o.limit)) { // vente limite exécutée seulement si un acheteur paie plus (file d'attente inconnue)
        S.ord = S.ord.filter(x => x !== o); Object.assign(o, { exec: t.t, mfe: 0, mae: 0 }); S.fill.push(o);
        if (o.kind === 'signal') S.n.executions++;
        log('exécuté', { kind: o.kind, limit: o.limit });
      }
    },
    step(B, ts) {
      let bb = -Infinity, ba = Infinity;
      for (const p of B.bids.keys()) if (p > bb) bb = p;
      for (const p of B.asks.keys()) if (p < ba) ba = p;
      if (!isFinite(bb) || !isFinite(ba)) return;
      S.now = ts;
      if (!S.T) S.T = Math.max(c.tick, round((bb + ba) / 2 * c.bp * 1e-4));
      if (!S.L) S.L = (bb + ba) / 2;
      const T = S.T, top = Math.floor(bb / T), lo = Math.min(top, S.prev ? S.prev.top : top) - c.near - 3;
      S.h.push([ts, S.L]);
      while (S.h[0][0] < ts - c.sommet - 40000) S.h.shift();
      const cur = new Map(), near = [];
      for (const [p, v] of B.bids) { const b = Math.floor(p / T); if (b >= lo) cur.set(b, (cur.get(b) || 0) + v); }
      for (let b = top - c.near; b <= top; b++) if (cur.get(b)) near.push(cur.get(b));
      const thr = S.thr = Math.max(c.ratio * bnQ(near, 0.5), S.p95);

      // Gros bid tenu ≥ hold, tombé sous `reste` × sa taille : candidat, tranché 300 ms plus tard (transactions arrivées)
      if (S.prev) for (const k in S.since) {
        const b = +k, was = S.prev.cur.get(b) || 0, now = cur.get(b) || 0;
        if (S.prev.ts - S.since[k] < c.hold || now >= c.reste * was) continue;
        let tot = 0, lv = 0;
        for (const [x, v] of S.prev.cur) { const d = v - (cur.get(x) || 0); if (d > 0) { tot += d; lv++; } }
        S.cand.push({ b, was, dQ: was - now, tot, lv, t0: S.prev.ts, t1: ts });
      }
      const since = {};
      for (let b = top - c.near; b <= top; b++) { const v = cur.get(b); if (v && v >= thr) since[b] = S.since[b] ?? ts; }
      S.since = since; S.prev = { cur, top, ts };
      S.cand = S.cand.filter(k => {
        if (ts < k.t1 + 300) return true;
        const vendu = S.tr.filter(t => t.m && t.t > k.t0 && t.t <= k.t1 && t.p < (k.b + 1) * T).reduce((a, t) => a + t.q, 0), prix = k.b * T;
        if (vendu < c.exec * k.dQ) { S.n.retires++; log('retiré', { prix, q: k.was, vendu }); }
        else if (k.lv < c.niveaux || k.tot < c.total * k.was) log('mangé, balayage trop faible', { prix, q: k.was, vendu });
        else { S.n.manges++; log('mangé', { prix, q: k.was, vendu }); S.trig.push({ t: k.t1 }); }
        return false;
      });

      // Déclencheur + cascade armée dans les 15 s avant lui (sa chute peut finir jusqu'à 5 s après).
      // 2e patte (§A.3, 35:20 « il a pas été chercher à 57 ») : sommet P rejeté plus haut dans les 2 min avant la cascade
      // → seconde vente de 2 min placée sur P avec la même règle que sur H.
      S.trig = S.trig.filter(g => {
        const a = casc(S.h, g.t, { chute: chute(), tol: c.tol * T });
        if (a) {
          let P = -Infinity;
          for (const [t, p] of S.h) if (t >= a.t0 - c.sommet && t <= a.t0) P = Math.max(P, p);
          if (!S.ord.some(o => o.kind === 'signal') && !S.plan.some(p => p.kind === 'signal')) {
            const at = Math.max(g.t + c.delai, ts);
            S.plan.push({ kind: 'signal', at, H: a.H });
            if (P > a.H + c.bande[1] * T) S.plan.push({ kind: 'signal', patte: 2, at, H: P });
          }
          log('signal', { H: a.H });
          return false;
        }
        if (ts - g.t > 5000) { log('mangé sans cascade'); return false; }
        return true;
      });

      for (const p of S.plan.filter(p => ts >= p.at)) place(p, bb);
      S.plan = S.plan.filter(p => ts < p.at);
      for (const o of S.ord.slice()) {
        o.max = Math.max(o.max, S.L);
        if (ts - o.pose >= c.ttl) close(o, 'expiré');
        else if (ts - o.pose >= c.retourMs && o.max < o.limit - c.retour * T) close(o, 'pas de retour');
      }
      for (const o of S.fill.slice()) { // vente : gain en bp quand le prix baisse
        const bp = (o.limit - S.L) / o.limit * 1e4;
        o.mfe = Math.max(o.mfe, bp); o.mae = Math.min(o.mae, bp);
        for (const m of [1, 2, 5]) if (o['pnl' + m] == null && ts - o.exec >= m * 60000) o['pnl' + m] = bp;
        if (o.pnl5 != null) close(o, 'exécuté');
      }

      if (ts - S.sec >= 1000) {
        S.sec = ts;
        let hi = S.L;
        for (let i = S.h.length - 1; i >= 0 && S.h[i][0] >= ts - 5000; i--) hi = Math.max(hi, S.h[i][1]);
        S.d5.push([ts, hi - S.L]);
        while (S.d5[0][0] < ts - 3600e3) S.d5.shift();
        for (const v of near) S.sizes.push([ts, v]);
        while (S.sizes.length && S.sizes[0][0] < ts - 600e3) S.sizes.shift();
        S.p95 = bnQ(S.sizes.map(x => x[1]), c.pct);
        while (S.tr.length && S.tr[0].t < ts - 5000) S.tr.shift();
        const a = casc(S.h, ts - 5000, { chute: chute(), tol: c.tol * T, ttl: 1000 }); // cascades dont la fenêtre de 5 s est close
        if (a && a.t0 > S.arm + 10000) { S.arm = a.t0; S.n.cascades++; log('cascade', { H: a.H }); }
      }
    },
  };
}

// Bilan par type d'ordre et par patte : exécutés et moyennes en bp (vente : > 0 = gagnant) à +1 / +2 / +5 min, meilleur / pire écart.
const bnStats = done => Object.fromEntries(['signal', 'témoin'].flatMap(k => [[k, 1], [k, 2]]).map(([k, n]) => {
  const d = done.filter(o => o.kind === k && (o.patte || 1) === n), x = d.filter(o => o.statut === 'exécuté');
  const m = f => x.length ? x.reduce((a, o) => a + o[f], 0) / x.length : null;
  return [n > 1 ? k + ' 2e patte' : k, { n: d.length, exec: x.length, pnl1: m('pnl1'), pnl2: m('pnl2'), pnl5: m('pnl5'), mfe: m('mfe'), mae: m('mae') }];
}));

if (typeof module !== 'undefined') module.exports = { bnBook, bnRule, bnStats };
