const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ProxyServer = require('../proxy-server');

const tmpBreakpointsFile = path.join(os.tmpdir(), `breakpoints-test-body-${process.pid}.json`);

afterAll(() => { try { fs.unlinkSync(tmpBreakpointsFile); } catch {} });

describe('Body Formatting', () => {
  let proxy;

  beforeEach(() => {
    try { fs.unlinkSync(tmpBreakpointsFile); } catch {}
    proxy = new ProxyServer(8888, { breakpointsFilePath: tmpBreakpointsFile });
  });

  describe('isJsonContentType()', () => {
    test('detects application/json', () => {
      expect(proxy.isJsonContentType({ 'content-type': 'application/json' })).toBe(true);
    });

    test('detects application/json with charset', () => {
      expect(proxy.isJsonContentType({ 'content-type': 'application/json; charset=utf-8' })).toBe(true);
    });

    test('detects application/vnd.api+json', () => {
      expect(proxy.isJsonContentType({ 'content-type': 'application/vnd.api+json' })).toBe(true);
    });

    test('detects text/json', () => {
      expect(proxy.isJsonContentType({ 'content-type': 'text/json' })).toBe(true);
    });

    test('detects JSON with uppercase', () => {
      expect(proxy.isJsonContentType({ 'content-type': 'APPLICATION/JSON' })).toBe(true);
    });

    test('rejects text/plain', () => {
      expect(proxy.isJsonContentType({ 'content-type': 'text/plain' })).toBe(false);
    });

    test('handles missing content-type', () => {
      expect(proxy.isJsonContentType({})).toBe(false);
    });
  });

  describe('isBinaryContentType()', () => {
    test('detects image/png', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'image/png' })).toBe(true);
    });

    test('detects video/mp4', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'video/mp4' })).toBe(true);
    });

    test('detects audio/mpeg', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'audio/mpeg' })).toBe(true);
    });

    test('detects application/octet-stream', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'application/octet-stream' })).toBe(true);
    });

    test('detects application/pdf', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'application/pdf' })).toBe(true);
    });

    test('detects application/zip', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'application/zip' })).toBe(true);
    });

    test('detects font/woff2', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'font/woff2' })).toBe(true);
    });

    test('rejects text/plain', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'text/plain' })).toBe(false);
    });

    test('rejects application/json', () => {
      expect(proxy.isBinaryContentType({ 'content-type': 'application/json' })).toBe(false);
    });

    test('handles missing content-type', () => {
      expect(proxy.isBinaryContentType({})).toBe(false);
    });
  });

  describe('processBodyForBroadcast()', () => {
    describe('null/empty bodies', () => {
      test('handles null body', () => {
        const result = proxy.processBodyForBroadcast(null, {});
        expect(result).toEqual({ body: null });
      });

      test('handles empty buffer', () => {
        const result = proxy.processBodyForBroadcast(Buffer.from(''), {});
        expect(result).toEqual({ body: null });
      });
    });

    describe('JSON bodies', () => {
      test('prettifies simple JSON object', () => {
        const body = Buffer.from('{"name":"John"}');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{\n  "name": "John"\n}');
        expect(result.bodyMeta).toEqual({
          contentType: 'json',
          encoding: 'utf8',
          originalSize: body.length
        });
      });

      test('prettifies nested JSON', () => {
        const body = Buffer.from('{"user":{"name":"John","age":30}}');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{\n  "user": {\n    "name": "John",\n    "age": 30\n  }\n}');
        expect(result.bodyMeta.contentType).toBe('json');
      });

      test('prettifies JSON array', () => {
        const body = Buffer.from('[1,2,3]');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('[\n  1,\n  2,\n  3\n]');
        expect(result.bodyMeta.contentType).toBe('json');
      });

      test('handles JSON with unicode characters', () => {
        const body = Buffer.from('{"emoji":"😀","chinese":"你好"}');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{\n  "emoji": "😀",\n  "chinese": "你好"\n}');
        expect(result.bodyMeta.contentType).toBe('json');
      });

      test('handles JSON with special characters', () => {
        const body = Buffer.from('{"quote":"He said \\"hello\\"","newline":"line1\\nline2"}');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        const parsed = JSON.parse(result.body);
        expect(parsed.quote).toBe('He said "hello"');
        expect(parsed.newline).toBe('line1\nline2');
        expect(result.bodyMeta.contentType).toBe('json');
      });

      test('handles vnd.api+json content type', () => {
        const body = Buffer.from('{"data":{"type":"articles"}}');
        const headers = { 'content-type': 'application/vnd.api+json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{\n  "data": {\n    "type": "articles"\n  }\n}');
        expect(result.bodyMeta.contentType).toBe('json');
      });

      test('handles malformed JSON with JSON content-type', () => {
        const body = Buffer.from('{invalid json}');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{invalid json}');
        expect(result.bodyMeta.contentType).toBe('text');
        expect(result.bodyMeta.parseError).toBeDefined();
      });

      test('handles JSON with trailing commas (malformed)', () => {
        const body = Buffer.from('{"name":"John",}');
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{"name":"John",}');
        expect(result.bodyMeta.contentType).toBe('text');
        expect(result.bodyMeta.parseError).toContain('JSON');
      });
    });

    describe('binary bodies', () => {
      test('encodes image/png as base64', () => {
        const body = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
        const headers = { 'content-type': 'image/png' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe(body.toString('base64'));
        expect(result.bodyMeta).toEqual({
          contentType: 'binary',
          encoding: 'base64',
          originalSize: body.length
        });
      });

      test('encodes application/pdf as base64', () => {
        const body = Buffer.from([37, 80, 68, 70]); // PDF header
        const headers = { 'content-type': 'application/pdf' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe(body.toString('base64'));
        expect(result.bodyMeta.contentType).toBe('binary');
      });

      test('encodes video/mp4 as base64', () => {
        const body = Buffer.from('fake video data');
        const headers = { 'content-type': 'video/mp4' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe(body.toString('base64'));
        expect(result.bodyMeta.contentType).toBe('binary');
      });
    });

    describe('text bodies', () => {
      test('handles plain text', () => {
        const body = Buffer.from('Hello, world!');
        const headers = { 'content-type': 'text/plain' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('Hello, world!');
        expect(result.bodyMeta).toEqual({
          contentType: 'text',
          encoding: 'utf8'
        });
      });

      test('handles text/html', () => {
        const body = Buffer.from('<html><body>Hello</body></html>');
        const headers = { 'content-type': 'text/html' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('<html><body>Hello</body></html>');
        expect(result.bodyMeta.contentType).toBe('text');
      });

      test('handles missing content-type as text', () => {
        const body = Buffer.from('Some text data');
        const headers = {};
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('Some text data');
        expect(result.bodyMeta.contentType).toBe('text');
      });

      test('handles text with unicode', () => {
        const body = Buffer.from('Hello 世界 🌍');
        const headers = { 'content-type': 'text/plain; charset=utf-8' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('Hello 世界 🌍');
        expect(result.bodyMeta.contentType).toBe('text');
      });
    });

    describe('defensive handling', () => {
      test('handles non-Buffer string body', () => {
        const body = '{"name":"John"}';
        const headers = { 'content-type': 'application/json' };
        const result = proxy.processBodyForBroadcast(body, headers);

        expect(result.body).toBe('{\n  "name": "John"\n}');
        expect(result.bodyMeta.contentType).toBe('json');
      });

      test('handles non-Buffer string for binary', () => {
        const body = 'fake image data';
        const headers = { 'content-type': 'image/png' };
        const result = proxy.processBodyForBroadcast(body, headers);

        // Non-buffer string is returned as-is for binary
        expect(result.body).toBe('fake image data');
        expect(result.bodyMeta.contentType).toBe('binary');
      });
    });
  });

  describe('broadcast() integration', () => {
    let mockWs;

    beforeEach(() => {
      mockWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        emit: jest.fn()
      };
      proxy.addWebSocketClient(mockWs);
    });

    test('processes request body in broadcast', () => {
      const requestData = {
        body: Buffer.from('{"name":"John"}'),
        headers: { 'content-type': 'application/json' }
      };

      proxy.broadcast({
        type: 'traffic',
        request: requestData
      });

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);

      expect(sentData.request.body).toBe('{\n  "name": "John"\n}');
      expect(sentData.request.bodyMeta.contentType).toBe('json');
    });

    test('processes response body in broadcast', () => {
      const responseData = {
        body: Buffer.from('{"status":"ok"}'),
        headers: { 'content-type': 'application/json' }
      };

      proxy.broadcast({
        type: 'traffic',
        response: responseData
      });

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);

      expect(sentData.response.body).toBe('{\n  "status": "ok"\n}');
      expect(sentData.response.bodyMeta.contentType).toBe('json');
    });

    test('processes both request and response bodies', () => {
      const requestData = {
        body: Buffer.from('{"query":"test"}'),
        headers: { 'content-type': 'application/json' }
      };

      const responseData = {
        body: Buffer.from('{"result":"success"}'),
        headers: { 'content-type': 'application/json' }
      };

      proxy.broadcast({
        type: 'traffic',
        request: requestData,
        response: responseData
      });

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);

      expect(sentData.request.body).toBe('{\n  "query": "test"\n}');
      expect(sentData.response.body).toBe('{\n  "result": "success"\n}');
    });

    test('handles broadcast with no body', () => {
      proxy.broadcast({
        type: 'traffic',
        request: {
          headers: { 'content-type': 'application/json' }
        }
      });

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);

      expect(sentData.request.body).toBeUndefined();
    });

    test('does not mutate original data', () => {
      const originalBody = Buffer.from('{"name":"John"}');
      const requestData = {
        body: originalBody,
        headers: { 'content-type': 'application/json' }
      };

      proxy.broadcast({
        type: 'traffic',
        request: requestData
      });

      // Original should still be a Buffer
      expect(Buffer.isBuffer(requestData.body)).toBe(true);
      expect(requestData.body).toBe(originalBody);
    });

    test('handles mixed content types', () => {
      const requestData = {
        body: Buffer.from('plain text request'),
        headers: { 'content-type': 'text/plain' }
      };

      const responseData = {
        body: Buffer.from('{"json":"response"}'),
        headers: { 'content-type': 'application/json' }
      };

      proxy.broadcast({
        type: 'traffic',
        request: requestData,
        response: responseData
      });

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);

      expect(sentData.request.body).toBe('plain text request');
      expect(sentData.request.bodyMeta.contentType).toBe('text');
      expect(sentData.response.body).toBe('{\n  "json": "response"\n}');
      expect(sentData.response.bodyMeta.contentType).toBe('json');
    });
  });

  describe('decompressBody()', () => {
    test('decompresses gzip content', () => {
      const original = Buffer.from('hello world');
      const compressed = zlib.gzipSync(original);
      const result = proxy.decompressBody(compressed, 'gzip');

      expect(result.body.toString()).toBe('hello world');
      expect(result.wasDecompressed).toBe(true);
      expect(result.originalEncoding).toBe('gzip');
    });

    test('decompresses deflate content', () => {
      const original = Buffer.from('hello world');
      const compressed = zlib.deflateSync(original);
      const result = proxy.decompressBody(compressed, 'deflate');

      expect(result.body.toString()).toBe('hello world');
      expect(result.wasDecompressed).toBe(true);
      expect(result.originalEncoding).toBe('deflate');
    });

    test('decompresses brotli content', () => {
      const original = Buffer.from('hello world');
      const compressed = zlib.brotliCompressSync(original);
      const result = proxy.decompressBody(compressed, 'br');

      expect(result.body.toString()).toBe('hello world');
      expect(result.wasDecompressed).toBe(true);
      expect(result.originalEncoding).toBe('br');
    });

    test('handles x-gzip alias', () => {
      const original = Buffer.from('hello world');
      const compressed = zlib.gzipSync(original);
      const result = proxy.decompressBody(compressed, 'x-gzip');

      expect(result.body.toString()).toBe('hello world');
      expect(result.wasDecompressed).toBe(true);
      expect(result.originalEncoding).toBe('x-gzip');
    });

    test('passes through unknown encoding', () => {
      const buffer = Buffer.from('some data');
      const result = proxy.decompressBody(buffer, 'unknown');

      expect(result.body).toBe(buffer);
      expect(result.wasDecompressed).toBe(false);
    });

    test('handles null body', () => {
      const result = proxy.decompressBody(null, 'gzip');

      expect(result.body).toBeNull();
      expect(result.wasDecompressed).toBe(false);
    });

    test('handles null encoding', () => {
      const buffer = Buffer.from('some data');
      const result = proxy.decompressBody(buffer, null);

      expect(result.body).toBe(buffer);
      expect(result.wasDecompressed).toBe(false);
    });

    test('returns original buffer on corrupt data', () => {
      const corrupt = Buffer.from('not valid gzip data');
      const result = proxy.decompressBody(corrupt, 'gzip');

      expect(result.body).toBe(corrupt);
      expect(result.wasDecompressed).toBe(false);
      expect(result.decompressError).toBeDefined();
    });

    test('handles case-insensitive encoding', () => {
      const original = Buffer.from('hello world');
      const compressed = zlib.gzipSync(original);
      const result = proxy.decompressBody(compressed, 'GZIP');

      expect(result.body.toString()).toBe('hello world');
      expect(result.wasDecompressed).toBe(true);
    });
  });

  describe('broadcast() with compressed bodies', () => {
    let mockWs;

    beforeEach(() => {
      mockWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        emit: jest.fn()
      };
      proxy.addWebSocketClient(mockWs);
    });

    test('decompresses gzip JSON response and prettifies', () => {
      const json = '{"name":"John"}';
      const compressed = zlib.gzipSync(Buffer.from(json));

      proxy.broadcast({
        type: 'traffic',
        response: {
          body: compressed,
          headers: {
            'content-type': 'application/json',
            'content-encoding': 'gzip'
          }
        }
      });

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.response.body).toBe('{\n  "name": "John"\n}');
      expect(sentData.response.bodyMeta.contentType).toBe('json');
      expect(sentData.response.bodyMeta.wasDecompressed).toBe(true);
      expect(sentData.response.bodyMeta.originalEncoding).toBe('gzip');
    });
  });
});
