#!/bin/bash

# Network Interceptor Test Script
# This script demonstrates testing the proxy with various curl commands

PROXY="http://localhost:8888"
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Network Interceptor - Test Suite                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

# Check if proxy is running
echo -e "${YELLOW}► Checking if proxy is running...${NC}"
if ! nc -z localhost 8888 2>/dev/null; then
    echo -e "${BOLD}Error: Proxy not running on port 8888${NC}"
    echo "Please start the proxy with: npm start"
    exit 1
fi
echo -e "${GREEN}✓ Proxy is running${NC}\n"

sleep 1

# Test 1: Simple HTTP GET
echo -e "${BOLD}${CYAN}[Test 1] HTTP GET Request${NC}"
echo -e "${YELLOW}Command:${NC} curl -x $PROXY http://httpbin.org/get"
echo -e "${YELLOW}Expected:${NC} Should see request in web UI\n"
curl -x $PROXY -s http://httpbin.org/get | jq -r '.url' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Test 2: HTTPS GET (insecure)
echo -e "${BOLD}${CYAN}[Test 2] HTTPS GET Request${NC}"
echo -e "${YELLOW}Command:${NC} curl -x $PROXY -k https://httpbin.org/get"
echo -e "${YELLOW}Expected:${NC} Should intercept HTTPS traffic\n"
curl -x $PROXY -k -s https://httpbin.org/get | jq -r '.url' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Test 3: POST with JSON
echo -e "${BOLD}${CYAN}[Test 3] POST Request with JSON${NC}"
echo -e "${YELLOW}Command:${NC} curl -x $PROXY -k -X POST https://httpbin.org/post"
echo -e "${YELLOW}Expected:${NC} Should capture POST body in web UI\n"
curl -x $PROXY -k -s \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","timestamp":"'$(date +%s)'"}' \
  https://httpbin.org/post | jq -r '.json' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Test 4: Different HTTP Methods
echo -e "${BOLD}${CYAN}[Test 4] Testing Different HTTP Methods${NC}\n"

echo -e "${YELLOW}PUT Request:${NC}"
curl -x $PROXY -k -s -X PUT -d '{"status":"updated"}' https://httpbin.org/put | jq -r '.url' 2>/dev/null || echo "Response received"
sleep 1

echo -e "${YELLOW}DELETE Request:${NC}"
curl -x $PROXY -k -s -X DELETE https://httpbin.org/delete | jq -r '.url' 2>/dev/null || echo "Response received"
sleep 1

echo -e "${YELLOW}PATCH Request:${NC}"
curl -x $PROXY -k -s -X PATCH -d '{"field":"value"}' https://httpbin.org/patch | jq -r '.url' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ All methods tested${NC}\n"
sleep 2

# Test 5: Custom Headers
echo -e "${BOLD}${CYAN}[Test 5] Request with Custom Headers${NC}"
echo -e "${YELLOW}Command:${NC} curl with custom headers"
echo -e "${YELLOW}Expected:${NC} Headers visible in request inspector\n"
curl -x $PROXY -k -s \
  -H "X-Custom-Header: TestValue" \
  -H "X-Request-ID: $(uuidgen 2>/dev/null || echo 'test-123')" \
  -H "Authorization: Bearer fake-token-12345" \
  https://httpbin.org/headers | jq -r '.headers' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Test 6: Query Parameters
echo -e "${BOLD}${CYAN}[Test 6] Request with Query Parameters${NC}"
echo -e "${YELLOW}Command:${NC} curl with URL parameters"
echo -e "${YELLOW}Expected:${NC} Parameters visible in URL\n"
curl -x $PROXY -k -s \
  "https://httpbin.org/get?search=network&type=interceptor&test=true" | jq -r '.args' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Test 7: Real API - GitHub
echo -e "${BOLD}${CYAN}[Test 7] Real API Request - GitHub${NC}"
echo -e "${YELLOW}Command:${NC} curl to GitHub API"
echo -e "${YELLOW}Expected:${NC} Should intercept API request\n"
curl -x $PROXY -k -s \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/users/octocat | jq -r '.login, .public_repos' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Test 8: JSONPlaceholder API
echo -e "${BOLD}${CYAN}[Test 8] Real API Request - JSONPlaceholder${NC}"
echo -e "${YELLOW}Command:${NC} curl to JSONPlaceholder API"
echo -e "${YELLOW}Expected:${NC} Should show in traffic log\n"
curl -x $PROXY -k -s https://jsonplaceholder.typicode.com/posts/1 | jq -r '.title' 2>/dev/null || echo "Response received"
echo -e "${GREEN}✓ Test completed${NC}\n"
sleep 2

# Summary
echo -e "\n${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║              All Tests Completed! ✓                      ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}\n"

echo -e "${CYAN}Check the web interface at http://localhost:3000 to see:${NC}"
echo "  • All captured requests in the sidebar"
echo "  • Request/response details for each call"
echo "  • Different HTTP methods color-coded"
echo "  • Full headers and body content"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Open http://localhost:3000 in your browser"
echo "  2. Click on any request to see full details"
echo "  3. Try setting breakpoints for specific URLs"
echo "  4. Test response mappings with mock files"
echo ""
