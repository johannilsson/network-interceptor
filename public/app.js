let ws;
let trafficData = [];
let selectedRequest = null;
let filteredTraffic = [];
let currentTab = 'headers';
let breakpointRequest = null;
let breakpoints = new Map();
let mappings = new Map();
let sslProxyingList = new Map();
let editingPattern = null;
let isRecording = false;

// Initialize WebSocket connection
function initWebSocket() {
  ws = new WebSocket(`ws://${window.location.host}`);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    updateStatusIndicator(true);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateStatusIndicator(false);
    setTimeout(initWebSocket, 2000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'traffic':
      addTrafficEntry(data.request, data.response);
      break;
    case 'breakpoint':
      handleBreakpoint(data.request);
      break;
    case 'breakpointResponse':
      handleBreakpointResponse(data);
      break;
    case 'breakpointSet':
      breakpoints.set(data.pattern, data.config);
      renderBreakpointList();
      console.log('Breakpoint set:', data.pattern);
      break;
    case 'breakpointRemoved':
      breakpoints.delete(data.pattern);
      renderBreakpointList();
      console.log('Breakpoint removed:', data.pattern);
      break;
    case 'breakpointToggled':
      if (data.config) {
        breakpoints.set(data.pattern, data.config);
        renderBreakpointList();
      }
      console.log('Breakpoint toggled:', data.pattern, data.enabled);
      break;
    case 'breakpointUpdated':
      if (data.oldPattern !== data.newPattern) {
        breakpoints.delete(data.oldPattern);
      }
      breakpoints.set(data.newPattern, data.config);
      renderBreakpointList();
      console.log('Breakpoint updated:', data.oldPattern, '->', data.newPattern);
      break;
    case 'breakpointsList':
      breakpoints.clear();
      for (const bp of data.breakpoints) {
        breakpoints.set(bp.pattern, bp);
      }
      renderBreakpointList();
      console.log('Loaded', data.breakpoints.length, 'breakpoints');
      break;
    case 'sslProxyingList':
      sslProxyingList.clear();
      for (const entry of data.patterns) {
        sslProxyingList.set(entry.pattern, entry);
      }
      renderSslProxyList();
      console.log('Loaded', data.patterns.length, 'SSL proxying patterns');
      break;
    case 'sslProxySet':
      sslProxyingList.set(data.pattern, data.config);
      renderSslProxyList();
      console.log('SSL proxy pattern added:', data.pattern);
      break;
    case 'sslProxyRemoved':
      sslProxyingList.delete(data.pattern);
      renderSslProxyList();
      console.log('SSL proxy pattern removed:', data.pattern);
      break;
    case 'sslProxyToggled':
      if (data.config) {
        sslProxyingList.set(data.pattern, data.config);
        renderSslProxyList();
      }
      console.log('SSL proxy toggled:', data.pattern, data.enabled);
      break;
    case 'recordingState':
      isRecording = data.recording;
      updateRecordButton();
      break;
    case 'recordingStarted':
      isRecording = true;
      updateRecordButton();
      break;
    case 'recordingStopped':
      isRecording = false;
      updateRecordButton();
      break;
    case 'error':
      console.error('WebSocket error:', data.message);
      alert('Error: ' + data.message);
      break;
    case 'mappingSet':
      console.log('Mapping set:', data.pattern);
      break;
    case 'mappingRemoved':
      console.log('Mapping removed:', data.pattern);
      break;
  }
}

function updateStatusIndicator(connected) {
  const indicator = document.querySelector('.status-indicator span');
  const dot = document.querySelector('.status-dot');
  if (connected) {
    indicator.textContent = 'PROXY ACTIVE';
    dot.style.background = 'var(--status-2xx)';
  } else {
    indicator.textContent = 'DISCONNECTED';
    dot.style.background = 'var(--accent-error)';
  }
}

