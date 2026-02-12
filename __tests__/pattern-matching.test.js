const path = require('path');
const fs = require('fs');
const os = require('os');
const ProxyServer = require('../proxy-server');

const tmpBreakpointsFile = path.join(os.tmpdir(), `breakpoints-test-pattern-${process.pid}.json`);

afterAll(() => { try { fs.unlinkSync(tmpBreakpointsFile); } catch {} });

describe('Pattern Matching', () => {
  let proxyServer;

  beforeEach(() => {
    try { fs.unlinkSync(tmpBreakpointsFile); } catch {}
    proxyServer = new ProxyServer(8888, { breakpointsFilePath: tmpBreakpointsFile });
  });

  describe('Leading wildcard patterns', () => {
    test('should match URL with leading wildcard *api.example.com', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*api.example.com';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with leading wildcard *example.com', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*example.com';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should not match URL with leading wildcard *different.com', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*different.com';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });

    test('should match URL with leading wildcard *.example.com', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*.example.com';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });
  });

  describe('Trailing wildcard patterns', () => {
    test('should match URL with trailing wildcard api.example.com*', () => {
      const url = 'https://api.example.com/users';
      const pattern = 'api.example.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with trailing wildcard https://api.example.com*', () => {
      const url = 'https://api.example.com/users';
      const pattern = 'https://api.example.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should not match URL with trailing wildcard different.com*', () => {
      const url = 'https://api.example.com/users';
      const pattern = 'different.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });

    test('should match URL with trailing wildcard /users*', () => {
      const url = 'https://api.example.com/users/123';
      const pattern = '/users*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });
  });

  describe('Both leading and trailing wildcards', () => {
    test('should match URL with wildcards *api.example.com*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*api.example.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with wildcards *example*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*example*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with wildcards *users*', () => {
      const url = 'https://api.example.com/users/123';
      const pattern = '*users*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should not match URL with wildcards *different*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*different*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });
  });

  describe('Multiple wildcards', () => {
    test('should match URL with multiple wildcards *api*/users/*', () => {
      const url = 'https://api.example.com/users/123';
      const pattern = '*api*/users/*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with multiple wildcards *example*users*', () => {
      const url = 'https://api.example.com/users/123';
      const pattern = '*example*users*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should not match URL with multiple wildcards *example*posts*', () => {
      const url = 'https://api.example.com/users/123';
      const pattern = '*example*posts*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });

    test('should match URL with complex pattern *://*/users/*', () => {
      const url = 'https://api.example.com/users/123';
      const pattern = '*://*/users/*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });
  });

  describe('No wildcard patterns', () => {
    test('should match URL with exact substring api.example.com', () => {
      const url = 'https://api.example.com/users';
      const pattern = 'api.example.com';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with exact substring /users', () => {
      const url = 'https://api.example.com/users';
      const pattern = '/users';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should not match URL with exact substring different.com', () => {
      const url = 'https://api.example.com/users';
      const pattern = 'different.com';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });

    test('should match URL with full URL https://api.example.com/users', () => {
      const url = 'https://api.example.com/users';
      const pattern = 'https://api.example.com/users';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });
  });

  describe('Special characters in patterns', () => {
    test('should match URL with query parameters *api.example.com/users?id=123*', () => {
      const url = 'https://api.example.com/users?id=123&name=test';
      const pattern = '*api.example.com/users?id=123*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with special characters in path *users/[123]*', () => {
      const url = 'https://api.example.com/users/[123]/profile';
      const pattern = '*users/[123]*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should escape regex special characters correctly *(test)*', () => {
      const url = 'https://api.example.com/(test)/endpoint';
      const pattern = '*(test)*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with dots in pattern *api.v2.example.com*', () => {
      const url = 'https://api.v2.example.com/users';
      const pattern = '*api.v2.example.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with hash fragment *#section*', () => {
      const url = 'https://example.com/page#section';
      const pattern = '*#section*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('should match any URL with wildcard-only pattern *', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with empty pattern using includes', () => {
      const url = 'https://api.example.com/users';
      const pattern = '';
      // Empty pattern will use includes() which returns true for any string
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match empty URL with empty pattern', () => {
      const url = '';
      const pattern = '';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should be case sensitive for pattern *API*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*API*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });

    test('should match exact case *api*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*api*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should handle consecutive wildcards **api**', () => {
      const url = 'https://api.example.com/users';
      const pattern = '**api**';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match URL with protocol wildcard *://api.example.com*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*://api.example.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match http URL with wildcard pattern', () => {
      const url = 'http://api.example.com/users';
      const pattern = '*api.example.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should handle very long URLs with wildcards', () => {
      const url = 'https://api.example.com/very/long/path/to/resource/with/many/segments/users/123/profile/settings';
      const pattern = '*users*profile*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should not match when pattern has more specific content', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*api.example.com/posts*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(false);
    });
  });

  describe('Real-world examples', () => {
    test('should match JSONPlaceholder API with *jsonplaceholder.typicode.com*', () => {
      const url = 'https://jsonplaceholder.typicode.com/posts/1';
      const pattern = '*jsonplaceholder.typicode.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match GitHub API with *api.github.com*', () => {
      const url = 'https://api.github.com/users/octocat';
      const pattern = '*api.github.com*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match specific endpoint with */v1/users*', () => {
      const url = 'https://api.example.com/v1/users/123';
      const pattern = '*/v1/users*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match all API calls with *api*', () => {
      const url = 'https://api.example.com/users';
      const pattern = '*api*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });

    test('should match localhost with *localhost*', () => {
      const url = 'http://localhost:3000/api/users';
      const pattern = '*localhost*';
      expect(proxyServer.matchPattern(url, pattern)).toBe(true);
    });
  });
});
