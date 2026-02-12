# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start server (Web UI on :3000, proxy on :8888)
npm run dev        # Start with nodemon auto-reload
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
npm test -- --testPathPattern=pattern-matching  # Run a single test file
npm run test:coverage  # Run tests with coverage report
```

## Architecture

This is an HTTP/HTTPS intercepting proxy with a web UI for inspecting and manipulating network traffic.

**Two-process design:**
- `server.js` — Express web server + WebSocket hub. Serves the web UI, manages WebSocket connections to browser clients, and routes control messages (breakpoint CRUD, continue/respond actions) to the proxy.
- `proxy-server.js` — Core `ProxyServer` class. Handles HTTP proxying, HTTPS CONNECT tunneling with on-the-fly certificate generation (via `node-forge`), breakpoint matching, response mapping, and request queuing.

**Request flow:** Client → proxy (:8888) → `checkBreakpoint` / `checkMapping` → forward to origin or queue/map → response back to client. All traffic is broadcast to WebSocket clients for the UI.

**Breakpoint system:** Patterns stored in `Map<pattern, config>`, persisted to `breakpoints.json`. Wildcard patterns (`*api*`) are converted to regex by splitting on `*`, escaping regex chars in each part, and joining with `.*`. Queued requests have a 2-minute timeout before auto-continuing.

**Frontend:** `public/index.html` + `public/app.js` — single-page app communicating via WebSocket. `public/setup.html` — device setup page with proxy/cert install instructions.

## Testing

Tests are in `__tests__/` and use Jest with `node` test environment. All tests import `ProxyServer` directly — the constructor calls `generateCACertificate()` which reads/writes `ca-cert.pem` and `ca-key.pem` from disk.

Test files:
- `pattern-matching.test.js` — wildcard-to-regex conversion edge cases
- `request-queue.test.js` — queue operations, timeouts (uses `jest.useFakeTimers()`)
- `breakpoint-integration.test.js` — end-to-end breakpoint flows
- `body-formatting.test.js` — decompression and body processing for broadcast
