const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const forge = require('node-forge');

// Certificate cache
const certCache = new Map();

// Generate CA certificate if it doesn't exist
function generateCACertificate() {
  const certPath = path.join(__dirname, 'ca-cert.pem');
  const keyPath = path.join(__dirname, 'ca-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = fs.readFileSync(keyPath, 'utf8');

    // Check expiration
    const cert = forge.pki.certificateFromPem(certPem);
    const now = new Date();
    const expiresAt = cert.validity.notAfter;
    if (expiresAt <= now) {
      console.error('\n⚠️  WARNING: CA certificate has EXPIRED (expired ' + expiresAt.toDateString() + ').');
      console.error('   HTTPS interception will not work. Delete ca-cert.pem and ca-key.pem, then restart to regenerate.\n');
    } else {
      const daysLeft = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24));
      if (daysLeft < 30) {
        console.warn('\n⚠️  WARNING: CA certificate expires in ' + daysLeft + ' days (' + expiresAt.toDateString() + ').');
        console.warn('   Consider regenerating soon: delete ca-cert.pem and ca-key.pem, then restart.\n');
      }
    }

    return { cert: certPem, key: keyPem };
  }

  console.log('Generating CA certificate...');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: 'commonName', value: 'Intercept CA' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'Intercept' }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());
  
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  
  fs.writeFileSync(certPath, certPem);
  fs.writeFileSync(keyPath, keyPem);
  
  console.log('CA certificate generated and saved.');
  console.log('Please install ca-cert.pem as a trusted root certificate on your system.');
  
  return { cert: certPem, key: keyPem };
}

// Generate certificate for specific hostname
function generateCertificate(hostname, caCert, caKey) {
  if (certCache.has(hostname)) {
    return certCache.get(hostname);
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 100000).toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  
  cert.setSubject([
    { name: 'commonName', value: hostname }
  ]);

  const caKeyObj = forge.pki.privateKeyFromPem(caKey);
  const caCertObj = forge.pki.certificateFromPem(caCert);

  cert.setIssuer(caCertObj.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
//    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
    { name: 'subjectKeyIdentifier' },
//    { name: 'authorityKeyIdentifier', keyIdentifier: true }
  ]);

  cert.sign(caKeyObj, forge.md.sha256.create());
  
  const result = {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey)
  };
  
  certCache.set(hostname, result);
  return result;
}

class ProxyServer {
  constructor(port = 8888, options = {}) {
    this.port = port;
    this.webSocketClients = new Set();
    this.breakpoints = new Map(); // URL pattern -> breakpoint config
    this.mappings = new Map(); // URL pattern -> file path
    this.sslProxyingList = new Map(); // hostname pattern -> config
    this.requestQueue = new Map(); // Request ID -> request data
    this.requestIdCounter = 0;
    this.breakpointTimeout = 120000; // 120 seconds (2 minutes)
    this.breakpointsFilePath = options.breakpointsFilePath || path.join(__dirname, 'breakpoints.json');
    this.sslProxyingFilePath = options.sslProxyingFilePath || path.join(__dirname, 'ssl-proxying.json');
    this.mappingsFilePath = options.mappingsFilePath || path.join(__dirname, 'mappings.json');
    this.recording = null; // when active: { filename, stream }
    this.recordingsDir = path.join(__dirname, 'recordings');
    this.mappedResponsesDir = path.join(__dirname, 'mapped-responses');

    const ca = generateCACertificate();
    this.caCert = ca.cert;
    this.caKey = ca.key;

    this.loadBreakpointsFromFile();
    this.loadSslProxyingFromFile();
    this.loadMappingsFromFile();
  }

  start() {
    // HTTP proxy server
    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // Handle CONNECT for HTTPS
    this.server.on('connect', (req, clientSocket, head) => {
      this.handleConnect(req, clientSocket, head);
    });

    this.server.listen(this.port);
  }

  addWebSocketClient(ws) {
    this.webSocketClients.add(ws);
    ws.on('close', () => this.webSocketClients.delete(ws));
  }

