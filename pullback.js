// Backtest « trend pullback H4/H1 » sur bougies H1 (CSV timestamp,open,high,low,close).
//   node pullback.js paxg                                  télécharge data/paxg-h1.csv (Binance PAXG/USDT 2021→, hors week-end)
//   node pullback.js data/paxg-h1.csv                      ask = bid + P.spread
//   node pullback.js data/xauusd-h1-bid.csv data/xauusd-h1-ask.csv
//     (npx dukascopy-node -i xauusd -from 2020-01-01 -t h1 -p bid -f csv -dir data -fn xauusd-h1-bid, idem -p ask)
// Biais H4 (dernière bougie H4 close) : clôture > EMA montante = achats seuls, < EMA descendante = ventes seules.
// Signal H1 : la mèche touche l'EMA H1 et la bougie clôture du bon côté → entrée à l'ouverture suivante.
// Stop : plus bas (haut) des `swing` dernières bougies ∓ marge. Objectif : rr × risque. Achat au ask, sortie au bid.
// be : stop au prix d'entrée dès +1R. partiel : fraction fermée à +1R (puis stop au prix d'entrée).
// sauf : heures UTC sans entrée (ex. [12, 15] = publications US de 8 h 30 ET, approximation du filtre news).
// Stop et objectif (ou +1R) dans la même bougie = stop d'abord (prudent) ; gap au-delà du niveau = sortie à l'ouverture.
// Navigateur (pullback.html) : run, stats, paxgBars, spreadAsk, P en globales ; Node : CLI + module.exports.
const fs = typeof require === 'function' ? require('fs') : null;
const H = 3600e3;
const P = { ema: 50, swing: 5, marge: 1, rr: 2, heures: [7, 17], sauf: null, be: false, partiel: 0, risque: 0.005, spread: 0.35 };

const load = f => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1)
  .map(l => { const [t, o, h, lo, c] = l.split(',').map(Number); return { t, o, h, l: lo, c }; });
const spreadAsk = (bid, s = P.spread) => bid.map(x => ({ t: x.t, o: x.o + s, h: x.h + s, l: x.l + s, c: x.c + s }));
const ema = (xs, n) => { const k = 2 / (n + 1), out = []; xs.forEach((x, i) => out.push(i ? out[i - 1] + k * (x - out[i - 1]) : x)); return out; };

