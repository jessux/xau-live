// node test.js
const assert = require('assert'), { zones, engine, STRATS, backtest, optimise } = require('./xau.js');

// V sur 20 min : creux à 3690 à la 10e minute → une seule zone, d'achat, autour de 3690
const v = [];
for (let i = 0; i < 1200; i++) v.push([i * 1000, 3690 + Math.abs(i - 600) / 60]);
const z = zones(v, 3700);
assert.strictEqual(z.length, 1);
assert.strictEqual(z[0].side, 'buy');
assert(Math.abs(z[0].lo + .3 - 3690) < .01);

// Momentum seul : 5 ticks haussiers → achat au ask, puis objectif ; ensuite baisse → vente, puis stop
const params = Object.fromEntries(Object.entries(STRATS).map(([k, s]) => [k, { ...s.p, on: k === 'momentum', pause: 0 }]));
const trades = [], E = engine(params, t => trades.push(t));
let ts = 0, px = 3700;
const go = (n, d) => { for (let i = 0; i < n; i++) { px += d; E.tick(ts += 1000, px - .1, px + .1); } };
go(17, .3); // entrée au 6e tick, +3,3 $ de mid au 17e = objectif (spread 0,2 payé)
assert.strictEqual(trades[0].side, 'buy');
assert.strictEqual(trades[0].reason, 'objectif');
assert(trades[0].pnl >= 3);
go(8, -.3); go(10, .3);
assert.strictEqual(trades[1].side, 'sell');
assert.strictEqual(trades[1].reason, 'stop');
assert(trades[1].pnl <= -1.5);

// Déséquilibre seul : prix plat, carnet acheteur ≥ seuil (0,2) pendant 3 ticks → achat
const p2 = Object.fromEntries(Object.entries(STRATS).map(([k, s]) => [k, { ...s.p, on: k === 'desequilibre', pause: 0 }]));
const E2 = engine(p2, () => {});
[0.5, 0.6, 0.1, 0.5, 0.5].forEach((imb, i) => E2.tick(i * 1000, 3699.9, 3700.1, true, { imb }));
assert(!E2.S.pos.desequilibre);
E2.tick(5000, 3699.9, 3700.1, true, { imb: 0.45 });
assert.strictEqual(E2.S.pos.desequilibre.side, 'buy');

// Acheteur mangé : mur d'achat 3699 tenu, sommet 3701 puis chute ≥ 0,8 $ en ≤ 5 s, le mur disparaît quand le prix passe dessous
// → vente limite à 3701, exécutée au retour du prix, puis objectif. Mur retiré sans traversée du prix → rien.
const p3 = Object.fromEntries(Object.entries(STRATS).map(([k, s]) => [k, { ...s.p, on: k === 'mange', pause: 0 }]));
const t3 = [], E3 = engine(p3, t => t3.push(t));
const run3 = (seq, wall) => seq.forEach(m => E3.tick(ts += 1000, m - .1, m + .1, true, { wallBid: wall }));
ts = 0;
run3([3700, 3700, 3700, 3700.5, 3701], 3699);
run3([3700.6, 3700, 3699.5], 3699);
assert(!E3.S.ord.mange);
run3([3698.8], null);
assert.strictEqual(E3.S.ord.mange.limit, 3701);
run3([3699.5, 3701.2], null);
assert(E3.S.pos.mange && E3.S.pos.mange.entry === 3701);
run3([3699, 3696.8], null);
assert.strictEqual(t3[0].reason, 'objectif');
assert(Math.abs(t3[0].pnl - 4.1) < 1e-9);
run3([3700, 3700, 3700.5, 3701, 3700, 3699.6], 3699);
run3([3699.7], null);
assert(!E3.S.ord.mange && !E3.S.pos.mange);

