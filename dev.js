// Serveur local sans dépendance : node dev.js → http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;

// Derrière un proxy d'entreprise : le fetch de Node 20 ignore HTTPS_PROXY → tunnel CONNECT (GET uniquement)
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
if (PROXY) {
  const https = require('https'), tls = require('tls');
  const px = new URL(PROXY);
  global.fetch = (url, o = {}) => new Promise((resolve, reject) => {
    const t = new URL(url);
    http.request({ host: px.hostname, port: px.port, method: 'CONNECT', path: `${t.hostname}:443`,
      headers: { Host: `${t.hostname}:443`, 'User-Agent': 'curl/8.0',
        ...(px.username && { 'Proxy-Authorization': 'Basic ' + Buffer.from(decodeURIComponent(px.username) + ':' + decodeURIComponent(px.password)).toString('base64') }) } })
      .on('connect', (r, socket) => {
        if (r.statusCode !== 200) return reject(new Error('proxy CONNECT ' + r.statusCode));
        const agent = Object.assign(new https.Agent(), { createConnection: () => tls.connect({ socket, servername: t.hostname }) });
        https.get(t, { headers: o.headers, agent }, res => {
          let body = '';
          res.on('data', c => body += c).on('end', () => resolve({
            ok: res.statusCode < 400, status: res.statusCode, text: async () => body, json: async () => JSON.parse(body)
          }));
        }).on('error', reject);
      }).on('error', reject).end();
  });
  console.log('fetch via proxy', PROXY);
}
http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u.startsWith('/api/')) {
    const f = path.join(__dirname, 'api', path.basename(u) + '.js');
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found'); }
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    res.status = c => (res.statusCode = c, res);
    return require(f)(req, res);
  }
  const f = path.join(__dirname, u === '/' ? 'index.html' : path.basename(u));
  const type = { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(f)];
  if (!type || !fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', type + '; charset=utf-8');
  res.end(fs.readFileSync(f));
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
