// Serveur local sans dépendance : node dev.js → http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u.startsWith('/api/')) {
    const f = path.join(__dirname, 'api', path.basename(u) + '.js');
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found'); }
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    res.status = c => (res.statusCode = c, res);
    return require(f)(req, res);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