// Binance : carnet local (instantané + diffs, trou de séquence → resync)
const { bnBook, bnRule, bnStats } = require('./binance.js');
const BK = bnBook();
assert.strictEqual(BK.diff({ U: 90, u: 95, pu: 89, b: [], a: [] }), false);
assert.strictEqual(BK.snapshot({ lastUpdateId: 100, bids: [['10', '1']], asks: [['11', '1']] }), undefined);
assert.strictEqual(BK.diff({ U: 98, u: 105, pu: 97, b: [['10', '0'], ['9', '2']], a: [] }), true);
assert(!BK.bids.has(10) && BK.bids.get(9) === 2);
assert.strictEqual(BK.diff({ U: 106, u: 110, pu: 105, b: [], a: [] }), true);
assert.strictEqual(BK.diff({ U: 112, u: 115, pu: 111, b: [], a: [] }), 'resync');

// Binance : gros bid (10 contre 1) à 99990.5 tenu 3 s, balayé par des ventes pendant une chute de 21 T depuis 100000
// → vente limite à 99999 (multiple de 20 T dans [H − 5 ; H + 2], moins 1 T), exécutée, bilan à +5 min ; témoin sans retour.
// Même scénario sans transactions = bid retiré : aucun ordre.
// Précédé d'un sommet rejeté à 100030 (redescente de 3 T/s, sans cascade) → 2e patte : seconde vente à 100030, sans retour.
function scen(sweep, top) {
  const R = bnRule({ tick: 0.1 }, () => 0), bids = new Map(), B = { bids, asks: new Map([[100000.5, 1]]) };
  for (let i = 0; i < 13; i++) bids.set(99999.5 - i, i === 9 ? 10 : 1);
  let t = 1000;
  const steps = to => { for (; t <= to; t += 100) R.step(B, t); };
  if (top) { for (let p = top; p >= 100000; p -= 3) { R.trade({ t, p, q: .1, m: false }); steps(t + 900); } steps(t + 10900); }
  const o = t - 1000;
  R.trade({ t, p: 100000, q: .1, m: false }); steps(o + 4000);
  for (let i = 0; i < 10; i++) bids.delete(99999.5 - i);
  if (sweep) for (let i = 0; i < 10; i++) R.trade({ t: o + 4050, p: 99999.5 - i, q: i === 9 ? 10 : 1, m: true });
  steps(o + 4400);
  R.trade({ t: o + 4450, p: 99979, q: 1, m: true }); steps(o + 20000);
  R.trade({ t: o + 20050, p: 99999.5, q: 1, m: false });
  R.trade({ t: o + 20060, p: 99989, q: 1, m: true }); steps(o + 330000);
  return R;
}
const R1 = scen(true), sig = R1.S.done.find(o => o.kind === 'signal'), tem = R1.S.done.find(o => o.kind === 'témoin');
assert.strictEqual(R1.S.T, 1);
assert.deepStrictEqual([R1.S.n.cascades, R1.S.n.manges, R1.S.n.ordres, R1.S.n.executions], [1, 1, 1, 1]);
assert.strictEqual(sig.limit, 99999);
assert.strictEqual(sig.statut, 'exécuté');
assert(Math.abs(sig.pnl5 - 10 / 99999 * 1e4) < 1e-9);
assert.strictEqual(tem.limit, 100009);
assert.strictEqual(tem.statut, 'pas de retour');
const R2 = scen(false);
assert.deepStrictEqual([R2.S.n.retires, R2.S.n.manges, R2.S.done.length], [1, 0, 0]);
const R3 = scen(true, 100030), pt2 = R3.S.done.filter(o => o.patte === 2);
assert.deepStrictEqual([R3.S.n.cascades, R3.S.n.ordres, R3.S.n.executions], [1, 2, 1]);
assert.strictEqual(R3.S.done.find(o => o.kind === 'signal' && !o.patte).statut, 'exécuté');
assert.deepStrictEqual(pt2.map(o => [o.kind, o.limit, o.statut]).sort(), [['signal', 100030, 'pas de retour'], ['témoin', 100040, 'pas de retour']]);
assert.strictEqual(bnStats(R3.S.done)['signal 2e patte'].n, 1);

