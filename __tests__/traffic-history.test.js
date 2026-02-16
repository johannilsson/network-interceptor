const path = require('path');
const fs = require('fs');
const os = require('os');
const ProxyServer = require('../proxy-server');

const tmpBreakpointsFile = path.join(os.tmpdir(), `breakpoints-test-history-${process.pid}.json`);

afterAll(() => { try { fs.unlinkSync(tmpBreakpointsFile); } catch {} });

describe('Traffic History', () => {
  let proxyServer;

  beforeEach(() => {
    try { fs.unlinkSync(tmpBreakpointsFile); } catch {}
    proxyServer = new ProxyServer(8888, { breakpointsFilePath: tmpBreakpointsFile });
  });

  describe('buffer storage', () => {
    test('should initialize with empty history', () => {
      expect(proxyServer.trafficHistory).toEqual([]);
      expect(proxyServer.getTrafficHistory()).toEqual([]);
    });

    test('should store traffic entries in history when broadcast', () => {
      proxyServer.broadcast({
        type: 'traffic',
        request: { id: 1, method: 'GET', url: 'http://example.com', headers: {} },
        response: { id: 1, status: 200, headers: {} }
      });

      expect(proxyServer.trafficHistory).toHaveLength(1);
      expect(proxyServer.trafficHistory[0].type).toBe('traffic');
      expect(proxyServer.trafficHistory[0].request.url).toBe('http://example.com');
    });

    test('should not store non-traffic entries (breakpoints)', () => {
      proxyServer.broadcast({
        type: 'breakpoint',
        request: { id: 1, method: 'GET', url: 'http://example.com', headers: {} }
      });

      expect(proxyServer.trafficHistory).toHaveLength(0);
    });

    test('should not store breakpointResponse entries', () => {
      proxyServer.broadcast({
        type: 'breakpointResponse',
        requestId: 1,
        request: { id: 1, method: 'GET', url: 'http://example.com', headers: {} },
        response: { id: 1, status: 200, headers: {} }
      });

      expect(proxyServer.trafficHistory).toHaveLength(0);
    });

    test('should store multiple traffic entries in order', () => {
      for (let i = 1; i <= 5; i++) {
        proxyServer.broadcast({
          type: 'traffic',
          request: { id: i, method: 'GET', url: `http://example.com/${i}`, headers: {} },
          response: { id: i, status: 200, headers: {} }
        });
      }

      expect(proxyServer.trafficHistory).toHaveLength(5);
      expect(proxyServer.trafficHistory[0].request.id).toBe(1);
      expect(proxyServer.trafficHistory[4].request.id).toBe(5);
    });
  });

  describe('ring buffer eviction', () => {
    test('should evict oldest entries when exceeding maxTrafficHistory', () => {
      proxyServer.maxTrafficHistory = 3;

      for (let i = 1; i <= 5; i++) {
        proxyServer.broadcast({
          type: 'traffic',
          request: { id: i, method: 'GET', url: `http://example.com/${i}`, headers: {} },
          response: { id: i, status: 200, headers: {} }
        });
      }

      expect(proxyServer.trafficHistory).toHaveLength(3);
      // Oldest entries (1, 2) should be evicted
      expect(proxyServer.trafficHistory[0].request.id).toBe(3);
      expect(proxyServer.trafficHistory[1].request.id).toBe(4);
      expect(proxyServer.trafficHistory[2].request.id).toBe(5);
    });

    test('should maintain exactly maxTrafficHistory entries at cap', () => {
      proxyServer.maxTrafficHistory = 1000;

      for (let i = 1; i <= 1005; i++) {
        proxyServer.broadcast({
          type: 'traffic',
          request: { id: i, method: 'GET', url: `http://example.com/${i}`, headers: {} },
          response: { id: i, status: 200, headers: {} }
        });
      }

      expect(proxyServer.trafficHistory).toHaveLength(1000);
      expect(proxyServer.trafficHistory[0].request.id).toBe(6);
      expect(proxyServer.trafficHistory[999].request.id).toBe(1005);
    });
  });

  describe('getTrafficHistory', () => {
    test('should return the same array reference', () => {
      const history = proxyServer.getTrafficHistory();
      proxyServer.broadcast({
        type: 'traffic',
        request: { id: 1, method: 'GET', url: 'http://example.com', headers: {} },
        response: { id: 1, status: 200, headers: {} }
      });

      // Same reference, so it reflects new entries
      expect(history).toHaveLength(1);
    });
  });

  describe('broadcast still sends to WebSocket clients', () => {
    test('should send to connected WS clients and store in history', () => {
      const sentMessages = [];
      const mockWs = {
        readyState: 1,
        send: jest.fn((msg) => sentMessages.push(msg)),
        on: jest.fn()
      };
      proxyServer.addWebSocketClient(mockWs);

      proxyServer.broadcast({
        type: 'traffic',
        request: { id: 1, method: 'GET', url: 'http://example.com', headers: {} },
        response: { id: 1, status: 200, headers: {} }
      });

      // Should both store and send
      expect(proxyServer.trafficHistory).toHaveLength(1);
      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.type).toBe('traffic');
    });
  });
});
