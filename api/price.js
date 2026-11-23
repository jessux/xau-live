async function swissquote() {
  const j = await (await fetch('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD')).json();
  const q = j[0].spreadProfilePrices.find(p => p.spreadProfile === 'prime') || j[0].spreadProfilePrices[0];
  return { bid: q.bid, ask: q.ask, source: 'Swissquote' };
}
async function goldapi() {
  const j = await (await fetch('https://api.gold-api.com/price/XAU')).json();
  return { bid: j.price, ask: j.price, source: 'gold-api.com' };
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=1');
  const errors = [];
  for (const src of [swissquote, goldapi]) {
    try { return res.json({ ...(await src()), ts: Date.now() }); }
    catch (e) { errors.push(src.name + ': ' + (e.cause?.code || e.message)); }
  }
  res.status(502).json({ error: errors.join(' | ') });
};
