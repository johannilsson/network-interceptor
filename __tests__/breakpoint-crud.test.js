const path = require('path');
const fs = require('fs');
const os = require('os');
const ProxyServer = require('../proxy-server');

const tmpDir = os.tmpdir();
const tmpBreakpointsFile = path.join(tmpDir, `breakpoints-crud-${process.pid}.json`);
const tmpSslFile = path.join(tmpDir, `ssl-crud-${process.pid}.json`);
const tmpMappingsFile = path.join(tmpDir, `mappings-crud-${process.pid}.json`);

function createServer() {
  return new ProxyServer(8888, {
    breakpointsFilePath: tmpBreakpointsFile,
    sslProxyingFilePath: tmpSslFile,
    mappingsFilePath: tmpMappingsFile
  });
}

afterAll(() => {
  for (const f of [tmpBreakpointsFile, tmpSslFile, tmpMappingsFile]) {
    try { fs.unlinkSync(f); } catch {}
  }
});

beforeEach(() => {
  for (const f of [tmpBreakpointsFile, tmpSslFile, tmpMappingsFile]) {
    try { fs.unlinkSync(f); } catch {}
  }
});

describe('Breakpoint CRUD', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  describe('setBreakpoint', () => {
    test('should create a new breakpoint with defaults', () => {
      const config = server.setBreakpoint('*api*');

      expect(config.pattern).toBe('*api*');
      expect(config.enabled).toBe(true);
      expect(config.createdAt).toBeDefined();
      expect(config.lastModified).toBeDefined();
    });

    test('should create a breakpoint with a name', () => {
      const config = server.setBreakpoint('*api*', { name: 'API calls' });

      expect(config.name).toBe('API calls');
    });

    test('should create a breakpoint as disabled', () => {
      const config = server.setBreakpoint('*api*', { enabled: false });

      expect(config.enabled).toBe(false);
    });

    test('should update existing breakpoint and preserve createdAt', () => {
      const first = server.setBreakpoint('*api*', { name: 'first' });
      const createdAt = first.createdAt;

      const second = server.setBreakpoint('*api*', { name: 'updated' });

      expect(second.name).toBe('updated');
      expect(second.createdAt).toBe(createdAt);
      expect(second.lastModified).toBeDefined();
    });

    test('should preserve existing name when not provided on update', () => {
      server.setBreakpoint('*api*', { name: 'My BP' });
      const updated = server.setBreakpoint('*api*', { enabled: false });

      expect(updated.name).toBe('My BP');
      expect(updated.enabled).toBe(false);
    });
  });

  describe('removeBreakpoint', () => {
    test('should remove an existing breakpoint', () => {
      server.setBreakpoint('*api*');
      expect(server.getBreakpoints()).toHaveLength(1);

      server.removeBreakpoint('*api*');
      expect(server.getBreakpoints()).toHaveLength(0);
    });

    test('should not throw when removing non-existent breakpoint', () => {
      expect(() => server.removeBreakpoint('*nonexistent*')).not.toThrow();
    });
  });

  describe('toggleBreakpoint', () => {
    test('should disable an enabled breakpoint', () => {
      server.setBreakpoint('*api*');
      const result = server.toggleBreakpoint('*api*', false);

      expect(result.enabled).toBe(false);
      expect(result.lastModified).toBeDefined();
    });

    test('should enable a disabled breakpoint', () => {
      server.setBreakpoint('*api*', { enabled: false });
      const result = server.toggleBreakpoint('*api*', true);

      expect(result.enabled).toBe(true);
    });

    test('should return null for non-existent breakpoint', () => {
      const result = server.toggleBreakpoint('*nonexistent*', true);
      expect(result).toBeNull();
    });

    test('disabled breakpoint should not match in checkBreakpoint', () => {
      server.setBreakpoint('*api*');
      server.toggleBreakpoint('*api*', false);

      const match = server.checkBreakpoint('https://api.example.com');
      expect(match).toBeNull();
    });
  });

  describe('updateBreakpoint', () => {
    test('should update breakpoint name', () => {
      server.setBreakpoint('*api*', { name: 'old' });
      const result = server.updateBreakpoint('*api*', { name: 'new' });

      expect(result.config.name).toBe('new');
      expect(result.oldPattern).toBe('*api*');
      expect(result.newPattern).toBe('*api*');
    });

    test('should update breakpoint pattern', () => {
      server.setBreakpoint('*api*', { name: 'API' });
      const result = server.updateBreakpoint('*api*', { pattern: '*api.v2*' });

      expect(result.oldPattern).toBe('*api*');
      expect(result.newPattern).toBe('*api.v2*');
      expect(result.config.name).toBe('API');

      // Old pattern should be removed
      expect(server.checkBreakpoint('https://api.example.com')).toBeNull();
      // New pattern should work
      expect(server.checkBreakpoint('https://api.v2.example.com')).not.toBeNull();
    });

    test('should preserve createdAt when updating', () => {
      const original = server.setBreakpoint('*api*');
      const result = server.updateBreakpoint('*api*', { name: 'updated' });

      expect(result.config.createdAt).toBe(original.createdAt);
    });

    test('should update lastModified', () => {
      const original = server.setBreakpoint('*api*');
      // Small delay to ensure different timestamps
      const result = server.updateBreakpoint('*api*', { name: 'updated' });

      expect(result.config.lastModified).toBeDefined();
    });

    test('should return null for non-existent breakpoint', () => {
      const result = server.updateBreakpoint('*nonexistent*', { name: 'new' });
      expect(result).toBeNull();
    });

    test('should update enabled state', () => {
      server.setBreakpoint('*api*');
      const result = server.updateBreakpoint('*api*', { enabled: false });

      expect(result.config.enabled).toBe(false);
    });
  });

  describe('getBreakpoints', () => {
    test('should return empty array when no breakpoints', () => {
      expect(server.getBreakpoints()).toEqual([]);
    });

    test('should return all breakpoints', () => {
      server.setBreakpoint('*api*', { name: 'API' });
      server.setBreakpoint('*users*', { name: 'Users' });

      const breakpoints = server.getBreakpoints();
      expect(breakpoints).toHaveLength(2);
      expect(breakpoints[0].pattern).toBe('*api*');
      expect(breakpoints[1].pattern).toBe('*users*');
    });
  });

  describe('checkBreakpoint', () => {
    test('should return config for matching enabled breakpoint', () => {
      server.setBreakpoint('*api*', { name: 'API' });
      const result = server.checkBreakpoint('https://api.example.com');

      expect(result).not.toBeNull();
      expect(result.name).toBe('API');
    });

    test('should return null when no breakpoints match', () => {
      server.setBreakpoint('*api*');
      const result = server.checkBreakpoint('https://example.com');

      expect(result).toBeNull();
    });

    test('should skip disabled breakpoints', () => {
      server.setBreakpoint('*api*', { enabled: false });
      const result = server.checkBreakpoint('https://api.example.com');

      expect(result).toBeNull();
    });

    test('should return first matching breakpoint', () => {
      server.setBreakpoint('*example*', { name: 'broad' });
      server.setBreakpoint('*api*', { name: 'specific' });

      const result = server.checkBreakpoint('https://api.example.com');
      expect(result.name).toBe('broad');
    });
  });

  describe('File persistence', () => {
    test('should save breakpoints to file', () => {
      server.setBreakpoint('*api*', { name: 'API' });

      expect(fs.existsSync(tmpBreakpointsFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(tmpBreakpointsFile, 'utf8'));
      expect(data).toHaveLength(1);
      expect(data[0].pattern).toBe('*api*');
      expect(data[0].name).toBe('API');
    });

    test('should load breakpoints from file on construction', () => {
      server.setBreakpoint('*api*', { name: 'API' });
      server.setBreakpoint('*users*', { name: 'Users' });

      // Create a new server that should load from file
      const server2 = createServer();
      const breakpoints = server2.getBreakpoints();

      expect(breakpoints).toHaveLength(2);
      expect(breakpoints[0].pattern).toBe('*api*');
      expect(breakpoints[1].pattern).toBe('*users*');
    });

    test('should persist enabled/disabled state', () => {
      server.setBreakpoint('*api*');
      server.toggleBreakpoint('*api*', false);

      const server2 = createServer();
      const breakpoints = server2.getBreakpoints();

      expect(breakpoints[0].enabled).toBe(false);
    });

    test('should handle missing file gracefully', () => {
      // File doesn't exist, should just have empty breakpoints
      expect(server.getBreakpoints()).toEqual([]);
    });

    test('should handle corrupt file gracefully', () => {
      fs.writeFileSync(tmpBreakpointsFile, 'not-valid-json', 'utf8');

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const server2 = createServer();

      expect(server2.getBreakpoints()).toEqual([]);
      consoleErrorSpy.mockRestore();
    });

    test('should skip entries without pattern', () => {
      fs.writeFileSync(tmpBreakpointsFile, JSON.stringify([
        { pattern: '*api*', name: 'valid' },
        { name: 'no-pattern' },
        { pattern: '*users*', name: 'also-valid' }
      ]), 'utf8');

      const server2 = createServer();
      expect(server2.getBreakpoints()).toHaveLength(2);
    });

    test('should update file when breakpoint is removed', () => {
      server.setBreakpoint('*api*');
      server.setBreakpoint('*users*');
      server.removeBreakpoint('*api*');

      const data = JSON.parse(fs.readFileSync(tmpBreakpointsFile, 'utf8'));
      expect(data).toHaveLength(1);
      expect(data[0].pattern).toBe('*users*');
    });
  });
});

