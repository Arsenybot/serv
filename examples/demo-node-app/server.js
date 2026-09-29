const http = require('http');

const PORT = process.env.PORT || 8080;
const VERSION = process.env.APP_VERSION || '1.0.0';
const startTime = Date.now();

const server = http.createServer((req, res) => {
  const url = req.url;

  if (url === '/health') {
    // Health check endpoint used by LocalPaaS zero-downtime readiness probe
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: VERSION,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>LocalPaaS Demo App</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #334155; text-align: center; max-width: 500px; }
            h1 { color: #38bdf8; margin-top: 0; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; background: #065f46; color: #34d399; font-weight: bold; font-size: 0.875rem; }
            code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f43f5e; font-size: 0.9em; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">LIVE DEPLOYMENT</div>
            <h1>LocalPaaS Demo Application</h1>
            <p>Deployed automatically from GitHub into Docker via LocalPaaS!</p>
            <p>Version: <code>${VERSION}</code> | Port: <code>${PORT}</code></p>
            <p>Try pushing changes to your GitHub branch to observe automated zero-downtime redeployment in action.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo app listening on http://0.0.0.0:${PORT}`);
  console.log(`Health check available at http://0.0.0.0:${PORT}/health`);
});
