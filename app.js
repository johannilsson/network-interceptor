let ws;
let trafficData = [];
let selectedRequest = null;
let currentTab = 'overview';
let breakpointRequest = null;
let breakpoints = new Map();
let mappings = new Map();

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
    case 'breakpointSet':
      console.log('Breakpoint set:', data.pattern);
      break;
    case 'breakpointRemoved':
      console.log('Breakpoint removed:', data.pattern);
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
    dot.style.background = 'var(--accent-primary)';
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
      <div class="traffic-item ${isSelected ? 'selected' : ''}" onclick="selectRequest(${trafficData.indexOf(entry)})">
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

function renderDetailPanel() {
  const content = document.getElementById('detailContent');
  
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
  
  if (currentTab === 'overview') {
    content.innerHTML = `
      <div class="detail-section">
        <h3>Request</h3>
        <div class="detail-grid">
          <div class="detail-label">Method:</div>
          <div class="detail-value">${request.method}</div>
          <div class="detail-label">URL:</div>
          <div class="detail-value">${request.url}</div>
          <div class="detail-label">Protocol:</div>
          <div class="detail-value">${request.protocol.toUpperCase()}</div>
          <div class="detail-label">Time:</div>
          <div class="detail-value">${new Date(request.timestamp).toLocaleString()}</div>
        </div>
      </div>
      
      ${response ? `
        <div class="detail-section">
          <h3>Response</h3>
          <div class="detail-grid">
            <div class="detail-label">Status:</div>
            <div class="detail-value ${getStatusClass(response.status)}">${response.status} ${response.statusText}</div>
            <div class="detail-label">Time:</div>
            <div class="detail-value">${new Date(response.timestamp).toLocaleString()}</div>
            ${response.mapped ? '<div class="detail-label">Source:</div><div class="detail-value" style="color: var(--accent-warning)">Mapped Response</div>' : ''}
            ${response.custom ? '<div class="detail-label">Source:</div><div class="detail-value" style="color: var(--accent-tertiary)">Custom Response</div>' : ''}
          </div>
        </div>
      ` : '<div class="detail-section"><h3>Response</h3><p style="color: var(--text-dim);">Pending...</p></div>'}
    `;
  } else if (currentTab === 'request') {
    const headersHtml = Object.entries(request.headers)
      .map(([key, value]) => `<div class="detail-label">${key}:</div><div class="detail-value">${value}</div>`)
      .join('');
    
    const bodyText = request.body ? 
      (typeof request.body === 'string' ? request.body : tryFormatJSON(request.body)) : 
      'No body';
    
    content.innerHTML = `
      <div class="detail-section">
        <h3>Headers</h3>
        <div class="detail-grid">${headersHtml}</div>
      </div>
      
      <div class="detail-section">
        <h3>Body</h3>
        <div class="code-block">${escapeHtml(bodyText)}</div>
      </div>
    `;
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
    
    const headersHtml = Object.entries(response.headers)
      .map(([key, value]) => `<div class="detail-label">${key}:</div><div class="detail-value">${value}</div>`)
      .join('');
    
    const bodyText = response.body ? 
      (typeof response.body === 'string' ? response.body : tryFormatJSON(response.body)) : 
      'No body';
    
    content.innerHTML = `
      <div class="detail-section">
        <h3>Headers</h3>
        <div class="detail-grid">${headersHtml}</div>
      </div>
      
      <div class="detail-section">
        <h3>Body</h3>
        <div class="code-block">${escapeHtml(bodyText)}</div>
      </div>
    `;
  }
}

function tryFormatJSON(data) {
  try {
    if (Buffer.isBuffer(data)) {
      const str = data.toString('utf8');
      const parsed = JSON.parse(str);
      return JSON.stringify(parsed, null, 2);
    }
    if (typeof data === 'object') {
      return JSON.stringify(data, null, 2);
    }
    const parsed = JSON.parse(data);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return data.toString();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  document.getElementById('breakpointsModal').classList.add('show');
  renderBreakpointList();
}

function openMappingsModal() {
  document.getElementById('mappingsModal').classList.add('show');
  renderMappingList();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

function addBreakpoint() {
  const pattern = document.getElementById('breakpointPattern').value.trim();
  if (!pattern) return;
  
  breakpoints.set(pattern, {});
  ws.send(JSON.stringify({
    type: 'setBreakpoint',
    pattern,
    config: {}
  }));
  
  document.getElementById('breakpointPattern').value = '';
  renderBreakpointList();
}

function removeBreakpoint(pattern) {
  breakpoints.delete(pattern);
  ws.send(JSON.stringify({
    type: 'removeBreakpoint',
    pattern
  }));
  renderBreakpointList();
}

function renderBreakpointList() {
  const list = document.getElementById('breakpointList');
  if (breakpoints.size === 0) {
    list.innerHTML = '<p style="color: var(--text-dim); margin-top: 1rem;">No breakpoints set</p>';
    return;
  }
  
  list.innerHTML = Array.from(breakpoints.keys()).map(pattern => `
    <li class="breakpoint-item">
      <span class="breakpoint-pattern">${escapeHtml(pattern)}</span>
      <button class="breakpoint-remove" onclick="removeBreakpoint('${escapeHtml(pattern)}')">Remove</button>
    </li>
  `).join('');
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
  
  details.innerHTML = `
    <div class="detail-section">
      <h3>Request Details</h3>
      <div class="detail-grid">
        <div class="detail-label">Method:</div>
        <div class="detail-value">${request.method}</div>
        <div class="detail-label">URL:</div>
        <div class="detail-value">${request.url}</div>
      </div>
    </div>
  `;
  
  modal.classList.add('show');
}

function continueRequest() {
  if (!breakpointRequest) return;
  
  ws.send(JSON.stringify({
    type: 'continue',
    requestId: breakpointRequest.id
  }));
  
  breakpointRequest = null;
  closeModal('breakpointActionModal');
  document.getElementById('customResponseBody').value = '';
  document.getElementById('customStatusCode').value = '';
}

function respondCustom() {
  if (!breakpointRequest) return;
  
  const body = document.getElementById('customResponseBody').value.trim();
  const status = parseInt(document.getElementById('customStatusCode').value) || 200;
  
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
  document.getElementById('customResponseBody').value = '';
  document.getElementById('customStatusCode').value = '';
}

// Close modal on background click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
    }
  });
});

// Initialize
initWebSocket();