// Optimiseur : 1 h de sinusoïde. Le cache de zones ne change pas les résultats ; un réglage proposé gagne sur les deux moitiés.
const S = [];
for (let i = 0; i < 3600; i++) { const m = 3700 + 3 * Math.sin(i / 90); S.push([i * 1000, m - .1, m + .1, null, null, null]); }
assert.deepStrictEqual(backtest(S, 'rebond', {}, new Map()), backtest(S, 'rebond', {}));
for (const k in STRATS) {
  const o = optimise(S, k, STRATS[k].p, new Map());
  assert(o.essais >= 48 && o.actuel.train.n >= 0);
  if (o.best) assert(o.best.train.pnl > 0 && o.best.test.pnl > 0 && o.best.train.n >= 3 && o.best.test.n >= 3);
}
console.log('ok', trades.length, 'trades');

// Pullback H4/H1 (EMA 5) : hausse régulière sans toucher l'EMA, une mèche jusqu'à l'EMA → achat à l'ouverture suivante (ask),
// stop = plus bas mid des 2 dernières bougies − 1 $, puis hausse → objectif 2R. Même mèche suivie d'une chute → stop, −1 R.
const pb = require('./pullback.js');
const pbRun = (tail, o = {}) => {
  const bid = [];
  let c = 2000;
  const bar = (dc, wick = 0.2) => { const o = c; c += dc; bid.push({ t: bid.length * 3600e3, o, h: c + .2, l: Math.min(o, c) - wick, c }); };
  for (let i = 0; i < 40; i++) bar(1);
  bar(1, 3);
  tail.forEach(d => bar(d));
  return pb.run(bid, bid.map(b => ({ t: b.t, o: b.o + .2, h: b.h + .2, l: b.l + .2, c: b.c + .2 })), { ...pb.P, ema: 5, swing: 2, heures: [0, 24], ...o });
};
const near = (a, b) => Math.abs(a - b) < 1e-9;
const up = pbRun([2, 2, 2, 2, 2, 2, 2]);
assert.strictEqual(up.length, 1);
assert(up[0].side === 1 && near(up[0].entry, 2041.2) && near(up[0].stop, 2036.1) && near(up[0].r, 2));
const down = pbRun([0, -20]);
assert(down.length === 1 && near(down[0].r, -1));
// +1R puis chute : break-even → 0 R ; moitié fermée à +1R → 0,5 R ; moitié à +1R puis objectif → 1,5 R.
// Signal sur la bougie 40 h → 41 h (clôture 17 h UTC) : exclu par sauf [17, 18].
const pull = [2, 2, 2, -20];
assert(near(pbRun(pull)[0].r, -1) && near(pbRun(pull, { be: true })[0].r, 0) && near(pbRun(pull, { partiel: .5 })[0].r, .5));
assert(near(pbRun([2, 2, 2, 2, 2, 2, 2], { partiel: .5 })[0].r, 1.5));
assert.strictEqual(pbRun([2, 2, 2, 2, 2, 2, 2], { sauf: [17, 18] }).length, 0);
assert.strictEqual(pbRun([2, 2, 2, 2, 2, 2, 2], { sauf: [16, 17] }).length, 1);
assert.strictEqual(pb.stats([{ r: 2 }, { r: -1 }, { r: -1 }, { r: 2 }]).pf, 2);
console.log('ok pullback');