// bid, ask : bougies H1 closes, alignées (même t, triées). → trades fermés [{ t, side (1|-1), entry, stop, target, exit_t, exit, r }]
// + tr.etat = { pos (ouverte), sig (entrée à l'ouverture de la prochaine bougie), bias H4, ema H1 } après la dernière bougie.
function run(bid, ask, p = P) {
  const mid = bid.map((b, i) => ({ h: (b.h + ask[i].h) / 2, l: (b.l + ask[i].l) / 2, c: (b.c + ask[i].c) / 2 }));
  const e1 = ema(mid.map(m => m.c), p.ema), h4 = [];
  bid.forEach((b, i) => {
    const k = Math.floor(b.t / (4 * H)), last = h4[h4.length - 1];
    if (last && last.k === k) last.c = mid[i].c; else h4.push({ k, c: mid[i].c, end: (k + 1) * 4 * H });
  });
  const e4 = ema(h4.map(x => x.c), p.ema), tr = [];
  let pos = null, sig = null, j = -1;
  const biasAt = j => h4[j].c > e4[j] && e4[j] > e4[j - 1] ? 1 : h4[j].c < e4[j] && e4[j] < e4[j - 1] ? -1 : 0;
  for (let i = 0; i < bid.length; i++) {
    const b = bid[i], a = ask[i];
    if (sig) { // entrée à l'ouverture de la bougie qui suit le signal
      const entry = sig.side > 0 ? a.o : b.o, risk = (entry - sig.stop) * sig.side;
      if (risk > 0) pos = { t: b.t, side: sig.side, entry, stop: sig.stop, target: entry + sig.side * p.rr * risk, risk, part: 0, gere: false };
      sig = null;
    }
    if (pos) {
      const L = pos.side > 0, x = L ? b : a; // un achat sort au bid, une vente au ask
      const stopHit = L ? x.l <= pos.stop : x.h >= pos.stop, tgtHit = L ? x.h >= pos.target : x.l <= pos.target;
      const un = L ? x.h >= pos.entry + pos.risk : x.l <= pos.entry - pos.risk;
      if (stopHit || tgtHit) {
        const lvl = stopHit ? pos.stop : pos.target, exit = (stopHit === L) ? Math.min(x.o, lvl) : Math.max(x.o, lvl);
        const part = pos.gere ? pos.part : stopHit ? 0 : p.partiel, r = (exit - pos.entry) * pos.side / pos.risk;
        tr.push({ ...pos, exit_t: b.t, exit, r: part + (1 - part) * r });
        pos = null;
      } else if ((p.be || p.partiel) && !pos.gere && un) Object.assign(pos, { gere: true, stop: pos.entry, part: p.partiel });
      continue;
    }
    while (j + 1 < h4.length && h4[j + 1].end <= b.t + H) j++; // H4 closes à la clôture de cette H1
    const hr = new Date(b.t + H).getUTCHours();
    if (j < p.ema || i < p.ema || hr < p.heures[0] || hr >= p.heures[1] || (p.sauf && hr >= p.sauf[0] && hr < p.sauf[1])) continue;
    const bias = biasAt(j);
    const m = mid[i], last = mid.slice(i - p.swing + 1, i + 1);
    if (bias > 0 && m.l <= e1[i] && m.c > e1[i]) sig = { side: 1, stop: Math.min(...last.map(x => x.l)) - p.marge };
    if (bias < 0 && m.h >= e1[i] && m.c < e1[i]) sig = { side: -1, stop: Math.max(...last.map(x => x.h)) + p.marge };
  }
  const end = bid.length ? bid[bid.length - 1].t + H : 0;
  while (j + 1 < h4.length && h4[j + 1].end <= end) j++;
  tr.etat = { pos, sig, bias: j > 0 ? biasAt(j) : 0, ema: e1[e1.length - 1] };
  return tr;
}

function stats(tr, risque = P.risque) {
  let eq = 1, peak = 1, dd = 0, ddR = 0, cum = 0, peakR = 0;
  for (const t of tr) {
    eq *= 1 + risque * t.r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    cum += t.r; peakR = Math.max(peakR, cum); ddR = Math.max(ddR, peakR - cum);
  }
  const g = tr.filter(t => t.r > 0).reduce((s, t) => s + t.r, 0), l = -tr.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0);
  return { trades: tr.length, gagnants: tr.length ? +(tr.filter(t => t.r > 0).length / tr.length * 100).toFixed(1) : 0,
    pf: l ? +(g / l).toFixed(2) : null, R_moyen: tr.length ? +(cum / tr.length).toFixed(3) : 0, R_total: +cum.toFixed(1),
    dd_R: +ddR.toFixed(1), capital: +((eq - 1) * 100).toFixed(1), dd_pct: +(dd * 100).toFixed(1) };
}

// Toute la grille ; trades entrés avant `cut` = réglage, après = contrôle (période jamais vue). Classement sur le réglage seul.
const GRID = { ema: [20, 50], rr: [1.5, 2, 3], heures: [[7, 17], [0, 24]], sauf: [null, [12, 15]], gestion: ['aucune', 'be', 'partiel'] };
function valide(bid, ask, cut, minN = 30) {
  const combos = Object.entries(GRID).reduce((acc, [k, vs]) => acc.flatMap(o => vs.map(v => ({ ...o, [k]: v }))), [{}]);
  return combos.map(g => {
    const p = { ...P, ...g, be: g.gestion === 'be', partiel: g.gestion === 'partiel' ? 0.5 : 0 }, tr = run(bid, ask, p);
    return { g, reglage: stats(tr.filter(t => t.t < cut)), controle: stats(tr.filter(t => t.t >= cut)) };
  }).filter(r => r.reglage.trades >= minN).sort((a, b) => b.reglage.R_total - a.reglage.R_total);
}

