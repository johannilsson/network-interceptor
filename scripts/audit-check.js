#!/usr/bin/env node
// Runs `npm audit` and fails on any advisory, at any severity, unless it is
// listed in audit-allowlist.json with an expiry date that has not yet passed.
const { spawnSync } = require('child_process');
const path = require('path');

const allowlist = require(path.join(__dirname, '..', 'audit-allowlist.json')).advisories;

// npm audit exits non-zero whenever it finds anything, so judge by the JSON.
const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
let report;
try {
  report = JSON.parse(result.stdout);
} catch (err) {
  console.error('Could not parse npm audit output:\n' + result.stdout + result.stderr);
  process.exit(1);
}
if (report.error) {
  console.error('npm audit failed: ' + JSON.stringify(report.error));
  process.exit(1);
}

// Collect each advisory once, with the packages it affects.
const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities || {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue; // a transitive "depends on" entry
    const id = via.url.split('/').pop();
    if (!advisories.has(id)) {
      advisories.set(id, { severity: via.severity, title: via.title, url: via.url, packages: new Set() });
    }
    advisories.get(id).packages.add(via.name);
  }
}

const today = new Date().toISOString().slice(0, 10);
const failures = [];
for (const [id, adv] of advisories) {
  const entry = allowlist[id];
  const label = `${id} (${adv.severity}) ${[...adv.packages].join(', ')}: ${adv.title}`;
  if (!entry) {
    failures.push(`${label}\n    ${adv.url}`);
  } else if (entry.expires < today) {
    failures.push(`${label}\n    allowlist entry expired on ${entry.expires}; re-review it`);
  } else {
    console.log(`allowed until ${entry.expires}: ${label}`);
  }
}

for (const id of Object.keys(allowlist)) {
  if (!advisories.has(id)) {
    console.log(`note: ${id} (${allowlist[id].package}) no longer reported; remove it from audit-allowlist.json`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} advisory(ies) not covered by audit-allowlist.json:\n`);
  for (const f of failures) console.error('  ' + f);
  console.error('\nRun `npm audit` for details. Fix them, or add a justified, dated entry to audit-allowlist.json.');
  process.exit(1);
}
console.log(`\nnpm audit: ${advisories.size} advisory(ies), all allowlisted.`);
