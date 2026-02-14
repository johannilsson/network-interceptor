#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SSL_PROXYING_FILE = path.join(__dirname, 'ssl-proxying.json');

function loadExisting() {
  try {
    const data = fs.readFileSync(SSL_PROXYING_FILE, 'utf8');
    const list = JSON.parse(data);
    const map = new Map();
    for (const entry of list) {
      map.set(entry.pattern, entry);
    }
    return map;
  } catch {
    return new Map();
  }
}

function importProxymanConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  let includeList;
  if (parsed.includeList) {
    // Direct format (proxyman_ssl_proxying_rules.config)
    includeList = parsed.includeList;
  } else if (parsed.sslProxyingData?.data) {
    // Base64-wrapped format (full Proxyman export)
    const decoded = JSON.parse(Buffer.from(parsed.sslProxyingData.data, 'base64').toString('utf8'));
    includeList = decoded.includeList || [];
  } else {
    console.error('Error: Unrecognized format — expected includeList or sslProxyingData.data');
    process.exit(1);
  }

  const existing = loadExisting();
  let imported = 0;

  for (const rule of includeList) {
    if (!rule.isEnabled) continue;

    const kindKey = typeof rule.kind === 'string' ? rule.kind : Object.keys(rule.kind)[0];
    if (kindKey === 'client') continue;

    let pattern, kind;
    if (kindKey === 'domain') {
      const domainEntry = rule.kind.domain?.[0];
      pattern = domainEntry?.url;
      kind = 'domain';
    } else if (kindKey === 'wildcard') {
      const wildcardEntry = rule.kind.wildcard?.[0];
      pattern = wildcardEntry?.wildcard;
      kind = 'wildcard';
    } else {
      continue;
    }

    if (!pattern) continue;

    if (kind === 'wildcard') {
      pattern = pattern.replace(/^https?:\/\//, '');
    }

    if (!existing.has(pattern)) {
      existing.set(pattern, {
        pattern,
        name: rule.name || undefined,
        enabled: true,
        kind,
        createdAt: new Date().toISOString()
      });
      imported++;
      console.log(`  + ${pattern} (${kind})`);
    } else {
      console.log(`  = ${pattern} (already exists, skipped)`);
    }
  }

  const list = Array.from(existing.values());
  fs.writeFileSync(SSL_PROXYING_FILE, JSON.stringify(list, null, 2), 'utf8');
  console.log(`\nImported ${imported} new rules. Total: ${list.length} rules in ${SSL_PROXYING_FILE}`);
}

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node import-proxyman.js <proxyman-config-file>');
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  console.error(`Error: File not found: ${configPath}`);
  process.exit(1);
}

importProxymanConfig(configPath);