// Une erreur de cotation n'affiche pas NaN et n'entre pas dans l'historique Scalp.
(async () => {
  const { readFileSync } = require('fs'), { runInNewContext } = require('vm');
  const html = readFileSync(require('path').join(__dirname, 'scalp.html'), 'utf8');
  const script = html.slice(html.indexOf('async function poll()'), html.indexOf('// --- Rejeu'));
  const els = { px: {}, pxm: {} };
  await runInNewContext(`${script}\npoll()`, {
    $: id => els[id], document: {},
    fetch: async () => ({ json: async () => ({ error: 'ENOTFOUND' }) }),
    run: () => assert.fail('Cotation invalide enregistrée'),
  });
  assert.strictEqual(els.px.textContent, '—');
  assert.strictEqual(els.pxm.textContent, 'Prix indisponible');
})().catch(e => { console.error(e); process.exitCode = 1; });

// Persistance du journal Binance : rechargement, ancien format et erreur de stockage.
(async () => {
  const vm = require('vm'), fs = require('fs');
  const script = fs.readFileSync('binance.html', 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const data = new Map(), storage = {
    getItem: k => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
  };
  function page(offline = false) {
    const els = { sym: { value: 'BTCUSDT' } }, handlers = {};
    const document = {
      getElementById: id => els[id] || (els[id] = {}),
      addEventListener: (event, fn) => { handlers[event] = fn; },
      visibilityState: 'visible',
    };
    const ctx = vm.createContext({
      bnRule, bnBook, bnStats, localStorage: storage,
      document,
      fetch: async () => {
        if (offline) throw new Error('hors ligne');
        return { json: async () => ({ symbols: ['BTCUSDT', 'ETHUSDT'].map(symbol => ({ symbol, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.1' }] })) }) };
      },
      WebSocket: class { close() {} },
      setInterval: () => 1, clearInterval: () => {}, setTimeout: () => {},
      addEventListener: (event, fn) => { handlers[event] = fn; }, confirm: () => true,
    });
    vm.runInContext(script, ctx);
    return { ctx, els, handlers, document };
  }
  const first = page();
  await vm.runInContext('start("ETHUSDT")', first.ctx);
  vm.runInContext(`run.R.S.now = 1000;
    for (let i = 0; i < 301; i++) {
      run.R.S.ord.push({ kind: 'signal', limit: 1 });
      run.R.trade({ t: 1000, p: 2, q: 1, m: false });
    }`, first.ctx);
  first.document.visibilityState = 'hidden';
  first.handlers.visibilitychange();
  assert.strictEqual(JSON.parse(data.get('bn-ETHUSDT')).log.length, 301);

  const offline = page(true);
  assert.strictEqual(offline.els.sym.value, 'ETHUSDT');
  assert.strictEqual(vm.runInContext('run', offline.ctx), null);
  assert(offline.els.log.innerHTML.includes('exécuté'));
  await vm.runInContext('start("ETHUSDT")', offline.ctx);
  assert(offline.els.st.textContent.includes('hors ligne'));
  assert(offline.els.log.innerHTML.includes('exécuté'));
  offline.els.sym.value = 'BTCUSDT';
  offline.els.sym.onchange();
  assert(!offline.els.log.innerHTML.includes('exécuté'));

  const second = page();
  await vm.runInContext('start("ETHUSDT")', second.ctx);
  assert.strictEqual(vm.runInContext('run.R.S.log.length', second.ctx), 301);
  assert(second.els.log.innerHTML.includes('exécuté'));
  second.els.rst.onclick();
  assert.strictEqual(JSON.parse(data.get('bn-ETHUSDT')).log.length, 0);

  data.set('bn-BTCUSDT', JSON.stringify({ done: [], n: {} }));
  const legacy = page();
  await vm.runInContext('start("BTCUSDT")', legacy.ctx);
  assert.strictEqual(vm.runInContext('run.R.S.log.length', legacy.ctx), 0);
  storage.setItem = () => { throw new Error('quota'); };
  legacy.handlers.pagehide();
  assert(legacy.els.storage.textContent.includes('quota'));
  assert.strictEqual(vm.runInContext('stop()', legacy.ctx), false);
  assert(vm.runInContext('run !== null', legacy.ctx));
  console.log('ok persistance Binance');
})().catch(e => { console.error(e); process.exitCode = 1; });