function addTrafficEntry(request, response) {
  const entry = { request, response };
  trafficData.unshift(entry);
  
  // Limit to 1000 entries
  if (trafficData.length > 1000) {
    trafficData = trafficData.slice(0, 1000);
  }
  
  renderTrafficList();
}

function renderTrafficList() {
  const list = document.getElementById('trafficList');
  const filter = document.getElementById('filterInput').value.toLowerCase();
  
  const filtered = trafficData.filter(entry => 
    entry.request.url.toLowerCase().includes(filter)
  );
  
  filteredTraffic = filtered;

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⊗</div>
        <div class="empty-state-text">
          ${filter ? 'No matching requests' : 'Waiting for traffic...'}
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map((entry, index) => {
    const method = entry.request.method;
    const url = new URL(entry.request.url);
    const pathname = url.pathname + url.search;
    const status = entry.response?.status || 'pending';
    const statusClass = getStatusClass(status);
    const isSelected = selectedRequest?.request.id === entry.request.id;

    return `
      <div class="traffic-item ${isSelected ? 'selected' : ''}" data-filtered-index="${index}" onclick="selectRequest(${trafficData.indexOf(entry)})">
        <div>
          <span class="traffic-method method-${method}">${method}</span>
          <span class="traffic-url">${pathname}</span>
        </div>
        <div class="traffic-meta">
          <span>${url.hostname}</span>
          ${status !== 'pending' ? `<span class="traffic-status ${statusClass}">${status}</span>` : ''}
          <span>${formatTime(entry.request.timestamp)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function getStatusClass(status) {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  if (status >= 500) return 'status-5xx';
  return '';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function selectRequest(index) {
  selectedRequest = trafficData[index];
  renderTrafficList();
  renderDetailPanel();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.detail-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderDetailPanel();
}

function updateDetailSummary() {
  const summary = document.getElementById('detailSummary');
  if (!selectedRequest) {
    summary.classList.remove('visible');
    return;
  }

  const { request, response } = selectedRequest;
  summary.classList.add('visible');

  const methodEl = document.getElementById('summaryMethod');
  methodEl.textContent = request.method;
  methodEl.className = `traffic-method method-${request.method}`;

  const url = new URL(request.url);
  document.getElementById('summaryPath').textContent = url.pathname + url.search;
  document.getElementById('summaryUrl').textContent = request.url;

  // Tags (protocol, mapped/custom source)
  const tags = [];
  tags.push(`<span class="detail-summary-tag" style="background: rgba(138,135,128,0.12); color: var(--text-secondary);">${request.protocol.toUpperCase()}</span>`);
  if (response?.mapped) {
    tags.push(`<span class="detail-summary-tag" style="background: rgba(212,170,70,0.12); color: var(--accent-warning);">Mapped</span>`);
  }
  if (response?.custom) {
    tags.push(`<span class="detail-summary-tag" style="background: rgba(160,139,212,0.12); color: var(--accent-tertiary);">Custom</span>`);
  }
  if (request.tunneled) {
    tags.push(`<span class="detail-summary-tag" style="background: rgba(138,135,128,0.12); color: var(--text-secondary);">Tunneled</span>`);
    const host = new URL(request.url).hostname;
    if (!sslProxyingList.has(host)) {
      tags.push(`<button class="detail-summary-tag" onclick="enableSslProxying('${host}', event)" style="background: rgba(83,160,234,0.12); color: var(--accent-primary); cursor: pointer; border: none;">Enable SSL Proxying</button>`);
    }
  }
  document.getElementById('summaryTags').innerHTML = tags.join('');

  const statusEl = document.getElementById('summaryStatus');
  if (response) {
    statusEl.textContent = String(response.status);
    statusEl.style.color = response.status < 400 ? 'var(--status-2xx)' : response.status < 500 ? 'var(--status-4xx)' : 'var(--status-5xx)';
  } else {
    statusEl.textContent = '—';
    statusEl.style.color = '';
  }

  // Latency
  const latencyEl = document.getElementById('summaryLatency');
  if (response && response.timestamp && request.timestamp) {
    const ms = new Date(response.timestamp) - new Date(request.timestamp);
    latencyEl.textContent = ms + 'ms';
  } else {
    latencyEl.textContent = '—';
  }

  // Size
  const sizeEl = document.getElementById('summarySize');
  const contentLenHeader = response?.headers?.['content-length'];
  if (contentLenHeader) {
    const bytes = parseInt(contentLenHeader);
    sizeEl.textContent = bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
  } else if (response?.body) {
    const bytes = new Blob([response.body]).size;
    sizeEl.textContent = bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
  } else {
    sizeEl.textContent = '—';
  }

  // Content type
  const contentEl = document.getElementById('summaryContent');
  const ct = response?.headers?.['content-type'] || '';
  const shortType = ct.split(';')[0].split('/').pop() || '—';
  contentEl.textContent = shortType;
}

function renderDetailPanel() {
  const content = document.getElementById('detailContent');
  updateDetailSummary();

  if (!selectedRequest) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">◇</div>
        <div class="empty-state-text">Select a request to view details</div>
      </div>
    `;
    return;
  }

  const { request, response } = selectedRequest;

  if (currentTab === 'headers') {
    const reqHeadersHtml = Object.entries(request.headers)
      .map(([key, value]) => `<div class="detail-label">${escapeHtml(key)}</div><div class="detail-value">${escapeHtml(String(value))}</div>`)
      .join('');

    let resHeadersHtml = '';
    if (response) {
      resHeadersHtml = Object.entries(response.headers)
        .map(([key, value]) => `<div class="detail-label">${escapeHtml(key)}</div><div class="detail-value">${escapeHtml(String(value))}</div>`)
        .join('');
    }

    content.innerHTML = `
      <div class="detail-section">
        <h3>Request Headers</h3>
        <div class="detail-grid">${reqHeadersHtml}</div>
      </div>
      ${response ? `
        <div class="detail-section">
          <h3>Response Headers</h3>
          <div class="detail-grid">${resHeadersHtml}</div>
        </div>
      ` : ''}
    `;
  } else if (currentTab === 'request') {
    const bodyText = request.body || 'No body';
    const reqDecompressedLabel = request.bodyMeta?.wasDecompressed
      ? `<div style="color: var(--accent-warning); font-size: 11px; margin-bottom: 6px;">Decoded from ${escapeHtml(request.bodyMeta.originalEncoding)}</div>`
      : '';

    content.innerHTML = `
      <div class="detail-section">
        <h3>Body</h3>
        ${reqDecompressedLabel}
        <div class="code-block">${escapeHtml(bodyText)}</div>
      </div>
    `;
    highlightCodeBlocks(content, request.bodyMeta?.contentType || request.headers['content-type']);
  } else if (currentTab === 'response') {
    if (!response) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⧗</div>
          <div class="empty-state-text">Response pending...</div>
        </div>
      `;
      return;
    }

    const bodyText = response.body || 'No body';
    const resDecompressedLabel = response.bodyMeta?.wasDecompressed
      ? `<div style="color: var(--accent-warning); font-size: 11px; margin-bottom: 6px;">Decoded from ${escapeHtml(response.bodyMeta.originalEncoding)}</div>`
      : '';

    content.innerHTML = `
      <div class="detail-section">
        <h3>Body</h3>
        ${resDecompressedLabel}
        <div class="code-block">${escapeHtml(bodyText)}</div>
      </div>
    `;
    highlightCodeBlocks(content, response.bodyMeta?.contentType || response.headers['content-type']);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function detectLanguage(contentType) {
  if (!contentType) return null;
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'xml';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('javascript')) return 'javascript';
  if (ct.includes('css')) return 'css';
  return null;
}

function highlightCodeBlocks(container, contentType) {
  const block = container.querySelector('.code-block');
  if (!block || !window.hljs) return;
  const text = block.textContent;
  if (text === 'No body') return;

  const lang = detectLanguage(contentType);
  const codeEl = document.createElement('code');
  codeEl.textContent = text;
  if (lang) codeEl.className = 'language-' + lang;

  const preEl = document.createElement('pre');
  preEl.appendChild(codeEl);
  block.textContent = '';
  block.appendChild(preEl);

  hljs.highlightElement(codeEl);
}

function filterTraffic() {
  renderTrafficList();
}

function clearTraffic() {
  trafficData = [];
  selectedRequest = null;
  renderTrafficList();
  renderDetailPanel();
}

function downloadCert() {
  window.location.href = '/api/ca-cert';
}

// Modal functions
function openBreakpointsModal() {
  const modal = document.getElementById('breakpointsModal');
  if (!modal.classList.contains('show')) {
    resetBreakpointModal();
  }
  modal.classList.add('show');
  renderBreakpointList();
}

function openMappingsModal() {
  document.getElementById('mappingsModal').classList.add('show');
  renderMappingList();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
  if (modalId === 'breakpointsModal') {
    resetBreakpointModal();
  }
}

function resetBreakpointModal() {
  editingPattern = null;
  document.getElementById('breakpointsModalTitle').textContent = 'Breakpoints';
  document.getElementById('breakpointSubmitBtn').textContent = 'Add Breakpoint';
  document.getElementById('breakpointName').value = '';
  document.getElementById('breakpointPattern').value = '';
}

function addBreakpoint() {
  const pattern = document.getElementById('breakpointPattern').value.trim();
  const name = document.getElementById('breakpointName').value.trim();

  if (!pattern) {
    alert('URL Pattern is required');
    return;
  }

  if (editingPattern !== null) {
    // Edit mode
    const existingBreakpoint = breakpoints.get(editingPattern);
    ws.send(JSON.stringify({
      type: 'updateBreakpoint',
      oldPattern: editingPattern,
      newConfig: {
        pattern,
        name: name || undefined,
        enabled: existingBreakpoint?.enabled !== false
      }
    }));
  } else {
    // Add mode
    ws.send(JSON.stringify({
      type: 'setBreakpoint',
      pattern,
      config: {
        name: name || undefined,
        enabled: true
      }
    }));
  }

  // Reset modal to add mode
  resetBreakpointModal();
}

function removeBreakpoint(pattern) {
  if (!confirm('Are you sure you want to remove this breakpoint?')) {
    return;
  }

  breakpoints.delete(pattern);
  ws.send(JSON.stringify({
    type: 'removeBreakpoint',
    pattern
  }));
  renderBreakpointList();
}

function editBreakpoint(pattern) {
  const breakpoint = breakpoints.get(pattern);
  if (!breakpoint) return;

  editingPattern = pattern;
  document.getElementById('breakpointName').value = breakpoint.name || '';
  document.getElementById('breakpointPattern').value = breakpoint.pattern;
  document.getElementById('breakpointsModalTitle').textContent = 'Edit Breakpoint';
  document.getElementById('breakpointSubmitBtn').textContent = 'Update Breakpoint';

  // Make sure modal is open
  document.getElementById('breakpointsModal').classList.add('show');
}

function toggleBreakpoint(pattern) {
  const breakpoint = breakpoints.get(pattern);
  if (!breakpoint) return;

  const newEnabled = !breakpoint.enabled;

  ws.send(JSON.stringify({
    type: 'toggleBreakpoint',
    pattern,
    enabled: newEnabled
  }));
}

function renderBreakpointList() {
  const list = document.getElementById('breakpointList');
  if (breakpoints.size === 0) {
    list.innerHTML = '<p style="color: var(--text-dim); margin-top: 1rem;">No breakpoints set</p>';
    return;
  }

  list.innerHTML = Array.from(breakpoints.entries()).map(([pattern, config]) => {
    const isEnabled = config.enabled !== false;
    const displayName = config.name || config.pattern;
    const hasName = !!config.name;

    return `
      <li class="breakpoint-item ${!isEnabled ? 'breakpoint-disabled' : ''}">
        <div class="breakpoint-info">
          <div class="breakpoint-header">
            <span class="breakpoint-pattern">${escapeHtml(displayName)}</span>
            <span class="breakpoint-status-badge ${isEnabled ? 'active' : 'disabled'}">
              ${isEnabled ? 'ACTIVE' : 'DISABLED'}
            </span>
          </div>
          ${hasName ? `<div class="breakpoint-subtext">${escapeHtml(config.pattern)}</div>` : ''}
        </div>
        <div class="breakpoint-actions">
          <button class="breakpoint-edit" onclick="editBreakpoint('${escapeHtml(pattern)}')">Edit</button>
          <button class="breakpoint-toggle" onclick="toggleBreakpoint('${escapeHtml(pattern)}')">
            ${isEnabled ? 'Disable' : 'Enable'}
          </button>
          <button class="breakpoint-remove" onclick="removeBreakpoint('${escapeHtml(pattern)}')">Remove</button>
        </div>
      </li>
    `;
  }).join('');
}

function addMapping() {
  const pattern = document.getElementById('mappingPattern').value.trim();
  const filePath = document.getElementById('mappingFilePath').value.trim();
  if (!pattern || !filePath) return;
  
  mappings.set(pattern, filePath);
  ws.send(JSON.stringify({
    type: 'setMapping',
    pattern,
    filePath
  }));
  
  document.getElementById('mappingPattern').value = '';
  document.getElementById('mappingFilePath').value = '';
  renderMappingList();
}

function removeMapping(pattern) {
  mappings.delete(pattern);
  ws.send(JSON.stringify({
    type: 'removeMapping',
    pattern
  }));
  renderMappingList();
}

function renderMappingList() {
  const list = document.getElementById('mappingList');
  if (mappings.size === 0) {
    list.innerHTML = '<p style="color: var(--text-dim); margin-top: 1rem;">No mappings set</p>';
    return;
  }
  
  list.innerHTML = Array.from(mappings.entries()).map(([pattern, filePath]) => `
    <li class="breakpoint-item">
      <div>
        <div class="breakpoint-pattern">${escapeHtml(pattern)}</div>
        <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem;">${escapeHtml(filePath)}</div>
      </div>
      <button class="breakpoint-remove" onclick="removeMapping('${escapeHtml(pattern)}')">Remove</button>
    </li>
  `).join('');
}

function handleBreakpoint(request) {
  breakpointRequest = request;

  const modal = document.getElementById('breakpointActionModal');
  const details = document.getElementById('breakpointRequestDetails');

  // Show request phase UI
  document.getElementById('breakpointActionTitle').textContent = 'Breakpoint — Request';
  document.getElementById('breakpointRequestPhase').style.display = '';
  document.getElementById('breakpointResponsePhase').style.display = 'none';
  document.getElementById('breakpointRequestButtons').style.display = '';
  document.getElementById('breakpointResponseButtons').style.display = 'none';

  details.innerHTML = `
    <div class="detail-section">
      <h3>Request Details</h3>
      <div class="detail-grid">
        <div class="detail-label">Method</div>
        <div class="detail-value">${escapeHtml(request.method)}</div>
        <div class="detail-label">URL</div>
        <div class="detail-value">${escapeHtml(request.url)}</div>
      </div>
    </div>
  `;

  // Pre-fill request body
  const bodyText = request.body || '';
  document.getElementById('breakpointRequestBody').value = typeof bodyText === 'string' ? bodyText : '';

  modal.classList.add('show');
}

function handleBreakpointResponse(data) {
  breakpointRequest = data.request;

  const modal = document.getElementById('breakpointActionModal');
  const details = document.getElementById('breakpointRequestDetails');

  // Show response phase UI
  document.getElementById('breakpointActionTitle').textContent = 'Breakpoint — Response';
  document.getElementById('breakpointRequestPhase').style.display = 'none';
  document.getElementById('breakpointResponsePhase').style.display = '';
  document.getElementById('breakpointRequestButtons').style.display = 'none';
  document.getElementById('breakpointResponseButtons').style.display = '';

  const response = data.response;

  details.innerHTML = `
    <div class="detail-section">
      <h3>Response Details</h3>
      <div class="detail-grid">
        <div class="detail-label">URL</div>
        <div class="detail-value">${escapeHtml(data.request.url)}</div>
        <div class="detail-label">Status</div>
        <div class="detail-value">${escapeHtml(String(response.status))} ${escapeHtml(response.statusText || '')}</div>
      </div>
    </div>
  `;

  document.getElementById('breakpointResponseStatus').value = response.status;
  const bodyText = response.body || '';
  document.getElementById('breakpointResponseBody').value = typeof bodyText === 'string' ? bodyText : '';

  modal.classList.add('show');
}

function forwardRequest() {
  if (!breakpointRequest) return;

  const editedBody = document.getElementById('breakpointRequestBody').value;
  const customRequest = {};
  if (editedBody !== (breakpointRequest.body || '')) {
    customRequest.body = editedBody;
  }

  ws.send(JSON.stringify({
    type: 'continue',
    requestId: breakpointRequest.id,
    customRequest: Object.keys(customRequest).length > 0 ? customRequest : undefined
  }));

  // Don't close modal — wait for response phase
  // Reset request body field
  document.getElementById('breakpointRequestBody').value = '';

  // Show a waiting state
  document.getElementById('breakpointActionTitle').textContent = 'Waiting for response...';
  document.getElementById('breakpointRequestPhase').style.display = 'none';
  document.getElementById('breakpointRequestButtons').style.display = 'none';
  document.getElementById('breakpointRequestDetails').innerHTML = `
    <div class="detail-section">
      <h3>Request forwarded</h3>
      <p style="color: var(--text-dim); font-size: 12px;">Waiting for response from origin server...</p>
    </div>
  `;
}

function respondCustom() {
  if (!breakpointRequest) return;

  // Prompt for custom response inline — use the response phase fields
  document.getElementById('breakpointActionTitle').textContent = 'Breakpoint — Custom Response';
  document.getElementById('breakpointRequestPhase').style.display = 'none';
  document.getElementById('breakpointResponsePhase').style.display = '';
  document.getElementById('breakpointRequestButtons').style.display = 'none';
  document.getElementById('breakpointResponseButtons').style.display = 'none';

  document.getElementById('breakpointResponseStatus').value = '200';
  document.getElementById('breakpointResponseBody').value = '{"message": "Custom response"}';

  // Show a custom respond button
  const footer = document.querySelector('#breakpointActionModal .modal-footer');
  const customBtns = document.createElement('div');
  customBtns.id = 'breakpointCustomButtons';
  customBtns.innerHTML = `
    <button class="button primary" onclick="sendCustomResponse()">Send Custom Response</button>
  `;
  footer.appendChild(customBtns);
}

function sendCustomResponse() {
  if (!breakpointRequest) return;

  const body = document.getElementById('breakpointResponseBody').value;
  const status = parseInt(document.getElementById('breakpointResponseStatus').value) || 200;

  ws.send(JSON.stringify({
    type: 'respond',
    requestId: breakpointRequest.id,
    customResponse: {
      status,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: body || '{"message": "Custom response"}'
    }
  }));

  breakpointRequest = null;
  closeModal('breakpointActionModal');
  // Clean up custom buttons
  const customBtns = document.getElementById('breakpointCustomButtons');
  if (customBtns) customBtns.remove();
}

function sendResponse() {
  if (!breakpointRequest) return;

  const body = document.getElementById('breakpointResponseBody').value;
  const status = parseInt(document.getElementById('breakpointResponseStatus').value) || 200;

  ws.send(JSON.stringify({
    type: 'continueResponse',
    requestId: breakpointRequest.id,
    customResponse: {
      status,
      body
    }
  }));

  breakpointRequest = null;
  closeModal('breakpointActionModal');
}

// SSL Proxying functions
function enableSslProxying(hostname, event) {
  ws.send(JSON.stringify({ type: 'setSslProxy', pattern: hostname, config: { kind: 'domain', enabled: true } }));
  const btn = event.target;
  btn.textContent = 'Enabled — next request will be decrypted';
  btn.disabled = true;
  btn.style.cursor = 'default';
}

function openSslProxyingModal() {
  document.getElementById('sslProxyingModal').classList.add('show');
  renderSslProxyList();
}

function addSslProxy() {
  const pattern = document.getElementById('sslProxyPattern').value.trim();
  const kind = document.getElementById('sslProxyKind').value;
  if (!pattern) {
    alert('Domain pattern is required');
    return;
  }

  ws.send(JSON.stringify({
    type: 'setSslProxy',
    pattern,
    config: { kind, enabled: true }
  }));

  document.getElementById('sslProxyPattern').value = '';
}

function removeSslProxy(pattern) {
  ws.send(JSON.stringify({
    type: 'removeSslProxy',
    pattern
  }));
}

function toggleSslProxy(pattern) {
  const entry = sslProxyingList.get(pattern);
  if (!entry) return;

  ws.send(JSON.stringify({
    type: 'toggleSslProxy',
    pattern,
    enabled: !entry.enabled
  }));
}


function renderSslProxyList() {
  const list = document.getElementById('sslProxyList');
  if (!list) return;

  if (sslProxyingList.size === 0) {
    list.innerHTML = '<p style="color: var(--text-dim); margin-top: 1rem;">No patterns set — all HTTPS traffic is intercepted</p>';
    return;
  }

  list.innerHTML = Array.from(sslProxyingList.entries()).map(([pattern, config]) => {
    const isEnabled = config.enabled !== false;
    const kind = config.kind || 'wildcard';
    const displayName = config.name || config.pattern;
    const hasName = !!config.name;

    return `
      <li class="breakpoint-item ${!isEnabled ? 'breakpoint-disabled' : ''}">
        <div class="breakpoint-info">
          <div class="breakpoint-header">
            <span class="ssl-kind-badge ${kind}">${kind.toUpperCase()}</span>
            <span class="breakpoint-pattern">${escapeHtml(displayName)}</span>
            <span class="breakpoint-status-badge ${isEnabled ? 'active' : 'disabled'}">
              ${isEnabled ? 'ACTIVE' : 'DISABLED'}
            </span>
          </div>
          ${hasName ? `<div class="breakpoint-subtext">${escapeHtml(config.pattern)}</div>` : ''}
        </div>
        <div class="breakpoint-actions">
          <button class="breakpoint-toggle" onclick="toggleSslProxy('${escapeHtml(pattern)}')">
            ${isEnabled ? 'Disable' : 'Enable'}
          </button>
          <button class="breakpoint-remove" onclick="removeSslProxy('${escapeHtml(pattern)}')">Remove</button>
        </div>
      </li>
    `;
  }).join('');
}

// Recording functions
function updateRecordButton() {
  const btn = document.getElementById('recordBtn');
  if (!btn) return;
  if (isRecording) {
    btn.innerHTML = '<span class="record-dot recording"></span>Stop';
    btn.classList.add('recording');
  } else {
    btn.innerHTML = '<span class="record-dot"></span>Record';
    btn.classList.remove('recording');
  }
}

function toggleRecording() {
  ws.send(JSON.stringify({ type: isRecording ? 'stopRecording' : 'startRecording' }));
}

function openRecordingsModal() {
  const modal = document.getElementById('recordingsModal');
  modal.classList.add('show');
  fetchRecordings();
}

function fetchRecordings() {
  fetch('/api/recordings')
    .then(res => res.json())
    .then(recordings => renderRecordingsList(recordings))
    .catch(err => console.error('Failed to fetch recordings:', err));
}

function renderRecordingsList(recordings) {
  const list = document.getElementById('recordingsList');
  if (!list) return;

  if (recordings.length === 0) {
    list.innerHTML = '<p style="color: var(--text-dim); margin-top: 1rem;">No recordings yet</p>';
    return;
  }

  list.innerHTML = recordings.map(rec => {
    const date = new Date(rec.createdAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour12: false });
    const sizeStr = rec.size >= 1024 * 1024
      ? (rec.size / (1024 * 1024)).toFixed(1) + ' MB'
      : rec.size >= 1024
        ? (rec.size / 1024).toFixed(1) + ' KB'
        : rec.size + ' B';

    return `
      <li class="breakpoint-item">
        <div class="breakpoint-info">
          <div class="breakpoint-pattern">${escapeHtml(rec.filename)}</div>
          <div class="breakpoint-subtext">${dateStr} ${timeStr} — ${sizeStr}</div>
        </div>
        <div class="breakpoint-actions">
          <a class="breakpoint-edit" href="/api/recordings/${encodeURIComponent(rec.filename)}" download="${escapeHtml(rec.filename)}" style="text-decoration:none;">Download</a>
          <button class="breakpoint-remove" onclick="deleteRecording('${escapeHtml(rec.filename)}')">Delete</button>
        </div>
      </li>
    `;
  }).join('');
}

function deleteRecording(filename) {
  if (!confirm('Delete this recording?')) return;
  fetch('/api/recordings/' + encodeURIComponent(filename), { method: 'DELETE' })
    .then(res => res.json())
    .then(() => fetchRecordings())
    .catch(err => console.error('Failed to delete recording:', err));
}

// Keyboard navigation for traffic list
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal.show')) return;
  // Shortcuts (only when not in an input)
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    if (e.key === 's') {
      e.preventDefault();
      document.getElementById('filterInput').focus();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      clearTraffic();
      return;
    }
  }

  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

  const filterInput = document.getElementById('filterInput');
  const inFilter = e.target === filterInput;

  // Arrow Down from filter input: move focus to the list
  if (inFilter && e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredTraffic.length === 0) return;
    filterInput.blur();
    const firstIndex = selectedRequest
      ? filteredTraffic.findIndex(entry => entry.request.id === selectedRequest.request.id)
      : 0;
    const entry = filteredTraffic[firstIndex === -1 ? 0 : firstIndex];
    selectRequest(trafficData.indexOf(entry));
    const item = document.querySelector(`[data-filtered-index="${firstIndex === -1 ? 0 : firstIndex}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
    return;
  }

  // Ignore other keys while in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  e.preventDefault();
  if (filteredTraffic.length === 0) return;

  const currentIndex = selectedRequest
    ? filteredTraffic.findIndex(entry => entry.request.id === selectedRequest.request.id)
    : -1;

  // Arrow Up from first item: focus back to filter input
  if (e.key === 'ArrowUp' && currentIndex <= 0) {
    filterInput.focus();
    return;
  }

  let nextIndex;
  if (e.key === 'ArrowDown') {
    nextIndex = currentIndex < filteredTraffic.length - 1 ? currentIndex + 1 : currentIndex;
  } else {
    nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
  }

  const entry = filteredTraffic[nextIndex];
  selectRequest(trafficData.indexOf(entry));

  const item = document.querySelector(`[data-filtered-index="${nextIndex}"]`);
  if (item) item.scrollIntoView({ block: 'nearest' });
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.show').forEach(modal => {
      modal.classList.remove('show');
    });
  }
});

// Initialize
initWebSocket();
