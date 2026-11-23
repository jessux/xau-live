// Carnet d'ordres live de l'or tokenisé (PAXG / XAUT = 1 once), agrégé sur 5 carnets.
// Chaque niveau est exprimé en écart au mid de son propre carnet (pas de 0,10 $), pour être recalé sur le prix spot côté page.
const H = { headers: { 'User-Agent': 'xau-live' } };
const get = async u => { const r = await fetch(u, H); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const num = l => l.map(([p, q]) => [+p, +q]);
const VENUES = {
  'Binance PAXG': async () => { const j = await get('https://api.binance.com/api/v3/depth?symbol=PAXGUSDT&limit=100'); return [num(j.bids), num(j.asks)]; },
  'Binance XAUT': async () => { const j = await get('https://api.binance.com/api/v3/depth?symbol=XAUTUSDT&limit=100'); return [num(j.bids), num(j.asks)]; },
  'Kraken PAXG': async () => {
    const j = await get('https://api.kraken.com/0/public/Depth?pair=PAXGUSD&count=100');
    if (j.error?.length) throw new Error(j.error[0]);
    const b = Object.values(j.result)[0]; return [num(b.bids), num(b.asks)];
  },
  'Coinbase PAXG': async () => { const j = await get('https://api.exchange.coinbase.com/products/PAXG-USD/book?level=2'); return [num(j.bids), num(j.asks)]; },
  'Bitfinex XAUT': async () => {
    const j = await get('https://api.bitfinex.com/v2/book/tXAUT:USD/P0?len=100');
    return [j.filter(x => x[2] > 0).map(x => [x[0], x[2]]), j.filter(x => x[2] < 0).map(x => [x[0], -x[2]])];
  },
};
const STEP = 0.1, RANGE = 10;
module.exports = async (req, res) => {
  const names = Object.keys(VENUES), r = await Promise.allSettled(names.map(n => VENUES[n]()));
  const bids = {}, asks = {}, venues = [];
  r.forEach((x, i) => {
    if (x.status !== 'fulfilled') return venues.push({ name: names[i], error: x.reason.cause?.code || x.reason.message });
    const [b, a] = x.value, bb = Math.max(...b.map(l => l[0])), ba = Math.min(...a.map(l => l[0])), mid = (bb + ba) / 2;
    venues.push({ name: names[i], mid, spread: ba - bb });
    // bids : -0,1 $ et en dessous ; asks : +0,1 $ et au-dessus
    for (const [p, q] of b) { const o = -Math.ceil((mid - p) / STEP - 1e-9) * STEP; if (o >= -RANGE) bids[o.toFixed(1)] = (bids[o.toFixed(1)] || 0) + q; }
    for (const [p, q] of a) { const o = Math.ceil((p - mid) / STEP - 1e-9) * STEP; if (o <= RANGE) asks[o.toFixed(1)] = (asks[o.toFixed(1)] || 0) + q; }
  });
  const list = o => Object.entries(o).map(([k, q]) => [+k, q]);
  res.setHeader('Cache-Control', 's-maxage=1');
  res.json({ ts: Date.now(), step: STEP, venues, bids: list(bids).sort((a, b) => b[0] - a[0]), asks: list(asks).sort((a, b) => a[0] - b[0]) });
};
