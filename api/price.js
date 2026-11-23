module.exports = async (req, res) => {
  try {
    const r = await fetch('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD');
    const j = await r.json();
    const q = j[0].spreadProfilePrices.find(p => p.spreadProfile === 'prime') || j[0].spreadProfilePrices[0];
    res.setHeader('Cache-Control', 's-maxage=1');
    res.json({ bid: q.bid, ask: q.ask, ts: j[0].ts || Date.now() });
  } catch (e) { res.status(502).json({ error: e.message }); }
};
