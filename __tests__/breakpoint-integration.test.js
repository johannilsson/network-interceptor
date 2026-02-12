const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ProxyServer = require('../proxy-server');

// Mock WebSocket for testing
class MockWebSocket {
  constructor() {
    this.readyState = 1; // OPEN
    this.messages = [];
    this.eventHandlers = {};
  }

  send(message) {
    this.messages.push(JSON.parse(message));
  }

  on(event, handler) {
    this.eventHandlers[event] = handler;
  }

  emit(event, ...args) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event](...args);
    }
  }
}

describe('Breakpoint Integration Tests', () => {
  let proxyServer;
  let mockTargetServer;
  let mockHttpsServer;
  const targetPort = 9999;
  let tmpBreakpointsFile;

  beforeAll((done) => {
    tmpBreakpointsFile = path.join(os.tmpdir(), `breakpoints-test-integration-${process.pid}.json`);

    // Create a mock target server for testing
    mockTargetServer = http.createServer((req, res) => {
      if (req.url === '/users') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: 'users' }));
      } else if (req.url === '/posts') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: 'posts' }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    mockTargetServer.listen(targetPort, done);
  });

  afterAll((done) => {
    try { fs.unlinkSync(tmpBreakpointsFile); } catch {}
    mockTargetServer.close(done);
  });

  beforeEach(() => {
    // Remove temp file so each test starts clean
    try { fs.unlinkSync(tmpBreakpointsFile); } catch {}
    proxyServer = new ProxyServer(8888, { breakpointsFilePath: tmpBreakpointsFile });
  });

  describe('Breakpoint pattern matching', () => {
    test('should intercept request matching wildcard pattern', (done) => {
      const mockWs = new MockWebSocket();
      proxyServer.addWebSocketClient(mockWs);

      // Set breakpoint with wildcard pattern
      proxyServer.setBreakpoint('*localhost:9999/users*', {});

      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/users`,
        headers: { host: `localhost:${targetPort}` },
        body: null
      };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
        headersSent: false
      };

      // Simulate request
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        breakpoint: {},
        timeoutId: setTimeout(() => {}, 1000)
      });

      proxyServer.broadcast({
        type: 'breakpoint',
        request: requestData
      });

      // Verify breakpoint was triggered
      setTimeout(() => {
        expect(mockWs.messages).toHaveLength(1);
        expect(mockWs.messages[0].type).toBe('breakpoint');
        expect(mockWs.messages[0].request.url).toBe(`http://localhost:${targetPort}/users`);
        done();
      }, 100);
    });

    test('should not intercept request not matching pattern', async () => {
      const mockWs = new MockWebSocket();
      proxyServer.addWebSocketClient(mockWs);

      // Set breakpoint for /users only
      proxyServer.setBreakpoint('*/users*', {});

      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/posts`,
        headers: { host: `localhost:${targetPort}` },
        body: null
      };

      // Check if breakpoint matches
      const breakpoint = proxyServer.checkBreakpoint(requestData.url);

      expect(breakpoint).toBeNull();
    });

    test('should match request with leading wildcard pattern', () => {
      proxyServer.setBreakpoint('*localhost*', {});

      const url = `http://localhost:${targetPort}/users`;
      const breakpoint = proxyServer.checkBreakpoint(url);

      expect(breakpoint).not.toBeNull();
    });

    test('should match request with trailing wildcard pattern', () => {
      proxyServer.setBreakpoint('http://localhost:9999*', {});

      const url = `http://localhost:${targetPort}/users`;
      const breakpoint = proxyServer.checkBreakpoint(url);

      expect(breakpoint).not.toBeNull();
    });
  });

  describe('Continue with original request', () => {
    test('should forward original request when continued', (done) => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/users`,
        headers: { host: `localhost:${targetPort}` },
        body: null
      };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn((data) => {
          const response = JSON.parse(data);
          expect(response.data).toBe('users');
          expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
          done();
        }),
        headersSent: false
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.continueRequest(1);
    });

    test('should forward modified request when continued with custom request', (done) => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/users`,
        headers: { host: `localhost:${targetPort}` },
        body: null
      };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn((data) => {
          // Should receive posts data instead of users
          const response = JSON.parse(data);
          expect(response.data).toBe('posts');
          done();
        }),
        headersSent: false
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      // Continue with modified URL
      proxyServer.continueRequest(1, {
        url: `http://localhost:${targetPort}/posts`
      });
    });
  });

  describe('Custom response', () => {
    test('should respond with custom response instead of forwarding', (done) => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/users`,
        headers: { host: `localhost:${targetPort}` }
      };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn((data) => {
          expect(data).toBe('Custom response');
          expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/plain' });
          done();
        }),
        headersSent: false
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.broadcast = jest.fn();

      proxyServer.respondWithCustom(1, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Custom response'
      });
    });

    test('should respond with custom JSON response', (done) => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/users`
      };

      const customData = { custom: true, message: 'Mocked data' };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn((data) => {
          const response = JSON.parse(data);
          expect(response).toEqual(customData);
          done();
        }),
        headersSent: false
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.broadcast = jest.fn();

      proxyServer.respondWithCustom(1, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customData)
      });
    });

    test('should respond with custom error status', (done) => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: `http://localhost:${targetPort}/users`
      };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn((data) => {
          expect(mockClientRes.writeHead).toHaveBeenCalledWith(404, {});
          expect(data).toBe('Not found');
          done();
        }),
        headersSent: false
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.broadcast = jest.fn();

      proxyServer.respondWithCustom(1, {
        status: 404,
        body: 'Not found'
      });
    });
  });

  describe('Multiple breakpoints', () => {
    test('should handle multiple breakpoint patterns', () => {
      proxyServer.setBreakpoint('*/users*', { name: 'users-breakpoint' });
      proxyServer.setBreakpoint('*/posts*', { name: 'posts-breakpoint' });

      const usersUrl = `http://localhost:${targetPort}/users`;
      const postsUrl = `http://localhost:${targetPort}/posts`;

      const usersBreakpoint = proxyServer.checkBreakpoint(usersUrl);
      const postsBreakpoint = proxyServer.checkBreakpoint(postsUrl);

      expect(usersBreakpoint).not.toBeNull();
      expect(usersBreakpoint.name).toBe('users-breakpoint');
      expect(postsBreakpoint).not.toBeNull();
      expect(postsBreakpoint.name).toBe('posts-breakpoint');
    });

    test('should match first breakpoint pattern when multiple patterns match', () => {
      proxyServer.setBreakpoint('*localhost*', { name: 'broad-breakpoint' });
      proxyServer.setBreakpoint('*/users*', { name: 'specific-breakpoint' });

      const url = `http://localhost:${targetPort}/users`;
      const breakpoint = proxyServer.checkBreakpoint(url);

      // Should match the first one added
      expect(breakpoint.name).toBe('broad-breakpoint');
    });

    test('should remove breakpoint correctly', () => {
      proxyServer.setBreakpoint('*/users*', { name: 'users-breakpoint' });

      let breakpoint = proxyServer.checkBreakpoint(`http://localhost:${targetPort}/users`);
      expect(breakpoint).not.toBeNull();

      proxyServer.removeBreakpoint('*/users*');

      breakpoint = proxyServer.checkBreakpoint(`http://localhost:${targetPort}/users`);
      expect(breakpoint).toBeNull();
    });
  });

  describe('WebSocket availability', () => {
    test('should auto-continue when no WebSocket clients connected', () => {
      // No WebSocket clients added
      const hasClients = Array.from(proxyServer.webSocketClients).some(ws => ws.readyState === 1);
      expect(hasClients).toBe(false);
    });

    test('should queue request when WebSocket client is connected', () => {
      const mockWs = new MockWebSocket();
      proxyServer.addWebSocketClient(mockWs);

      const hasClients = Array.from(proxyServer.webSocketClients).some(ws => ws.readyState === 1);
      expect(hasClients).toBe(true);
    });

    test('should not count closed WebSocket connections', () => {
      const mockWs = new MockWebSocket();
      mockWs.readyState = 3; // CLOSED
      proxyServer.addWebSocketClient(mockWs);

      const hasClients = Array.from(proxyServer.webSocketClients).some(ws => ws.readyState === 1);
      expect(hasClients).toBe(false);
    });
  });

  describe('POST requests with body', () => {
    test('should preserve POST body when continuing request', (done) => {
      const postData = JSON.stringify({ name: 'test', value: 123 });

      const requestData = {
        id: 1,
        method: 'POST',
        url: `http://localhost:${targetPort}/users`,
        headers: {
          host: `localhost:${targetPort}`,
          'content-type': 'application/json',
          'content-length': postData.length.toString()
        },
        body: Buffer.from(postData)
      };

      const mockClientRes = {
        writeHead: jest.fn(),
        end: jest.fn(() => {
          // Verify the request was sent with body
          expect(requestData.body.toString()).toBe(postData);
          done();
        }),
        headersSent: false
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.continueRequest(1);
    });
  });
});
