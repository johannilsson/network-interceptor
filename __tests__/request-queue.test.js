const ProxyServer = require('../proxy-server');

// Mock setTimeout and clearTimeout
jest.useFakeTimers();

describe('Request Queue Management', () => {
  let proxyServer;
  let mockClientRes;

  beforeEach(() => {
    proxyServer = new ProxyServer();
    mockClientRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      headersSent: false
    };
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Adding requests to queue', () => {
    test('should add request to queue with timeout', () => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: {},
        timestamp: new Date().toISOString(),
        protocol: 'https'
      };

      const timeoutId = setTimeout(() => {}, 1000);
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        breakpoint: {},
        timeoutId,
        timestamp: Date.now()
      });

      expect(proxyServer.requestQueue.has(1)).toBe(true);
      expect(proxyServer.requestQueue.get(1).requestData).toEqual(requestData);
      expect(proxyServer.requestQueue.get(1).timeoutId).toBeDefined();
    });

    test('should track multiple requests in queue', () => {
      const requestData1 = { id: 1, url: 'https://example.com/1' };
      const requestData2 = { id: 2, url: 'https://example.com/2' };

      proxyServer.requestQueue.set(1, { requestData: requestData1, clientRes: mockClientRes });
      proxyServer.requestQueue.set(2, { requestData: requestData2, clientRes: mockClientRes });

      expect(proxyServer.requestQueue.size).toBe(2);
      expect(proxyServer.requestQueue.has(1)).toBe(true);
      expect(proxyServer.requestQueue.has(2)).toBe(true);
    });
  });

  describe('Continue request', () => {
    test('should remove request from queue when continued', () => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: {},
        body: null
      };

      const timeoutId = setTimeout(() => {}, 1000);
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      // Mock forwardRequest to prevent actual network call
      proxyServer.forwardRequest = jest.fn();

      proxyServer.continueRequest(1);

      expect(proxyServer.requestQueue.has(1)).toBe(false);
      expect(proxyServer.forwardRequest).toHaveBeenCalledWith(requestData, mockClientRes);
    });

    test('should clear timeout when continuing request', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      const timeoutId = setTimeout(() => {}, 1000);

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      proxyServer.forwardRequest = jest.fn();
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      proxyServer.continueRequest(1);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
    });

    test('should handle non-existent request gracefully', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      proxyServer.continueRequest(999);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Request 999 not found in queue');
      consoleWarnSpy.mockRestore();
    });

    test('should apply custom request modifications when continuing', () => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { 'User-Agent': 'Original' }
      };

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.forwardRequest = jest.fn();

      const customRequest = {
        headers: { 'User-Agent': 'Modified', 'X-Custom': 'Header' }
      };

      proxyServer.continueRequest(1, customRequest);

      expect(proxyServer.forwardRequest).toHaveBeenCalled();
      const forwardedRequest = proxyServer.forwardRequest.mock.calls[0][0];
      expect(forwardedRequest.headers).toEqual({ 'User-Agent': 'Modified', 'X-Custom': 'Header' });
    });

    test('should handle errors when forwarding request', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      const error = new Error('Network error');
      proxyServer.forwardRequest = jest.fn(() => {
        throw error;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      proxyServer.continueRequest(1);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error forwarding request 1:', error);
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(500);
      expect(mockClientRes.end).toHaveBeenCalledWith('Internal Server Error: Network error');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Custom response', () => {
    test('should remove request from queue when responding with custom response', () => {
      const requestData = {
        id: 1,
        method: 'GET',
        url: 'https://api.example.com/users'
      };

      const timeoutId = setTimeout(() => {}, 1000);
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      proxyServer.broadcast = jest.fn();

      const customResponse = {
        status: 200,
        body: JSON.stringify({ data: 'custom' })
      };

      proxyServer.respondWithCustom(1, customResponse);

      expect(proxyServer.requestQueue.has(1)).toBe(false);
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, {});
      expect(mockClientRes.end).toHaveBeenCalledWith(customResponse.body);
    });

    test('should clear timeout when responding with custom response', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      const timeoutId = setTimeout(() => {}, 1000);

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      proxyServer.broadcast = jest.fn();
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      proxyServer.respondWithCustom(1, { status: 200, body: 'OK' });

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
    });

    test('should handle non-existent request gracefully', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      proxyServer.respondWithCustom(999, { status: 200, body: 'OK' });

      expect(consoleWarnSpy).toHaveBeenCalledWith('Request 999 not found in queue');
      consoleWarnSpy.mockRestore();
    });

    test('should broadcast custom response', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      proxyServer.broadcast = jest.fn();

      const customResponse = {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Not found' })
      };

      proxyServer.respondWithCustom(1, customResponse);

      expect(proxyServer.broadcast).toHaveBeenCalledWith({
        type: 'traffic',
        request: requestData,
        response: expect.objectContaining({
          id: 1,
          status: 404,
          statusText: 'Not Found',
          custom: true
        })
      });
    });
  });

  describe('Timeout behavior', () => {
    test('should auto-continue request after timeout', () => {
      const requestData = { id: 1, url: 'https://example.com' };

      proxyServer.forwardRequest = jest.fn();
      proxyServer.continueRequest = jest.fn();

      // Manually simulate what would happen with a timeout
      const timeoutCallback = () => {
        console.log('Breakpoint timeout for request 1, auto-continuing');
        proxyServer.continueRequest(1);
      };

      const timeoutId = setTimeout(timeoutCallback, 120000);
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      // Fast-forward time by 120 seconds
      jest.advanceTimersByTime(120000);

      expect(proxyServer.continueRequest).toHaveBeenCalledWith(1);
    });

    test('should not auto-continue if manually continued before timeout', () => {
      const requestData = { id: 1, url: 'https://example.com' };

      proxyServer.forwardRequest = jest.fn();

      const timeoutCallback = jest.fn(() => {
        proxyServer.continueRequest(1);
      });

      const timeoutId = setTimeout(timeoutCallback, 120000);
      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      // Manually continue before timeout
      proxyServer.continueRequest(1);

      // Fast-forward time
      jest.advanceTimersByTime(120000);

      // continueRequest should have been called only once (manual), not twice
      expect(proxyServer.forwardRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup request', () => {
    test('should clean up request and send error response', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      const timeoutId = setTimeout(() => {}, 1000);

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      const error = new Error('Test error');
      proxyServer.cleanupRequest(1, error);

      expect(proxyServer.requestQueue.has(1)).toBe(false);
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(500);
      expect(mockClientRes.end).toHaveBeenCalledWith('Internal Server Error: Test error');
    });

    test('should clear timeout when cleaning up request', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      const timeoutId = setTimeout(() => {}, 1000);

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes,
        timeoutId
      });

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      const error = new Error('Test error');

      proxyServer.cleanupRequest(1, error);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
    });

    test('should not send response if headers already sent', () => {
      const requestData = { id: 1, url: 'https://example.com' };
      mockClientRes.headersSent = true;

      proxyServer.requestQueue.set(1, {
        requestData,
        clientRes: mockClientRes
      });

      const error = new Error('Test error');
      proxyServer.cleanupRequest(1, error);

      expect(mockClientRes.writeHead).not.toHaveBeenCalled();
      expect(mockClientRes.end).not.toHaveBeenCalled();
    });

    test('should handle cleanup of non-existent request gracefully', () => {
      const error = new Error('Test error');
      expect(() => proxyServer.cleanupRequest(999, error)).not.toThrow();
    });
  });
});
