const path = require('path');
const fs = require('fs');
const os = require('os');
const ProxyServer = require('../proxy-server');

const tmpDir = os.tmpdir();
const tmpBreakpointsFile = path.join(tmpDir, `breakpoints-mappings-${process.pid}.json`);
const tmpSslFile = path.join(tmpDir, `ssl-mappings-${process.pid}.json`);
const tmpMappingsFile = path.join(tmpDir, `mappings-mappings-${process.pid}.json`);

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

describe('Mapping CRUD', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  describe('setMapping', () => {
    test('should create a new mapping', () => {
      const config = server.setMapping('*api*/users', '/tmp/users.json');

      expect(config.pattern).toBe('*api*/users');
      expect(config.filePath).toBe('/tmp/users.json');
      expect(config.enabled).toBe(true);
      expect(config.createdAt).toBeDefined();
    });

    test('should create mapping with content type', () => {
      const config = server.setMapping('*api*', '/tmp/data.xml', { contentType: 'application/xml' });

      expect(config.contentType).toBe('application/xml');
    });

    test('should create mapping as disabled', () => {
      const config = server.setMapping('*api*', '/tmp/data.json', { enabled: false });

      expect(config.enabled).toBe(false);
    });

    test('should update existing mapping and preserve createdAt', () => {
      const first = server.setMapping('*api*', '/tmp/old.json');
      const createdAt = first.createdAt;

      const second = server.setMapping('*api*', '/tmp/new.json');

      expect(second.filePath).toBe('/tmp/new.json');
      expect(second.createdAt).toBe(createdAt);
    });

    test('should preserve existing contentType when not provided on update', () => {
      server.setMapping('*api*', '/tmp/data.json', { contentType: 'application/json' });
      const updated = server.setMapping('*api*', '/tmp/data2.json');

      expect(updated.contentType).toBe('application/json');
    });
  });

  describe('removeMapping', () => {
    test('should remove an existing mapping', () => {
      server.setMapping('*api*', '/tmp/data.json');
      expect(server.getMappings()).toHaveLength(1);

      server.removeMapping('*api*');
      expect(server.getMappings()).toHaveLength(0);
    });

    test('should not throw when removing non-existent mapping', () => {
      expect(() => server.removeMapping('*nonexistent*')).not.toThrow();
    });
  });

  describe('toggleMapping', () => {
    test('should disable an enabled mapping', () => {
      server.setMapping('*api*', '/tmp/data.json');
      const result = server.toggleMapping('*api*', false);

      expect(result.enabled).toBe(false);
    });

    test('should enable a disabled mapping', () => {
      server.setMapping('*api*', '/tmp/data.json', { enabled: false });
      const result = server.toggleMapping('*api*', true);

      expect(result.enabled).toBe(true);
    });

    test('should return null for non-existent mapping', () => {
      const result = server.toggleMapping('*nonexistent*', true);
      expect(result).toBeNull();
    });

    test('disabled mapping should not match in checkMapping', () => {
      server.setMapping('*api*', '/tmp/data.json');
      server.toggleMapping('*api*', false);

      const match = server.checkMapping('https://api.example.com');
      expect(match).toBeNull();
    });
  });

  describe('getMappings', () => {
    test('should return empty array when no mappings', () => {
      expect(server.getMappings()).toEqual([]);
    });

    test('should return all mappings', () => {
      server.setMapping('*api*', '/tmp/api.json');
      server.setMapping('*users*', '/tmp/users.json');

      const mappings = server.getMappings();
      expect(mappings).toHaveLength(2);
      expect(mappings[0].pattern).toBe('*api*');
      expect(mappings[1].pattern).toBe('*users*');
    });
  });

  describe('checkMapping', () => {
    test('should return config for matching enabled mapping', () => {
      server.setMapping('*api*', '/tmp/data.json', { contentType: 'application/json' });
      const result = server.checkMapping('https://api.example.com/users');

      expect(result).not.toBeNull();
      expect(result.filePath).toBe('/tmp/data.json');
    });

    test('should return null when no mappings match', () => {
      server.setMapping('*api*', '/tmp/data.json');
      const result = server.checkMapping('https://example.com/users');

      expect(result).toBeNull();
    });

    test('should skip disabled mappings', () => {
      server.setMapping('*api*', '/tmp/data.json', { enabled: false });
      const result = server.checkMapping('https://api.example.com');

      expect(result).toBeNull();
    });

    test('should return first matching mapping', () => {
      server.setMapping('*example*', '/tmp/broad.json');
      server.setMapping('*api*', '/tmp/specific.json');

      const result = server.checkMapping('https://api.example.com');
      expect(result.filePath).toBe('/tmp/broad.json');
    });
  });
});

