// node test.js
const assert = require('assert'), { zones, engine, STRATS } = require('./xau.js');

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
console.log('ok', trades.length, 'trades');
