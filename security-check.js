// RA-5 Vulnerability Scanning
// Run with: npm run security-check
// Verifies that critical security dependencies are present and runs npm audit.

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

let passed = 0;
let failed = 0;

function pass(msg) {
  console.log(`  [PASS] ${msg}`);
  passed++;
}

function fail(msg) {
  console.error(`  [FAIL] ${msg}`);
  failed++;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
}

// ── 1. Required security packages ────────────────────────────────────────────
section('Required security packages');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

const required = [
  { name: 'helmet',              reason: 'HTTP security headers (SC-8, SC-28)' },
  { name: 'express-rate-limit',  reason: 'Rate limiting (AC-3)' },
  { name: 'dotenv',              reason: 'Env-based secret management (AC-2)' },
  { name: '@anthropic-ai/sdk',   reason: 'Claude API client' },
  { name: 'multer',              reason: 'File upload handling (SI-10)' },
];

for (const { name, reason } of required) {
  if (deps[name]) {
    pass(`${name} (${deps[name]}) — ${reason}`);
  } else {
    fail(`${name} is NOT listed in package.json — ${reason}`);
  }
}

// ── 2. Critical files present ─────────────────────────────────────────────────
section('Critical files present');

const criticalFiles = [
  ['.env',             'API key config'],
  ['.gitignore',       'Secrets exclusion'],
  ['.session-key',     'Session auth token'],
  ['audit-logger.js',  'Audit logging (AU-2)'],
  ['server.js',        'Main server'],
];

for (const [file, desc] of criticalFiles) {
  const exists = fs.existsSync(path.join(__dirname, file));
  if (exists) {
    pass(`${file} exists — ${desc}`);
  } else {
    fail(`${file} is MISSING — ${desc}`);
  }
}

// ── 3. .gitignore entries ────────────────────────────────────────────────────
section('.gitignore entries');

let gitignoreContent = '';
try {
  gitignoreContent = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
} catch (_) {
  fail('.gitignore not readable');
}

const gitignoreRequired = [
  ['.env',          'API key must not be committed'],
  ['uploads/',      'Uploaded tax documents must not be committed'],
  ['.session-key',  'Session token must not be committed'],
  ['audit.log',     'Audit log must not be committed'],
];

for (const [entry, reason] of gitignoreRequired) {
  if (gitignoreContent.includes(entry)) {
    pass(`${entry} is gitignored — ${reason}`);
  } else {
    fail(`${entry} is NOT in .gitignore — ${reason}`);
  }
}

// ── 4. uploads folder is empty ───────────────────────────────────────────────
section('Zero-persistence state check');

const uploadsDir = path.join(__dirname, 'uploads');
try {
  const files = fs.readdirSync(uploadsDir).filter(f =>
    fs.statSync(path.join(uploadsDir, f)).isFile()
  );
  if (files.length === 0) {
    pass('uploads/ folder is empty — no tax documents at rest');
  } else {
    fail(`uploads/ contains ${files.length} file(s) — possible data leak`);
  }
} catch (_) {
  fail('uploads/ directory not found');
}

// ── 5. npm audit ─────────────────────────────────────────────────────────────
section('npm audit');

try {
  const result = execSync('npm audit --json 2>/dev/null', {
    cwd: __dirname,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const audit = JSON.parse(result);
  const vulns = audit.metadata?.vulnerabilities || {};
  const critical = vulns.critical || 0;
  const high     = vulns.high     || 0;
  const moderate = vulns.moderate || 0;
  const low      = vulns.low      || 0;
  const total    = (audit.metadata?.totalDependencies) || '?';

  if (critical > 0) {
    fail(`${critical} CRITICAL vulnerabilities found — fix immediately`);
  } else {
    pass(`No critical vulnerabilities (${total} packages scanned)`);
  }

  if (high > 0) {
    fail(`${high} HIGH severity vulnerabilities found`);
  } else {
    pass('No high severity vulnerabilities');
  }

  if (moderate > 0) {
    console.log(`  [WARN] ${moderate} moderate, ${low} low severity vulnerabilities`);
  } else {
    pass('No moderate/low vulnerabilities');
  }
} catch (err) {
  // npm audit exits non-zero when it finds issues
  try {
    const audit = JSON.parse(err.stdout || '{}');
    const vulns = audit.metadata?.vulnerabilities || {};
    const critical = vulns.critical || 0;
    const high     = vulns.high     || 0;
    if (critical > 0) fail(`${critical} CRITICAL vulnerabilities — run: npm audit fix`);
    if (high     > 0) fail(`${high} HIGH vulnerabilities — run: npm audit fix`);
    if (critical === 0 && high === 0) pass('No critical/high vulnerabilities');
  } catch (_) {
    fail(`npm audit could not be parsed: ${err.message}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(54)}`);
console.log(`  Security check complete: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(54)}\n`);

if (failed > 0) {
  process.exit(1);
}
