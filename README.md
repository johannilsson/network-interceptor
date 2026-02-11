# Network Traffic Interceptor

A powerful network traffic interceptor with HTTPS support, breakpoints, and response mapping capabilities. Built with Node.js and featuring a modern web interface.

## Features

- 🔒 **HTTPS Support** - Self-signed certificate generation for intercepting secure traffic
- 📊 **Traffic Logging** - Real-time view of all HTTP/HTTPS requests and responses
- 🔍 **URL Filtering** - Filter traffic by URL patterns
- 🔎 **Request/Response Inspection** - View headers, body, and metadata
- ⏸️ **Breakpoints** - Pause requests and provide custom responses
- 🗺️ **Response Mapping** - Map URLs to local files for mocking responses
- 🎨 **Modern UI** - Clean, responsive interface with real-time updates

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The application will start on:
- **Web UI**: http://localhost:3000
- **Proxy Server**: localhost:8888

## Setup Instructions

### 1. Install CA Certificate

For HTTPS interception to work, you need to install the CA certificate:

1. Open the web interface at http://localhost:3000
2. Click "Download CA Cert" button
3. Install the certificate on your system:

**macOS:**
```bash
# Double-click the downloaded .pem file
# Open Keychain Access
# Find "Network Interceptor CA"
# Double-click and set to "Always Trust"
```

**Windows:**
```bash
# Double-click the .pem file
# Click "Install Certificate"
# Select "Local Machine"
# Place in "Trusted Root Certification Authorities"
```

**Linux:**
```bash
sudo cp network-interceptor-ca.pem /usr/local/share/ca-certificates/network-interceptor.crt
sudo update-ca-certificates
```

### 2. Configure Proxy

Configure your system or browser to use the proxy:

**System-wide (macOS):**
```
System Preferences → Network → Advanced → Proxies
- Web Proxy (HTTP): localhost:8888
- Secure Web Proxy (HTTPS): localhost:8888
```

**System-wide (Windows):**
```
Settings → Network & Internet → Proxy → Manual proxy setup
- Address: localhost
- Port: 8888
```

**Firefox:**
```
Settings → Network Settings → Manual proxy configuration
- HTTP Proxy: localhost, Port: 8888
- Also use this proxy for HTTPS
```

**Chrome/Edge:**
Uses system proxy settings

## Usage

### Viewing Traffic

All network traffic will appear in the sidebar. Click on any request to view:
- **Overview**: Request and response summary
- **Request**: Headers and body
- **Response**: Headers and body

### Setting Breakpoints

1. Click "Breakpoints" button
2. Enter a URL pattern (e.g., `*api.example.com*` or `/api/users`)
3. Click "Add Breakpoint"

When a request matches a breakpoint:
- The request will pause
- A modal will appear with request details
- You can:
  - **Continue Original**: Let the request proceed normally
  - **Respond Custom**: Provide a custom response with status code and body

### Response Mapping

Map specific URLs to local files:

1. Click "Mappings" button
2. Enter URL pattern (e.g., `*api.example.com/data*`)
3. Enter absolute file path (e.g., `/home/user/mock-data.json`)
4. Click "Add Mapping"

Matching requests will receive the file contents as response.

### Filtering

Use the filter input in the sidebar to search for specific URLs.

### Clearing Traffic

Click "Clear" button to remove all captured traffic from the view.

## URL Pattern Matching

Patterns support wildcards:
- `*api.example.com*` - Matches any URL containing "api.example.com"
- `/api/users` - Matches any URL containing "/api/users"
- `*.json` - Matches any URL ending with ".json"

## Architecture

- **proxy-server.js**: Core proxy server with HTTPS certificate generation
- **server.js**: Express server for web UI and WebSocket communication
- **public/index.html**: Web interface
- **public/app.js**: Frontend JavaScript with WebSocket handling

## Security Note

This tool generates a self-signed CA certificate for HTTPS interception. Only install the certificate on systems you trust and control. The certificate allows the proxy to decrypt HTTPS traffic, which can be a security risk if the certificate is compromised or used maliciously.

## Troubleshooting

**HTTPS not working:**
- Ensure CA certificate is properly installed and trusted
- Check that proxy is configured correctly
- Some applications may pin certificates and won't work with the proxy

**WebSocket connection failed:**
- Make sure port 3000 is not in use
- Check firewall settings

**Proxy connection refused:**
- Verify proxy server is running on port 8888
- Check that nothing else is using port 8888

## Development

Run with auto-reload during development:
```bash
npm run dev
```

## License

MIT