describe('Response breakpoints (continueResponse)', () => {
  let server;
  let mockClientRes;

  beforeEach(() => {
    server = createServer();
    mockClientRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      headersSent: false
    };
  });

  test('should send response and remove from queue', () => {
    server.broadcast = jest.fn();

    const requestData = { id: 1, url: 'https://example.com' };
    const responseData = {
      id: 1,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}'
    };

    server.requestQueue.set(1, {
      requestData,
      clientRes: mockClientRes,
      responseData,
      phase: 'response',
      timestamp: Date.now()
    });

    server.continueResponse(1);

    expect(server.requestQueue.has(1)).toBe(false);
    expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'application/json' }));
    expect(mockClientRes.end).toHaveBeenCalledWith('{"ok":true}');
    expect(server.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'traffic' }));
  });

  test('should apply custom response modifications', () => {
    server.broadcast = jest.fn();

    const requestData = { id: 1, url: 'https://example.com' };
    const responseData = {
      id: 1,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '100' },
      body: '{"original":true}'
    };

    server.requestQueue.set(1, {
      requestData,
      clientRes: mockClientRes,
      responseData,
      phase: 'response',
      timestamp: Date.now()
    });

    server.continueResponse(1, {
      body: '{"modified":true}',
      status: 201
    });

    expect(mockClientRes.writeHead).toHaveBeenCalledWith(201, expect.not.objectContaining({ 'content-encoding': 'gzip' }));
    expect(mockClientRes.end).toHaveBeenCalledWith('{"modified":true}');
  });

  test('should clear timeout when continuing response', () => {
    server.broadcast = jest.fn();
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    const timeoutId = setTimeout(() => {}, 10000);

    server.requestQueue.set(1, {
      requestData: { id: 1 },
      clientRes: mockClientRes,
      responseData: { id: 1, status: 200, headers: {}, body: '' },
      phase: 'response',
      timeoutId,
      timestamp: Date.now()
    });

    server.continueResponse(1);

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
    clearTimeout(timeoutId);
    clearTimeoutSpy.mockRestore();
  });

  test('should warn for non-existent request', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    server.continueResponse(999);

    expect(consoleWarnSpy).toHaveBeenCalledWith('Response for request 999 not found in queue');
    consoleWarnSpy.mockRestore();
  });

  test('should warn for wrong phase', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    server.requestQueue.set(1, {
      requestData: { id: 1 },
      clientRes: mockClientRes,
      phase: 'request',
      timestamp: Date.now()
    });

    server.continueResponse(1);

    expect(consoleWarnSpy).toHaveBeenCalledWith('Response for request 1 not found in queue');
    consoleWarnSpy.mockRestore();
  });

  test('should not write headers if already sent', () => {
    server.broadcast = jest.fn();
    mockClientRes.headersSent = true;

    server.requestQueue.set(1, {
      requestData: { id: 1 },
      clientRes: mockClientRes,
      responseData: { id: 1, status: 200, headers: {}, body: 'data' },
      phase: 'response',
      timestamp: Date.now()
    });

    server.continueResponse(1);

    expect(mockClientRes.writeHead).not.toHaveBeenCalled();
    expect(mockClientRes.end).not.toHaveBeenCalled();
  });

  test('should remove content-encoding and content-length when body is customized', () => {
    server.broadcast = jest.fn();

    server.requestQueue.set(1, {
      requestData: { id: 1 },
      clientRes: mockClientRes,
      responseData: {
        id: 1, status: 200,
        headers: { 'content-type': 'text/plain', 'content-encoding': 'br', 'content-length': '50' },
        body: 'original'
      },
      phase: 'response',
      timestamp: Date.now()
    });

    server.continueResponse(1, { body: 'new body' });

    const headers = mockClientRes.writeHead.mock.calls[0][1];
    expect(headers['content-type']).toBe('text/plain');
    expect(headers).not.toHaveProperty('content-encoding');
    expect(headers).not.toHaveProperty('content-length');
  });
});