describe('Mapping file persistence', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  test('should save mappings to file', () => {
    server.setMapping('*api*', '/tmp/data.json', { contentType: 'application/json' });

    expect(fs.existsSync(tmpMappingsFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(tmpMappingsFile, 'utf8'));
    expect(data).toHaveLength(1);
    expect(data[0].pattern).toBe('*api*');
    expect(data[0].filePath).toBe('/tmp/data.json');
  });

  test('should load mappings from file on construction', () => {
    server.setMapping('*api*', '/tmp/api.json');
    server.setMapping('*users*', '/tmp/users.json');

    const server2 = createServer();
    const mappings = server2.getMappings();

    expect(mappings).toHaveLength(2);
    expect(mappings[0].pattern).toBe('*api*');
    expect(mappings[1].pattern).toBe('*users*');
  });

  test('should persist enabled/disabled state', () => {
    server.setMapping('*api*', '/tmp/data.json');
    server.toggleMapping('*api*', false);

    const server2 = createServer();
    const mappings = server2.getMappings();

    expect(mappings[0].enabled).toBe(false);
  });

  test('should handle missing file gracefully', () => {
    expect(server.getMappings()).toEqual([]);
  });

  test('should handle corrupt file gracefully', () => {
    fs.writeFileSync(tmpMappingsFile, '{bad json', 'utf8');

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const server2 = createServer();

    expect(server2.getMappings()).toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  test('should skip entries without pattern or filePath', () => {
    fs.writeFileSync(tmpMappingsFile, JSON.stringify([
      { pattern: '*api*', filePath: '/tmp/api.json' },
      { pattern: '*users*' },  // missing filePath
      { filePath: '/tmp/orphan.json' },  // missing pattern
      { pattern: '*posts*', filePath: '/tmp/posts.json' }
    ]), 'utf8');

    const server2 = createServer();
    expect(server2.getMappings()).toHaveLength(2);
    expect(server2.getMappings()[0].pattern).toBe('*api*');
    expect(server2.getMappings()[1].pattern).toBe('*posts*');
  });

  test('should update file when mapping is removed', () => {
    server.setMapping('*api*', '/tmp/api.json');
    server.setMapping('*users*', '/tmp/users.json');
    server.removeMapping('*api*');

    const data = JSON.parse(fs.readFileSync(tmpMappingsFile, 'utf8'));
    expect(data).toHaveLength(1);
    expect(data[0].pattern).toBe('*users*');
  });
});

describe('sendMappedResponse', () => {
  let server;
  let mockClientRes;
  let tmpResponseFile;

  beforeEach(() => {
    server = createServer();
    server.broadcast = jest.fn();
    mockClientRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      headersSent: false
    };
    tmpResponseFile = path.join(tmpDir, `mapped-response-${process.pid}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpResponseFile); } catch {}
  });

  test('should serve mapped file with default content type', (done) => {
    fs.writeFileSync(tmpResponseFile, '{"mapped":true}');

    const config = { filePath: tmpResponseFile };
    const requestData = { id: 1, method: 'GET', url: 'https://api.example.com/users' };

    mockClientRes.end = jest.fn(() => {
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'application/json' });
      expect(server.broadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'traffic',
        response: expect.objectContaining({ mapped: true })
      }));
      done();
    });

    server.sendMappedResponse(mockClientRes, config, requestData);
  });

  test('should serve mapped file with custom content type', (done) => {
    fs.writeFileSync(tmpResponseFile, '<html></html>');

    const config = { filePath: tmpResponseFile, contentType: 'text/html' };
    const requestData = { id: 1, method: 'GET', url: 'https://example.com' };

    mockClientRes.end = jest.fn(() => {
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'text/html' });
      done();
    });

    server.sendMappedResponse(mockClientRes, config, requestData);
  });

  test('should detect content type from file extension (.html)', (done) => {
    const htmlFile = path.join(tmpDir, `mapped-${process.pid}.html`);
    fs.writeFileSync(htmlFile, '<html></html>');

    const config = { filePath: htmlFile };
    const requestData = { id: 1, method: 'GET', url: 'https://example.com' };

    mockClientRes.end = jest.fn(() => {
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'text/html' });
      try { fs.unlinkSync(htmlFile); } catch {}
      done();
    });

    server.sendMappedResponse(mockClientRes, config, requestData);
  });

  test('should detect content type from file extension (.css)', (done) => {
    const cssFile = path.join(tmpDir, `mapped-${process.pid}.css`);
    fs.writeFileSync(cssFile, 'body {}');

    const config = { filePath: cssFile };
    const requestData = { id: 1, method: 'GET', url: 'https://example.com/style.css' };

    mockClientRes.end = jest.fn(() => {
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'text/css' });
      try { fs.unlinkSync(cssFile); } catch {}
      done();
    });

    server.sendMappedResponse(mockClientRes, config, requestData);
  });

  test('should detect content type from file extension (.js)', (done) => {
    const jsFile = path.join(tmpDir, `mapped-${process.pid}.js`);
    fs.writeFileSync(jsFile, 'console.log("hi")');

    const config = { filePath: jsFile };
    const requestData = { id: 1, method: 'GET', url: 'https://example.com/app.js' };

    mockClientRes.end = jest.fn(() => {
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'application/javascript' });
      try { fs.unlinkSync(jsFile); } catch {}
      done();
    });

    server.sendMappedResponse(mockClientRes, config, requestData);
  });

  test('should return 404 when mapped file does not exist', (done) => {
    const config = { filePath: '/tmp/nonexistent-file-12345.json' };
    const requestData = { id: 1, method: 'GET', url: 'https://example.com' };

    mockClientRes.end = jest.fn(() => {
      expect(mockClientRes.writeHead).toHaveBeenCalledWith(404);
      done();
    });

    server.sendMappedResponse(mockClientRes, config, requestData);
  });
});

describe('createMappingFromResponse', () => {
  let server;

  beforeEach(() => {
    server = createServer();
    // Override mappedResponsesDir to use tmp
    server.mappedResponsesDir = path.join(tmpDir, `mapped-responses-test-${process.pid}`);
  });

  afterEach(() => {
    // Clean up mapped responses directory
    try {
      const files = fs.readdirSync(server.mappedResponsesDir);
      for (const f of files) {
        fs.unlinkSync(path.join(server.mappedResponsesDir, f));
      }
      fs.rmdirSync(server.mappedResponsesDir);
    } catch {}
  });

  test('should create a file and mapping from response body', () => {
    const body = '{"users":[{"id":1}]}';
    const config = server.createMappingFromResponse('*api*/users', body, 'application/json');

    expect(config.pattern).toBe('*api*/users');
    expect(config.filePath).toBeDefined();
    expect(config.contentType).toBe('application/json');
    expect(fs.existsSync(config.filePath)).toBe(true);
    expect(fs.readFileSync(config.filePath, 'utf8')).toBe(body);
  });

  test('should use .json extension for JSON content type', () => {
    const config = server.createMappingFromResponse('*api*', '{}', 'application/json');

    expect(config.filePath).toMatch(/\.json$/);
  });

  test('should use .txt extension for non-JSON content type', () => {
    const config = server.createMappingFromResponse('*api*', 'hello', 'text/plain');

    expect(config.filePath).toMatch(/\.txt$/);
  });

  test('should create mappedResponsesDir if it does not exist', () => {
    expect(fs.existsSync(server.mappedResponsesDir)).toBe(false);

    server.createMappingFromResponse('*api*', '{}', 'application/json');

    expect(fs.existsSync(server.mappedResponsesDir)).toBe(true);
  });

  test('should sanitize special characters in pattern for filename', () => {
    const config = server.createMappingFromResponse('*https://api.example.com/users?id=1*', '{}', 'application/json');

    const filename = path.basename(config.filePath);
    // Should not contain :/? etc.
    expect(filename).not.toMatch(/[:/\\?]/);
  });

  test('created mapping should be usable via checkMapping', () => {
    server.createMappingFromResponse('*api*/users', '{"data":true}', 'application/json');

    const match = server.checkMapping('https://api.example.com/users');
    expect(match).not.toBeNull();
    expect(match.filePath).toBeDefined();
  });
});
