const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const ProxyServer = require('./proxy-server');

const app = express();
const PORT = 3000;
const PROXY_PORT = 8888;

app.use(express.json());
app.use(express.static('public'));

// Initialize proxy server
const proxyServer = new ProxyServer(PROXY_PORT);
proxyServer.start();

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`Web interface running on http://localhost:${PORT}`);
  console.log(`Proxy server running on port ${PROXY_PORT}`);
  console.log('\nIMPORTANT: Install ca-cert.pem as a trusted root certificate to intercept HTTPS traffic.');
});

// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  proxyServer.addWebSocketClient(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'continue':
          proxyServer.continueRequest(data.requestId, data.customRequest);
          break;
        case 'respond':
          proxyServer.respondWithCustom(data.requestId, data.customResponse);
          break;
        case 'setBreakpoint':
          proxyServer.setBreakpoint(data.pattern, data.config);
          ws.send(JSON.stringify({ type: 'breakpointSet', pattern: data.pattern }));
          break;
        case 'removeBreakpoint':
          proxyServer.removeBreakpoint(data.pattern);
          ws.send(JSON.stringify({ type: 'breakpointRemoved', pattern: data.pattern }));
          break;
        case 'setMapping':
          proxyServer.setMapping(data.pattern, data.filePath);
          ws.send(JSON.stringify({ type: 'mappingSet', pattern: data.pattern }));
          break;
        case 'removeMapping':
          proxyServer.removeMapping(data.pattern);
          ws.send(JSON.stringify({ type: 'mappingRemoved', pattern: data.pattern }));
          break;
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });
});

// API endpoints
app.get('/api/ca-cert', (req, res) => {
  res.download(path.join(__dirname, 'ca-cert.pem'), 'network-interceptor-ca.pem');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║          Network Traffic Interceptor v1.0               ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log(`║  Web UI:    http://localhost:${PORT}                        ║`);
console.log(`║  Proxy:     localhost:${PROXY_PORT}                             ║`);
console.log('║                                                          ║');
console.log('║  Setup Instructions:                                     ║');
console.log('║  1. Download CA certificate from web UI                 ║');
console.log('║  2. Install it as trusted root certificate              ║');
console.log('║  3. Configure your system/browser to use proxy          ║');
console.log(`║     Proxy: localhost:${PROXY_PORT}                             ║`);
console.log('╚══════════════════════════════════════════════════════════╝\n');