// Binance PAXG/USDT 1 h (or tokenisé, ~spot), bougies closes seulement ; week-end retiré (ven. 21 h → dim. 22 h UTC)
// pour coller aux horaires du spot.
async function paxgBars(from) {
  const out = [];
  for (let t = from; t < Date.now();) {
    const k = await (await fetch(`https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1h&startTime=${t}&limit=1000`)).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const [ts, o, h, l, c] of k) {
      const d = new Date(ts), w = d.getUTCDay(), hr = d.getUTCHours();
      if (ts + H > Date.now() || w === 6 || (w === 5 && hr >= 21) || (w === 0 && hr < 22)) continue;
      out.push({ t: ts, o: +o, h: +h, l: +l, c: +c });
    }
    t = k[k.length - 1][0] + H;
  }
  return out;
}
async function paxg(f = 'data/paxg-h1.csv') {
  const b = await paxgBars(Date.UTC(2021, 0, 1));
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(f, ['timestamp,open,high,low,close', ...b.map(x => [x.t, x.o, x.h, x.l, x.c].join(','))].join('\n'));
  console.log(b.length, 'bougies →', f);
}

if (typeof module !== 'undefined' && require.main === module) (async () => {
  const [fb, fa] = process.argv.slice(2);
  if (fb === 'paxg') return paxg();
  if (!fb) return console.log('node pullback.js paxg | bid.csv [ask.csv]');
  let bid = load(fb), ask;
  if (fa) {
    const A = new Map(load(fa).map(x => [x.t, x]));
    bid = bid.filter(x => A.has(x.t)); ask = bid.map(x => A.get(x.t));
  } else ask = spreadAsk(bid);
  const d = t => new Date(t).toISOString().slice(0, 10), cut = bid[Math.floor(bid.length * 0.6)].t;
  console.log(`${bid.length} bougies H1 ${d(bid[0].t)} → ${d(bid[bid.length - 1].t)}${fa ? '' : ` (ask = bid + ${P.spread})`}`);
  console.log(`capital / dd_pct : risque ${P.risque * 100} % par trade, composé\n\nRègles de base :`);
  const tr = run(bid, ask), rows = { Total: stats(tr), Achats: stats(tr.filter(t => t.side > 0)), Ventes: stats(tr.filter(t => t.side < 0)) };
  for (const y of [...new Set(tr.map(t => d(t.t).slice(0, 4)))]) rows[`An ${y}`] = stats(tr.filter(t => d(t.t).startsWith(y)));
  console.table(rows);
  const v = valide(bid, ask, cut), cols = ({ trades, pf, R_total, dd_R }) => `${trades} tr, PF ${pf}, ${R_total} R, dd ${dd_R} R`;
  const base = v.find(r => r.g.ema === 50 && r.g.rr === 2 && r.g.heures[0] === 7 && !r.g.sauf && r.g.gestion === 'aucune');
  console.log(`Validation : ${v.length} réglages classés sur ${d(bid[0].t)} → ${d(cut)}, contrôlés sur ${d(cut)} → fin`);
  console.table(Object.fromEntries([...v.slice(0, 8), ...(base ? [{ ...base, base: 1 }] : [])].map((r, i) => [
    r.base ? 'base' : `#${i + 1}`,
    { ema: r.g.ema, rr: r.g.rr, heures: r.g.heures.join('–'), sauf: r.g.sauf ? r.g.sauf.join('–') : '-', gestion: r.g.gestion,
      réglage: cols(r.reglage), contrôle: cols(r.controle) }])));
  const ok = v.filter(r => r.controle.R_total > 0).length;
  console.log(`${ok} / ${v.length} réglages gagnants sur le contrôle ; n°1 du réglage → contrôle ${v[0].controle.R_total} R`);
})();

if (typeof module !== 'undefined') module.exports = { run, stats, valide, paxgBars, spreadAsk, P };