  broadcast(data) {
    // Clone data to avoid mutating original
    const broadcastData = { ...data };

    // Process request body if exists
    if (broadcastData.request?.body) {
      const reqEncoding = broadcastData.request.headers?.['content-encoding'];
      const reqDecompressed = this.decompressBody(broadcastData.request.body, reqEncoding);
      const processed = this.processBodyForBroadcast(
        reqDecompressed.body,
        broadcastData.request.headers
      );
      if (reqDecompressed.wasDecompressed) {
        processed.bodyMeta = { ...processed.bodyMeta, wasDecompressed: true, originalEncoding: reqDecompressed.originalEncoding };
      }
      broadcastData.request = { ...broadcastData.request, ...processed };
    }

    // Process response body if exists
    if (broadcastData.response?.body) {
      const resEncoding = broadcastData.response.headers?.['content-encoding'];
      const resDecompressed = this.decompressBody(broadcastData.response.body, resEncoding);
      const processed = this.processBodyForBroadcast(
        resDecompressed.body,
        broadcastData.response.headers
      );
      if (resDecompressed.wasDecompressed) {
        processed.bodyMeta = { ...processed.bodyMeta, wasDecompressed: true, originalEncoding: resDecompressed.originalEncoding };
      }
      broadcastData.response = { ...broadcastData.response, ...processed };
    }

    // Write to recording if active
    if (this.recording) {
      this.writeRecordingEntry(broadcastData);
    }

    const message = JSON.stringify(broadcastData);
    this.webSocketClients.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(message);
      }
    });
  }

  writeRecordingEntry(broadcastData) {
    if (!this.recording) return;

    const ts = Date.now();
    const req = broadcastData.request;
    if (!req) return;

    // Parse URL for pre-parsed fields
    let host = '', urlPath = '', query = '';
    try {
      const parsed = new URL(req.url);
      host = parsed.host;
      urlPath = parsed.pathname;
      query = parsed.search ? parsed.search.slice(1) : '';
    } catch (e) {
      // URL parsing failed, use raw url
    }

    const requestEntry = {
      ts,
      id: req.id,
      dir: 'request',
      method: req.method,
      url: req.url,
      host,
      path: urlPath,
      query,
      headers: req.headers,
      body: req.body ? (Buffer.isBuffer(req.body) ? req.body.toString('base64') : req.body) : undefined,
      bodyMeta: req.bodyMeta
    };

    this.recording.stream.write(JSON.stringify(requestEntry) + '\n');

    if (broadcastData.type === 'traffic' && broadcastData.response) {
      const res = broadcastData.response;
      const responseEntry = {
        ts,
        id: res.id,
        dir: 'response',
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body: res.body ? (Buffer.isBuffer(res.body) ? res.body.toString('base64') : res.body) : undefined,
        bodyMeta: res.bodyMeta
      };
      this.recording.stream.write(JSON.stringify(responseEntry) + '\n');
    }
  }

  async handleHttpRequest(clientReq, clientRes) {
    const requestId = ++this.requestIdCounter;
    const requestUrl = clientReq.url;
    // When used as an HTTP proxy, clientReq.url is already the full URL (e.g. http://example.com/path).
    // Only prepend the host when it's a relative path (direct/non-proxy request).
    const fullUrl = requestUrl.startsWith('http') ? requestUrl : `http://${clientReq.headers.host}${requestUrl}`;
    
    const requestData = {
      id: requestId,
      method: clientReq.method,
      url: fullUrl,
      headers: { ...clientReq.headers },
      timestamp: new Date().toISOString(),
      protocol: 'http'
    };

    // Collect request body
    const requestBody = await this.collectBody(clientReq);
    requestData.body = requestBody;

    // Check for breakpoint
    const breakpoint = this.checkBreakpoint(fullUrl);
    if (breakpoint) {
      // Check if there are WebSocket clients connected
      const hasClients = Array.from(this.webSocketClients).some(ws => ws.readyState === 1);

      if (!hasClients) {
        // No clients connected, auto-continue immediately
        console.log(`No WebSocket clients connected, auto-continuing request ${requestId}`);
        this.forwardRequest(requestData, clientRes);
        return;
      }

      // Set timeout to auto-continue if no action is taken
      const timeoutId = setTimeout(() => {
        console.log(`Breakpoint timeout for request ${requestId}, auto-continuing`);
        this.continueRequest(requestId);
      }, this.breakpointTimeout);

      this.requestQueue.set(requestId, {
        requestData,
        clientRes,
        breakpoint,
        phase: 'request',
        timeoutId,
        timestamp: Date.now()
      });

      this.broadcast({
        type: 'breakpoint',
        request: requestData
      });
      return;
    }

    // Check for mapping
    const mapping = this.checkMapping(fullUrl);
    if (mapping) {
      this.sendMappedResponse(clientRes, mapping, requestData);
      return;
    }

    this.forwardRequest(requestData, clientRes);
  }

  async forwardRequest(requestData, clientRes) {
    const parsedUrl = new URL(requestData.url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: requestData.method,
      headers: requestData.headers
    };

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const proxyReq = protocol.request(options, (proxyRes) => {
      const responseData = {
        id: requestData.id,
        status: proxyRes.statusCode,
        statusText: proxyRes.statusMessage,
        headers: { ...proxyRes.headers },
        timestamp: new Date().toISOString()
      };

      this.collectBody(proxyRes).then(body => {
        responseData.body = body;
        
        this.broadcast({
          type: 'traffic',
          request: requestData,
          response: responseData
        });

        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        clientRes.end(body);
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err);
      clientRes.writeHead(502);
      clientRes.end('Bad Gateway');
    });

    if (requestData.body) {
      proxyReq.write(requestData.body);
    }
    proxyReq.end();
  }

  handleConnect(req, clientSocket, head) {
    const { hostname, port } = this.parseHostPort(req.url);
    const requestId = ++this.requestIdCounter;

    // Check if hostname matches SSL proxying list for MITM interception
    if (!this.shouldSslProxy(hostname)) {
      // Plain TCP tunnel — no MITM, no decryption
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      const remoteSocket = net.connect(port, hostname);

      remoteSocket.on('error', (err) => {
        console.error(`Tunnel error to ${hostname}:${port}:`, err.message);
        clientSocket.destroy();
      });

      clientSocket.on('error', (err) => {
        console.error(`Client socket error for ${hostname}:`, err.message);
        remoteSocket.destroy();
      });

      clientSocket.pipe(remoteSocket);
      remoteSocket.pipe(clientSocket);

      // Broadcast minimal traffic entry so UI shows the connection
      this.broadcast({
        type: 'traffic',
        request: {
          id: requestId,
          method: 'CONNECT',
          url: `https://${hostname}:${port}`,
          headers: { ...req.headers },
          timestamp: new Date().toISOString(),
          protocol: 'https',
          tunneled: true
        },
        response: {
          id: requestId,
          status: 200,
          statusText: 'Connection Established (Tunneled)',
          headers: {},
          timestamp: new Date().toISOString()
        }
      });

      return;
    }

    // MITM interception — generate certificate and decrypt
    const { cert, key } = generateCertificate(hostname, this.caCert, this.caKey);

    const serverOptions = {
      key: key,
      cert: cert,
      SNICallback: (servername, cb) => {
        const { cert, key } = generateCertificate(servername, this.caCert, this.caKey);
        cb(null, require('tls').createSecureContext({ key, cert }));
      }
    };

    const httpsServer = https.createServer(serverOptions, (req, res) => {
      this.handleHttpsRequest(req, res, hostname);
    });

    httpsServer.on('tlsClientError', (err) => {
      console.error(`TLS client error for ${hostname}:`, err.message);
    });

    httpsServer.on('error', (err) => {
      console.error(`MITM server error for ${hostname}:`, err.message);
    });

    clientSocket.on('error', (err) => {
      console.error(`MITM client socket error for ${hostname}:`, err.message);
    });

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    httpsServer.emit('connection', clientSocket);
  }

  async handleHttpsRequest(clientReq, clientRes, hostname) {
    const requestId = ++this.requestIdCounter;
    const fullUrl = `https://${hostname}${clientReq.url}`;
    
    const requestData = {
      id: requestId,
      method: clientReq.method,
      url: fullUrl,
      headers: { ...clientReq.headers },
      timestamp: new Date().toISOString(),
      protocol: 'https'
    };

    const requestBody = await this.collectBody(clientReq);
    requestData.body = requestBody;

    // Check for breakpoint
    const breakpoint = this.checkBreakpoint(fullUrl);
    if (breakpoint) {
      // Check if there are WebSocket clients connected
      const hasClients = Array.from(this.webSocketClients).some(ws => ws.readyState === 1);

      if (!hasClients) {
        // No clients connected, auto-continue immediately
        console.log(`No WebSocket clients connected, auto-continuing request ${requestId}`);
        this.forwardRequest(requestData, clientRes);
        return;
      }

      // Set timeout to auto-continue if no action is taken
      const timeoutId = setTimeout(() => {
        console.log(`Breakpoint timeout for request ${requestId}, auto-continuing`);
        this.continueRequest(requestId);
      }, this.breakpointTimeout);

      this.requestQueue.set(requestId, {
        requestData,
        clientRes,
        breakpoint,
        phase: 'request',
        timeoutId,
        timestamp: Date.now()
      });

      this.broadcast({
        type: 'breakpoint',
        request: requestData
      });
      return;
    }

    // Check for mapping
    const mapping = this.checkMapping(fullUrl);
    if (mapping) {
      this.sendMappedResponse(clientRes, mapping, requestData);
      return;
    }

    this.forwardRequest(requestData, clientRes);
  }

  parseHostPort(hostString) {
    const [hostname, port] = hostString.split(':');
    return { hostname, port: port || 443 };
  }

  collectBody(stream) {
    return new Promise((resolve) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.length > 0 ? buffer : null);
      });
      stream.on('error', () => resolve(null));
    });
  }

  decompressBody(buffer, contentEncoding) {
    if (!buffer || !contentEncoding) {
      return { body: buffer, wasDecompressed: false };
    }

    const encoding = contentEncoding.trim().toLowerCase();

    try {
      let decompressed;
      if (encoding === 'gzip' || encoding === 'x-gzip') {
        decompressed = zlib.gunzipSync(buffer);
      } else if (encoding === 'deflate') {
        decompressed = zlib.inflateSync(buffer);
      } else if (encoding === 'br') {
        decompressed = zlib.brotliDecompressSync(buffer);
      } else {
        return { body: buffer, wasDecompressed: false };
      }

      return { body: decompressed, wasDecompressed: true, originalEncoding: encoding };
    } catch (error) {
      return { body: buffer, wasDecompressed: false, decompressError: error.message };
    }
  }

  isJsonContentType(headers) {
    const contentType = (headers['content-type'] || '').toLowerCase();
    return contentType.includes('application/json') ||
           contentType.includes('+json') ||
           contentType.includes('text/json');
  }

  isBinaryContentType(headers) {
    const contentType = (headers['content-type'] || '').toLowerCase();
    const binaryTypes = [
      'image/', 'video/', 'audio/', 'application/octet-stream',
      'application/pdf', 'application/zip', 'font/'
    ];
    return binaryTypes.some(type => contentType.includes(type));
  }

  processBodyForBroadcast(body, headers) {
    // Handle null/empty bodies
    if (!body || body.length === 0) {
      return { body: null };
    }

    // Convert Buffer to string (defensive: handle case where body is already string)
    const bodyString = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);

    // Handle binary content - encode as base64
    if (this.isBinaryContentType(headers)) {
      return {
        body: Buffer.isBuffer(body) ? body.toString('base64') : bodyString,
        bodyMeta: {
          contentType: 'binary',
          encoding: 'base64',
          originalSize: body.length
        }
      };
    }

    // Handle JSON content - parse and prettify
    if (this.isJsonContentType(headers)) {
      try {
        const parsed = JSON.parse(bodyString);
        return {
          body: JSON.stringify(parsed, null, 2),
          bodyMeta: {
            contentType: 'json',
            encoding: 'utf8',
            originalSize: body.length
          }
        };
      } catch (error) {
        // Malformed JSON - fallback to plain text
        return {
          body: bodyString,
          bodyMeta: {
            contentType: 'text',
            encoding: 'utf8',
            parseError: error.message
          }
        };
      }
    }

    // Default: treat as plain text
    return {
      body: bodyString,
      bodyMeta: {
        contentType: 'text',
        encoding: 'utf8'
      }
    };
  }

  startRecording() {
    if (this.recording) return this.recording.filename;

    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }

    const filename = new Date().toISOString().replace(/[:.]/g, '-') + '.ndjson';
    const filePath = path.join(this.recordingsDir, filename);
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.recording = { filename, stream };
    return filename;
  }

  stopRecording() {
    if (!this.recording) return null;
    const { filename, stream } = this.recording;
    this.recording = null;
    stream.end();
    return filename;
  }

  isRecording() {
    return this.recording !== null;
  }

  getRecordings() {
    if (!fs.existsSync(this.recordingsDir)) return [];
    const files = fs.readdirSync(this.recordingsDir);
    return files
      .filter(f => f.endsWith('.ndjson'))
      .map(filename => {
        const stat = fs.statSync(path.join(this.recordingsDir, filename));
        return { filename, size: stat.size, createdAt: stat.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  deleteRecording(filename) {
    // Validate filename to prevent path traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new Error('Invalid filename');
    }
    if (!filename.endsWith('.ndjson')) {
      throw new Error('Invalid filename');
    }
    const filePath = path.join(this.recordingsDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error('Recording not found');
    }
    fs.unlinkSync(filePath);
  }

  checkBreakpoint(url) {
    for (const [pattern, config] of this.breakpoints) {
      if (this.matchPattern(url, pattern) && config.enabled !== false) {
        return config;
      }
    }
    return null;
  }

  checkMapping(url) {
    for (const [pattern, config] of this.mappings) {
      if (config.enabled !== false && this.matchPattern(url, pattern)) {
        return config;
      }
    }
    return null;
  }

  matchPattern(url, pattern) {
    // Handle wildcard patterns (e.g., *api.example.com*, *api*, api.example.com*)
    if (pattern.includes('*')) {
      // Convert wildcard pattern to regex
      // Escape special regex characters except *
      const regexPattern = pattern
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');

      const regex = new RegExp(regexPattern);
      return regex.test(url);
    }

    // Exact substring match for non-wildcard patterns
    return url.includes(pattern);
  }

  sendMappedResponse(clientRes, config, requestData) {
    fs.readFile(config.filePath, (err, data) => {
      if (err) {
        clientRes.writeHead(404);
        clientRes.end('Mapped file not found');
        return;
      }

      // Detect content type from config or file extension
      let contentType = config.contentType || 'application/json';
      if (!config.contentType) {
        const ext = path.extname(config.filePath).toLowerCase();
        if (ext === '.html') contentType = 'text/html';
        else if (ext === '.xml') contentType = 'application/xml';
        else if (ext === '.txt') contentType = 'text/plain';
        else if (ext === '.css') contentType = 'text/css';
        else if (ext === '.js') contentType = 'application/javascript';
      }

      const responseData = {
        id: requestData.id,
        status: 200,
        statusText: 'OK (Mapped)',
        headers: { 'content-type': contentType },
        body: data,
        timestamp: new Date().toISOString(),
        mapped: true
      };

      this.broadcast({
        type: 'traffic',
        request: requestData,
        response: responseData
      });

      clientRes.writeHead(200, { 'content-type': contentType });
      clientRes.end(data);
    });
  }

  continueRequest(requestId, customRequest) {
    const queued = this.requestQueue.get(requestId);
    if (!queued) {
      console.warn(`Request ${requestId} not found in queue`);
      return;
    }

    // Clear timeout if it exists
    if (queued.timeoutId) {
      clearTimeout(queued.timeoutId);
    }

    this.requestQueue.delete(requestId);
    const { requestData, clientRes } = queued;

    if (customRequest) {
      if (customRequest.body !== undefined) requestData.body = customRequest.body;
      if (customRequest.headers) Object.assign(requestData.headers, customRequest.headers);
      if (customRequest.method) requestData.method = customRequest.method;
      if (customRequest.url) requestData.url = customRequest.url;
    }

    try {
      this.forwardRequestWithResponseBreakpoint(requestData, clientRes);
    } catch (error) {
      console.error(`Error forwarding request ${requestId}:`, error);
      if (!clientRes.headersSent) {
        clientRes.writeHead(500);
        clientRes.end('Internal Server Error: ' + error.message);
      }
    }
  }

  forwardRequestWithResponseBreakpoint(requestData, clientRes) {
    const parsedUrl = new URL(requestData.url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: requestData.method,
      headers: requestData.headers
    };

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const proxyReq = protocol.request(options, (proxyRes) => {
      this.collectBody(proxyRes).then(body => {
        const responseData = {
          id: requestData.id,
          status: proxyRes.statusCode,
          statusText: proxyRes.statusMessage,
          headers: { ...proxyRes.headers },
          body: body,
          timestamp: new Date().toISOString()
        };

        // Check if there are WebSocket clients connected for phase 2
        const hasClients = Array.from(this.webSocketClients).some(ws => ws.readyState === 1);

        if (!hasClients) {
          // No clients connected, auto-send response
          this.broadcast({ type: 'traffic', request: requestData, response: responseData });
          clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
          clientRes.end(body);
          return;
        }

        // Re-queue with response data for phase 2
        const timeoutId = setTimeout(() => {
          console.log(`Response breakpoint timeout for request ${requestData.id}, auto-continuing`);
          this.continueResponse(requestData.id);
        }, this.breakpointTimeout);

        this.requestQueue.set(requestData.id, {
          requestData,
          clientRes,
          responseData,
          phase: 'response',
          timeoutId,
          timestamp: Date.now()
        });

        this.broadcast({
          type: 'breakpointResponse',
          requestId: requestData.id,
          request: requestData,
          response: responseData
        });
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
        clientRes.end('Bad Gateway');
      }
    });

    if (requestData.body) {
      proxyReq.write(requestData.body);
    }
    proxyReq.end();
  }

  continueResponse(requestId, customResponse) {
    const queued = this.requestQueue.get(requestId);
    if (!queued || queued.phase !== 'response') {
      console.warn(`Response for request ${requestId} not found in queue`);
      return;
    }

    if (queued.timeoutId) {
      clearTimeout(queued.timeoutId);
    }

    this.requestQueue.delete(requestId);

    const { requestData, clientRes } = queued;
    let responseData = queued.responseData;

    // Apply custom edits if provided
    if (customResponse) {
      if (customResponse.body !== undefined) responseData.body = customResponse.body;
      if (customResponse.status !== undefined) responseData.status = customResponse.status;
      if (customResponse.headers) Object.assign(responseData.headers, customResponse.headers);
    }

    this.broadcast({ type: 'traffic', request: requestData, response: responseData });

    if (!clientRes.headersSent) {
      // Remove content-encoding and content-length since we may have modified the body
      const headers = { ...responseData.headers };
      if (customResponse?.body !== undefined) {
        delete headers['content-encoding'];
        delete headers['content-length'];
      }
      clientRes.writeHead(responseData.status, headers);
      clientRes.end(responseData.body);
    }
  }

  respondWithCustom(requestId, customResponse) {
    const queued = this.requestQueue.get(requestId);
    if (!queued) {
      console.warn(`Request ${requestId} not found in queue`);
      return;
    }

    // Clear timeout if it exists
    if (queued.timeoutId) {
      clearTimeout(queued.timeoutId);
    }

    this.requestQueue.delete(requestId);
    const { requestData, clientRes } = queued;

    const responseData = {
      id: requestId,
      status: customResponse.status || 200,
      statusText: customResponse.statusText || 'OK',
      headers: customResponse.headers || {},
      body: customResponse.body,
      timestamp: new Date().toISOString(),
      custom: true
    };

    this.broadcast({
      type: 'traffic',
      request: requestData,
      response: responseData
    });

    clientRes.writeHead(responseData.status, responseData.headers);
    clientRes.end(responseData.body);
  }

  cleanupRequest(requestId, error) {
    const queued = this.requestQueue.get(requestId);
    if (!queued) return;

    if (queued.timeoutId) {
      clearTimeout(queued.timeoutId);
    }

    this.requestQueue.delete(requestId);
    const { clientRes } = queued;

    if (!clientRes.headersSent) {
      clientRes.writeHead(500);
      clientRes.end('Internal Server Error: ' + error.message);
    }
  }

  loadBreakpointsFromFile() {
    try {
      if (fs.existsSync(this.breakpointsFilePath)) {
        const data = fs.readFileSync(this.breakpointsFilePath, 'utf8');
        const breakpointsArray = JSON.parse(data);

        for (const breakpoint of breakpointsArray) {
          if (!breakpoint.pattern) continue;

          // Apply defaults
          const config = {
            pattern: breakpoint.pattern,
            name: breakpoint.name || undefined,
            enabled: breakpoint.enabled !== false,
            createdAt: breakpoint.createdAt || new Date().toISOString(),
            lastModified: breakpoint.lastModified || new Date().toISOString()
          };

          this.breakpoints.set(breakpoint.pattern, config);
        }

        console.log(`Loaded ${this.breakpoints.size} breakpoints from file`);
      }
    } catch (error) {
      console.error('Error loading breakpoints from file:', error.message);
      // Continue with empty state
    }
  }

  saveBreakpointsToFile() {
    try {
      const breakpointsArray = Array.from(this.breakpoints.values());
      const data = JSON.stringify(breakpointsArray, null, 2);
      fs.writeFileSync(this.breakpointsFilePath, data, 'utf8');
    } catch (error) {
      console.error('Error saving breakpoints to file:', error.message);
    }
  }

  setBreakpoint(pattern, config = {}) {
    const existing = this.breakpoints.get(pattern);
    const now = new Date().toISOString();

    const breakpointConfig = {
      pattern,
      name: config.name !== undefined ? config.name : (existing?.name || undefined),
      enabled: config.enabled !== undefined ? config.enabled : (existing?.enabled !== false),
      createdAt: existing?.createdAt || now,
      lastModified: now
    };

    this.breakpoints.set(pattern, breakpointConfig);
    this.saveBreakpointsToFile();

    return breakpointConfig;
  }

  removeBreakpoint(pattern) {
    this.breakpoints.delete(pattern);
    this.saveBreakpointsToFile();
  }

  toggleBreakpoint(pattern, enabled) {
    const existing = this.breakpoints.get(pattern);
    if (!existing) return null;

    existing.enabled = enabled;
    existing.lastModified = new Date().toISOString();

    this.breakpoints.set(pattern, existing);
    this.saveBreakpointsToFile();

    return existing;
  }

  updateBreakpoint(oldPattern, newConfig) {
    const existing = this.breakpoints.get(oldPattern);
    if (!existing) return null;

    const now = new Date().toISOString();
    const newPattern = newConfig.pattern || oldPattern;

    const updatedConfig = {
      pattern: newPattern,
      name: newConfig.name !== undefined ? newConfig.name : existing.name,
      enabled: newConfig.enabled !== undefined ? newConfig.enabled : existing.enabled,
      createdAt: existing.createdAt,
      lastModified: now
    };

    // If pattern changed, remove old pattern and add new one
    if (newPattern !== oldPattern) {
      this.breakpoints.delete(oldPattern);
    }

    this.breakpoints.set(newPattern, updatedConfig);
    this.saveBreakpointsToFile();

    return { oldPattern, newPattern, config: updatedConfig };
  }

  getBreakpoints() {
    return Array.from(this.breakpoints.values());
  }

  shouldSslProxy(hostname) {
    // If the SSL proxying list is empty, intercept everything (backwards compatible)
    if (this.sslProxyingList.size === 0) return true;

    for (const [, config] of this.sslProxyingList) {
      if (config.enabled === false) continue;
      if (config.kind === 'domain') {
        if (hostname === config.pattern) return true;
      } else {
        if (this.matchPattern(hostname, config.pattern)) return true;
      }
    }
    return false;
  }

  loadSslProxyingFromFile() {
    try {
      if (fs.existsSync(this.sslProxyingFilePath)) {
        const data = fs.readFileSync(this.sslProxyingFilePath, 'utf8');
        const list = JSON.parse(data);

        for (const entry of list) {
          if (!entry.pattern) continue;
          this.sslProxyingList.set(entry.pattern, {
            pattern: entry.pattern,
            name: entry.name || undefined,
            enabled: entry.enabled !== false,
            kind: entry.kind || 'wildcard',
            createdAt: entry.createdAt || new Date().toISOString()
          });
        }

        console.log(`Loaded ${this.sslProxyingList.size} SSL proxying patterns from file`);
      }
    } catch (error) {
      console.error('Error loading SSL proxying list from file:', error.message);
    }
  }

  saveSslProxyingToFile() {
    try {
      const list = Array.from(this.sslProxyingList.values());
      const data = JSON.stringify(list, null, 2);
      fs.writeFileSync(this.sslProxyingFilePath, data, 'utf8');
    } catch (error) {
      console.error('Error saving SSL proxying list to file:', error.message);
    }
  }

  setSslProxy(pattern, options = {}) {
    const existing = this.sslProxyingList.get(pattern);
    const now = new Date().toISOString();
    const config = {
      pattern,
      name: options.name !== undefined ? options.name : (existing?.name || undefined),
      enabled: options.enabled !== undefined ? options.enabled : (existing?.enabled !== false),
      kind: options.kind || existing?.kind || 'wildcard',
      createdAt: existing?.createdAt || now
    };
    this.sslProxyingList.set(pattern, config);
    this.saveSslProxyingToFile();
    return config;
  }

  toggleSslProxy(pattern, enabled) {
    const existing = this.sslProxyingList.get(pattern);
    if (!existing) return null;

    existing.enabled = enabled;
    this.sslProxyingList.set(pattern, existing);
    this.saveSslProxyingToFile();
    return existing;
  }


  removeSslProxy(pattern) {
    this.sslProxyingList.delete(pattern);
    this.saveSslProxyingToFile();
  }

  getSslProxyingList() {
    return Array.from(this.sslProxyingList.values());
  }

  loadMappingsFromFile() {
    try {
      if (fs.existsSync(this.mappingsFilePath)) {
        const data = fs.readFileSync(this.mappingsFilePath, 'utf8');
        const mappingsArray = JSON.parse(data);

        for (const mapping of mappingsArray) {
          if (!mapping.pattern || !mapping.filePath) continue;

          const config = {
            pattern: mapping.pattern,
            filePath: mapping.filePath,
            contentType: mapping.contentType || undefined,
            enabled: mapping.enabled !== false,
            createdAt: mapping.createdAt || new Date().toISOString()
          };

          this.mappings.set(mapping.pattern, config);
        }

        console.log(`Loaded ${this.mappings.size} mappings from file`);
      }
    } catch (error) {
      console.error('Error loading mappings from file:', error.message);
    }
  }

  saveMappingsToFile() {
    try {
      const mappingsArray = Array.from(this.mappings.values());
      const data = JSON.stringify(mappingsArray, null, 2);
      fs.writeFileSync(this.mappingsFilePath, data, 'utf8');
    } catch (error) {
      console.error('Error saving mappings to file:', error.message);
    }
  }

  setMapping(pattern, filePath, options = {}) {
    const existing = this.mappings.get(pattern);
    const config = {
      pattern,
      filePath,
      contentType: options.contentType || existing?.contentType || undefined,
      enabled: options.enabled !== undefined ? options.enabled : (existing?.enabled !== false),
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    this.mappings.set(pattern, config);
    this.saveMappingsToFile();
    return config;
  }

  removeMapping(pattern) {
    this.mappings.delete(pattern);
    this.saveMappingsToFile();
  }

  toggleMapping(pattern, enabled) {
    const existing = this.mappings.get(pattern);
    if (!existing) return null;

    existing.enabled = enabled;
    this.mappings.set(pattern, existing);
    this.saveMappingsToFile();
    return existing;
  }

  getMappings() {
    return Array.from(this.mappings.values());
  }

  createMappingFromResponse(pattern, body, contentType) {
    if (!fs.existsSync(this.mappedResponsesDir)) {
      fs.mkdirSync(this.mappedResponsesDir, { recursive: true });
    }

    const sanitized = pattern.replace(/[^a-zA-Z0-9.-]/g, '-').slice(0, 80);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = (contentType && contentType.includes('json')) ? 'json' : 'txt';
    const filename = `${sanitized}-${timestamp}.${ext}`;
    const filePath = path.join(this.mappedResponsesDir, filename);

    fs.writeFileSync(filePath, body);

    const config = this.setMapping(pattern, filePath, { contentType });
    return config;
  }
}

module.exports = ProxyServer;
