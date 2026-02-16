const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const qrcode = require('qrcode-terminal');
const ProxyServer = require('./proxy-server');

function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const app = express();
const PORT = 3000;
const PROXY_PORT = 8888;

app.use(express.json());
app.use(express.static('public'));

// Initialize proxy server
const proxyServer = new ProxyServer(PROXY_PORT);
proxyServer.start();


// Create HTTP server
const server = app.listen(PORT);


// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  proxyServer.addWebSocketClient(ws);

  // Send initial breakpoints list
  const breakpoints = proxyServer.getBreakpoints();
  ws.send(JSON.stringify({ type: 'breakpointsList', breakpoints }));

  // Send initial SSL proxying list
  const sslProxyingList = proxyServer.getSslProxyingList();
  ws.send(JSON.stringify({ type: 'sslProxyingList', patterns: sslProxyingList }));

  // Send current recording state
  ws.send(JSON.stringify({
    type: 'recordingState',
    recording: proxyServer.isRecording(),
    filename: proxyServer.recording?.filename || null
  }));

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
        case 'continueResponse':
          proxyServer.continueResponse(data.requestId, data.customResponse);
          break;
        case 'setBreakpoint':
          const config = proxyServer.setBreakpoint(data.pattern, data.config);
          // Broadcast to all clients
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'breakpointSet', pattern: data.pattern, config }));
            }
          });
          break;
        case 'removeBreakpoint':
          proxyServer.removeBreakpoint(data.pattern);
          // Broadcast to all clients
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'breakpointRemoved', pattern: data.pattern }));
            }
          });
          break;
        case 'toggleBreakpoint':
          const toggledConfig = proxyServer.toggleBreakpoint(data.pattern, data.enabled);
          if (toggledConfig) {
            // Broadcast to all clients
            wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'breakpointToggled', pattern: data.pattern, enabled: data.enabled, config: toggledConfig }));
              }
            });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Breakpoint not found' }));
          }
          break;
        case 'updateBreakpoint':
          const result = proxyServer.updateBreakpoint(data.oldPattern, data.newConfig);
          if (result) {
            // Broadcast to all clients
            wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'breakpointUpdated', oldPattern: result.oldPattern, newPattern: result.newPattern, config: result.config }));
              }
            });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Breakpoint not found' }));
          }
          break;
        case 'getBreakpoints':
          const allBreakpoints = proxyServer.getBreakpoints();
          ws.send(JSON.stringify({ type: 'breakpointsList', breakpoints: allBreakpoints }));
          break;
        case 'setSslProxy':
          const sslConfig = proxyServer.setSslProxy(data.pattern, data.config || {});
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'sslProxySet', pattern: data.pattern, config: sslConfig }));
            }
          });
          break;
        case 'toggleSslProxy':
          const toggledSsl = proxyServer.toggleSslProxy(data.pattern, data.enabled);
          if (toggledSsl) {
            wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'sslProxyToggled', pattern: data.pattern, enabled: data.enabled, config: toggledSsl }));
              }
            });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'SSL proxy pattern not found' }));
          }
          break;
        case 'removeSslProxy':
          proxyServer.removeSslProxy(data.pattern);
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'sslProxyRemoved', pattern: data.pattern }));
            }
          });
          break;
        case 'getSslProxyingList':
          const allSslPatterns = proxyServer.getSslProxyingList();
          ws.send(JSON.stringify({ type: 'sslProxyingList', patterns: allSslPatterns }));
          break;
        case 'startRecording': {
          const filename = proxyServer.startRecording();
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'recordingStarted', filename }));
            }
          });
          break;
        }
        case 'stopRecording': {
          const stoppedFilename = proxyServer.stopRecording();
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'recordingStopped', filename: stoppedFilename }));
            }
          });
          break;
        }
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
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
});

// API endpoints
app.get('/api/ca-cert', (req, res) => {
  res.download(path.join(__dirname, 'ca-cert.pem'), 'intercept-ca.pem');
});

app.get('/api/recordings', (req, res) => {
  res.json(proxyServer.getRecordings());
});

app.get('/api/recordings/:filename', (req, res) => {
  const filename = req.params.filename;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..') || !filename.endsWith('.ndjson')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(proxyServer.recordingsDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.download(filePath, filename);
});

app.delete('/api/recordings/:filename', (req, res) => {
  try {
    proxyServer.deleteRecording(req.params.filename);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/setup', (req, res) => {
  const localIP = getLocalIPAddress();
  const html = fs.readFileSync(path.join(__dirname, 'public', 'setup.html'), 'utf8');
  const injected = html
    .replace(/\{\{SERVER_IP\}\}/g, localIP)
    .replace(/\{\{PROXY_PORT\}\}/g, String(PROXY_PORT));
  res.send(injected);
});


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const localIP = getLocalIPAddress();
const setupURL = `http://${localIP}:${PORT}/setup`;

const BOX_WIDTH = 58; // inner width between ║ characters

function padLine(text) {
  const pad = BOX_WIDTH - text.length;
  return '║' + text + ' '.repeat(Math.max(0, pad)) + '║';
}

console.log('\n╔' + '═'.repeat(BOX_WIDTH) + '╗');
console.log(padLine('          Network Traffic Interceptor v1.0'));
console.log('╠' + '═'.repeat(BOX_WIDTH) + '╣');
console.log(padLine(''));
console.log(padLine('  Scan to set up on your device:'));
console.log(padLine(''));

qrcode.generate(setupURL, { small: true }, (qr) => {
  const lines = qr.split('\n').filter(l => l.length > 0);
  for (const line of lines) {
    console.log(padLine('  ' + line));
  }
  console.log(padLine(''));
  console.log(padLine(`  Setup:  ${setupURL}`));
  console.log(padLine(`  Web UI: http://${localIP}:${PORT}`));
  console.log(padLine(`  Proxy:  ${localIP}:${PROXY_PORT}`));
  console.log(padLine(''));
  console.log('╚' + '═'.repeat(BOX_WIDTH) + '╝\n');
});
