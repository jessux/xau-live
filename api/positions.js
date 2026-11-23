let mfx = { session: null };
async function fastbull() {
  const r = await fetch('https://api.fastbull.com/fastbull-macro-data-service/api/getWebPendingOrder?orderType=1&pairId=28&selectTime=', { headers: { Referer: 'https://www.fastbull.com/' } });
  const o = JSON.parse((await r.json()).bodyMessage)[0];
  const p = o.price.map(Number), b = o.buyOrder.map(Number), s = o.sellOrder.map(Number), c = +o.currentPrice;
  const B = b.reduce((a, x) => a + x, 0), S = s.reduce((a, x) => a + x, 0);
  const levels = p.map((x, i) => [x, b[i], s[i]]).sort((a, z) => (z[1] + z[2]) - (a[1] + a[2])).slice(0, 15);
  return {
    source: 'FastBull', updated: o.createTime * 1000, long: B / (B + S) * 100, short: S / (B + S) * 100,
    longWin: b.reduce((a, x, i) => a + (p[i] < c ? x : 0), 0) / B * 100,
    shortWin: s.reduce((a, x, i) => a + (p[i] > c ? x : 0), 0) / S * 100, levels
  };
}
async function myfxbook() {
  const { MYFXBOOK_EMAIL: e, MYFXBOOK_PASSWORD: pw } = process.env;
  if (!e || !pw) return null;
  const get = async () => {
    if (!mfx.session) {
      const l = await (await fetch(`https://www.myfxbook.com/api/login.json?email=${encodeURIComponent(e)}&password=${encodeURIComponent(pw)}`)).json();
      if (l.error) throw new Error(l.message);
      mfx.session = l.session;
    }
    return (await fetch(`https://www.myfxbook.com/api/get-community-outlook.json?session=${mfx.session}`)).json();
  };
  let j = await get();
  if (j.error) { mfx.session = null; j = await get(); }
  const x = j.symbols.find(s => s.name === 'XAUUSD');
  return { source: 'Myfxbook', updated: Date.now(), long: +x.longPercentage, short: +x.shortPercentage, avgLong: +x.avgLongPrice, avgShort: +x.avgShortPrice };
}
module.exports = async (req, res) => {
  const [fb, mf] = await Promise.allSettled([fastbull(), myfxbook()]);
  res.setHeader('Cache-Control', 's-maxage=30');
  res.json({
    fastbull: fb.status === 'fulfilled' ? fb.value : { error: fb.reason.message },
    myfxbook: mf.status === 'fulfilled' ? mf.value : { error: mf.reason.message }
  });
};
