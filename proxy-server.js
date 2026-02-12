const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
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
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8')
    };
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
    { name: 'commonName', value: 'Network Interceptor CA' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'Network Interceptor' }
  ];
  
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true }
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
    { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }
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
    this.requestQueue = new Map(); // Request ID -> request data
    this.requestIdCounter = 0;
    this.breakpointTimeout = 120000; // 120 seconds (2 minutes)
    this.breakpointsFilePath = options.breakpointsFilePath || path.join(__dirname, 'breakpoints.json');

    const ca = generateCACertificate();
    this.caCert = ca.cert;
    this.caKey = ca.key;

    this.loadBreakpointsFromFile();
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

    this.server.listen(this.port, () => {
      console.log(`Proxy server running on port ${this.port}`);
    });
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

    const message = JSON.stringify(broadcastData);
    this.webSocketClients.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(message);
      }
    });
  }

  async handleHttpRequest(clientReq, clientRes) {
    const requestId = ++this.requestIdCounter;
    const requestUrl = clientReq.url;
    const fullUrl = `http://${clientReq.headers.host}${requestUrl}`;
    
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
    const parsedUrl = url.parse(requestData.url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.path,
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

    // Generate certificate for this hostname
    const { cert, key } = generateCertificate(hostname, this.caCert, this.caKey);

    // Create HTTPS server for this connection
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

  checkBreakpoint(url) {
    for (const [pattern, config] of this.breakpoints) {
      if (this.matchPattern(url, pattern) && config.enabled !== false) {
        return config;
      }
    }
    return null;
  }

  checkMapping(url) {
    for (const [pattern, filePath] of this.mappings) {
      if (this.matchPattern(url, pattern)) {
        return filePath;
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

  sendMappedResponse(clientRes, filePath, requestData) {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        clientRes.writeHead(404);
        clientRes.end('Mapped file not found');
        return;
      }

      const responseData = {
        id: requestData.id,
        status: 200,
        statusText: 'OK (Mapped)',
        headers: { 'content-type': 'application/json' },
        body: data,
        timestamp: new Date().toISOString(),
        mapped: true
      };

      this.broadcast({
        type: 'traffic',
        request: requestData,
        response: responseData
      });

      clientRes.writeHead(200, { 'content-type': 'application/json' });
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
      Object.assign(requestData, customRequest);
    }

    try {
      this.forwardRequest(requestData, clientRes);
    } catch (error) {
      console.error(`Error forwarding request ${requestId}:`, error);
      if (!clientRes.headersSent) {
        clientRes.writeHead(500);
        clientRes.end('Internal Server Error: ' + error.message);
      }
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

  setMapping(pattern, filePath) {
    this.mappings.set(pattern, filePath);
  }

  removeMapping(pattern) {
    this.mappings.delete(pattern);
  }
}

module.exports = ProxyServer;
