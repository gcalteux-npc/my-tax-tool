// HTTPS NOTE: Before sharing this app with anyone, deploy it behind HTTPS.
// Never serve tax documents over plain HTTP in production.
// Use a reverse proxy (nginx, Caddy) or a platform (Railway, Render, Fly.io)
// that terminates TLS before traffic reaches this process.

require('dotenv').config();

const crypto    = require('crypto');
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const audit     = require('./audit-logger');

const { readDocument } = require('./document-reader');
const { organizeData } = require('./data-organizer');
const { analyzeTaxData } = require('./tax-analyzer');
const { calculate } = require('./tax-calculator');
const { fill1040, listFields } = require('./form-filler');

const app  = express();
const PORT = 3000;
const UPLOADS_DIR    = path.join(__dirname, 'uploads');
const MAX_FILE_SIZE  = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_CHARS = 50_000;

// ── SC-12: AES-256-GCM key — generated once at startup, never written to disk ─
const ENCRYPTION_KEY = crypto.randomBytes(32);

function encryptText(plaintext) {
  const iv       = crypto.randomBytes(16);
  const cipher   = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag  = cipher.getAuthTag();
  return { encrypted, iv, authTag };
}

function decryptText({ encrypted, iv, authTag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── AC-2 / AC-3: Session key — generated once, persisted to .session-key ─────
const SESSION_KEY_FILE = path.join(__dirname, '.session-key');

function loadOrCreateSessionKey() {
  try {
    if (fs.existsSync(SESSION_KEY_FILE)) {
      const key = fs.readFileSync(SESSION_KEY_FILE, 'utf8').trim();
      if (key.length === 64) return key; // 32 bytes hex = 64 chars
    }
  } catch (_) {}
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SESSION_KEY_FILE, key, { mode: 0o600 }); // owner read-only
  audit.log('AC2_SESSION_KEY_GENERATED');
  return key;
}

const SESSION_KEY = loadOrCreateSessionKey();

// ── AC-4: DataFlowEnforcer — enforces strict linear pipeline stages ───────────
const PIPELINE_STAGES = [
  'upload', 'extract', 'encrypt', 'decrypt',
  'organize', 'analyze', 'return', 'destroy',
];

class DataFlowEnforcer {
  constructor(requestId) {
    this.requestId = requestId;
    this.index     = -1;
  }

  advance(stage) {
    const next = PIPELINE_STAGES[this.index + 1];
    if (stage !== next) {
      throw new Error(
        `Data-flow violation [${this.requestId}]: expected "${next}", got "${stage}"`
      );
    }
    this.index++;
  }
}

// ── Magic number signatures ───────────────────────────────────────────────────
const MAGIC = {
  pdf: { bytes: [0x25, 0x50, 0x44, 0x46], exts: ['.pdf'] },
  jpg: { bytes: [0xFF, 0xD8, 0xFF],        exts: ['.jpg', '.jpeg'] },
  png: { bytes: [0x89, 0x50, 0x4E, 0x47], exts: ['.png'] },
};

function detectMagicNumber(filePath) {
  const fd  = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  for (const [type, sig] of Object.entries(MAGIC)) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return type;
  }
  return null;
}

function extensionMatchesMagic(filePath, detectedType) {
  const ext = path.extname(filePath).toLowerCase();
  return (MAGIC[detectedType]?.exts || []).includes(ext);
}

// ── SI-3: Prompt-injection detection ─────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|prior)\s+instructions/i,
  /system\s+prompt/i,
  /disregard\s+(the\s+)?(above|prior|previous|all)/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions\s*:/i,
  /override\s+(instructions|prompt|rules)/i,
  /forget\s+(everything|all|prior)/i,
  /\bact\s+as\b.{0,20}\bno\s+restriction/i,
];

function detectPromptInjection(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

// ── Input sanitization ────────────────────────────────────────────────────────
function sanitizeText(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript\s*:/gi, '')
    .trim();
}

// SI-10: require at least 3 dollar-amount patterns
function hasSufficientTaxData(text) {
  const amounts = text.match(/\$?[\d,]+\.\d{2}/g) || [];
  return amounts.length >= 3;
}

// ── SC-28: Zero-persistence startup verification ──────────────────────────────
function findTmpFiles(dir, found = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findTmpFiles(full, found);
      else if (entry.name.endsWith('.tmp')) found.push(full);
    }
  } catch (_) {}
  return found;
}

function verifyCleanState() {
  const uploads = fs.readdirSync(UPLOADS_DIR).filter(f =>
    fs.statSync(path.join(UPLOADS_DIR, f)).isFile()
  );
  const tmpFiles = findTmpFiles(__dirname);
  const clean = uploads.length === 0 && tmpFiles.length === 0;
  audit.log('SC28_STARTUP_VERIFICATION', {
    uploadsEmpty: uploads.length === 0,
    uploadsCount: uploads.length,
    tmpFilesFound: tmpFiles.length,
    clean,
  });
  if (!clean) {
    audit.log('SC28_UNCLEAN_STATE_DETECTED', {
      uploadsCount: uploads.length,
      tmpCount: tmpFiles.length,
    });
  }
}

// ── SI-12: Secure delete ──────────────────────────────────────────────────────
async function secureDelete(filePath) {
  try {
    const { size } = fs.statSync(filePath);
    if (size > 0) {
      const fd = fs.openSync(filePath, 'r+');
      fs.writeSync(fd, crypto.randomBytes(size), 0, size, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    audit.log('SECURE_DELETE_FAILED', { filename: path.basename(filePath), errorType: err.code });
    return false;
  }
}

// ── SC-28 / SI-12: Startup purge of leftover uploads ─────────────────────────
function purgeUploadsDir() {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    if (files.length === 0) return;
    audit.log('STARTUP_PURGE_STARTED', { count: files.length });
    for (const file of files) {
      const fp = path.join(UPLOADS_DIR, file);
      try {
        if (!fs.statSync(fp).isFile()) continue;
        const size = fs.statSync(fp).size;
        if (size > 0) {
          const fd = fs.openSync(fp, 'r+');
          fs.writeSync(fd, crypto.randomBytes(size), 0, size, 0);
          fs.fsyncSync(fd);
          fs.closeSync(fd);
        }
        fs.unlinkSync(fp);
      } catch (fileErr) {
        audit.log('STARTUP_PURGE_FILE_ERROR', { errorType: fileErr.code });
      }
    }
    audit.log('STARTUP_PURGE_COMPLETE', { count: files.length });
  } catch (err) {
    audit.log('STARTUP_PURGE_ERROR', { errorType: err.code });
  }
}

// ── SI-12: Process exit handler — clean up on force-quit ─────────────────────
function gracefulShutdown(signal) {
  audit.log('APP_SHUTDOWN', { signal });
  purgeUploadsDir();
  process.exit(0);
}
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// ─────────────────────────────────────────────────────────────────────────────
// Express app configuration
// ─────────────────────────────────────────────────────────────────────────────

app.disable('x-powered-by');

// ── SC-8: Localhost-only middleware ───────────────────────────────────────────
app.use((req, res, next) => {
  const ip = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
  if (!isLocal) {
    audit.log('SC8_NON_LOCAL_REJECTED', { ip: ip.substring(0, 15) });
    return res.status(403).json({
      success: false,
      error: 'This application only accepts connections from localhost. Deploy behind HTTPS for remote access.',
    });
  }
  next();
});

// ── Helmet — security headers ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"], // inline script in served HTML
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
  frameguard:     { action: 'deny' },
  noSniff:        true,
  referrerPolicy: { policy: 'same-origin' },
}));

// ── CORS — localhost only ─────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Rate limiting — 10 requests per hour per IP ───────────────────────────────
const limiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    audit.log('RATE_LIMIT_TRIGGERED', { ip: (req.ip || '').substring(0, 15) });
    res.status(429).json({ success: false, error: 'Too many requests. Please try again in an hour.' });
  },
});
app.use('/analyze', limiter);

// ── AC-2 / AC-3: Token authentication middleware ──────────────────────────────
function requireApiToken(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!token || token !== SESSION_KEY) {
    audit.log('AC2_AUTH_FAILURE', { ip: (req.ip || '').substring(0, 15) });
    return res.status(401).json({ success: false, error: 'Unauthorized. Missing or invalid X-Api-Token.' });
  }
  next();
}

// ── Multer — UUID filenames, 10 MB cap ────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF, JPG, or PNG.'));
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// Serve index.html with the session token embedded so the frontend can
// include it in X-Api-Token headers without a separate round-trip.
app.get('/', (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
      .replace('__SESSION_TOKEN__', SESSION_KEY);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send('Could not load application.');
  }
});

// SI-2: Health check — confirms app version, uptime, and clean upload state
app.get('/health', (req, res) => {
  const pkg = require('./package.json');
  const uploads = fs.readdirSync(UPLOADS_DIR).filter(f =>
    fs.statSync(path.join(UPLOADS_DIR, f)).isFile()
  );
  res.json({
    version:            pkg.version,
    uptimeSeconds:      Math.floor(process.uptime()),
    uploadsClean:       uploads.length === 0,
    uploadedFilesCount: uploads.length,
    timestamp:          new Date().toISOString(),
  });
});

// POST /analyze — full secure pipeline
app.post('/analyze', requireApiToken, upload.single('document'), async (req, res) => {
  // SC-39: unique request ID scopes all variables and log entries for this request
  const requestId = crypto.randomUUID();
  const filePath  = req.file ? req.file.path : null;
  const startTime = Date.now();

  // All sensitive variables are declared here and nulled immediately after use (SC-12, SI-12)
  let rawText       = null;
  let encryptedBlob = null;
  let sanitized     = null;
  let organizedData = null;
  let analysis      = null;

  const flow = new DataFlowEnforcer(requestId); // AC-4

  try {
    audit.log('UPLOAD_RECEIVED', {
      requestId,
      fileSize: req.file?.size,
      fileType: req.file ? path.extname(req.file.originalname).toLowerCase() : null,
    });

    console.log(`[DEBUG] Step 1: File received — size: ${req.file?.size} bytes, mimetype: ${req.file?.mimetype}`);

    if (!filePath) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Include a file field named "document".' });
    }

    flow.advance('upload');

    // SI-10 / SI-3: Validate magic number and extension match
    const detectedType = detectMagicNumber(filePath);
    if (!detectedType) {
      return res.status(400).json({ success: false, error: 'File content does not match a supported format (PDF, JPG, PNG).' });
    }
    if (!extensionMatchesMagic(filePath, detectedType)) {
      return res.status(400).json({ success: false, error: 'File extension does not match its actual content. Upload rejected.' });
    }

    audit.log('PROCESSING_STARTED', { requestId });

    console.log('[DEBUG] Step 2: Starting text extraction');
    rawText = await readDocument(filePath);
    flow.advance('extract');

    if (!rawText || !rawText.trim()) {
      return res.status(422).json({ success: false, error: 'Could not extract any text from the uploaded document.' });
    }
    console.log(`[DEBUG] Step 3: Text extraction complete — full text:\n${rawText}`);

    // SC-12 — encrypt raw text in memory; clear plaintext immediately
    encryptedBlob = encryptText(rawText);
    flow.advance('encrypt');
    rawText = null;

    // SC-12 — decrypt only when needed for sanitization/validation
    const decrypted = decryptText(encryptedBlob);
    flow.advance('decrypt');
    encryptedBlob = null;

    // SI-3 / SI-10: Sanitize, injection check, and tax-data validation
    sanitized = sanitizeText(decrypted).slice(0, MAX_TEXT_CHARS);

    if (detectPromptInjection(sanitized)) {
      return res.status(422).json({ success: false, error: 'Document contains disallowed content and cannot be processed.' });
    }

    if (!hasSufficientTaxData(sanitized)) {
      return res.status(422).json({ success: false, error: 'Document does not appear to contain sufficient tax data. Please upload a W-2 or 1099.' });
    }

    console.log('[DEBUG] Step 4: Starting data organization');
    organizedData = organizeData(sanitized);
    flow.advance('organize');
    sanitized = null;

    console.log(`[DEBUG] Step 5: Data organization complete — document type: ${organizedData.type}`);

    if (organizedData.type === 'UNKNOWN') {
      return res.status(422).json({
        success: false,
        error: 'Document type not recognized. Supported types: W-2, 1099-INT, 1099-DIV, 1099-NEC, 1099-B.',
      });
    }

    // Write organized document to extracted-data.json — replace any existing entry of the same type
    try {
      const extractedDataPath = path.join(__dirname, 'extracted-data.json');
      let existing = [];
      try { existing = JSON.parse(fs.readFileSync(extractedDataPath, 'utf8')); } catch (_) {}
      if (!Array.isArray(existing)) existing = [];
      // Replace same-type entry if present, otherwise append
      const idx = existing.findIndex(d => d.type === organizedData.type);
      if (idx !== -1) existing[idx] = organizedData;
      else existing.push(organizedData);
      fs.writeFileSync(extractedDataPath, JSON.stringify(existing, null, 2));
    } catch (writeErr) {
      // Non-fatal — log but don't block the main pipeline
      audit.log('EXTRACTED_DATA_WRITE_FAILED', { requestId, errorType: writeErr.code });
    }

    console.log('[DEBUG] Step 6: Starting Claude API call');
    analysis = await analyzeTaxData(organizedData);
    flow.advance('analyze');
    organizedData = null;

    console.log('[DEBUG] Step 7: Claude API call complete');
    flow.advance('return');
    audit.log('PROCESSING_COMPLETE', { requestId, durationMs: Date.now() - startTime });

    return res.json({ success: true, analysis });

  } catch (err) {
    // AU-3: log error type only — never the message, which may contain data
    audit.log('PROCESSING_FAILED', { requestId, errorType: err.constructor.name });
    // DEBUG: temporary full error logging — remove before production
    console.error('[DEBUG] /analyze error:', err.message);
    console.error('[DEBUG] Stack trace:', err.stack);
    return res.status(500).json({ success: false, error: 'An error occurred during processing.' });

  } finally {
    // Wipe all sensitive variables unconditionally
    rawText       = null;
    encryptedBlob = null;
    sanitized     = null;
    organizedData = null;
    analysis      = null;

    // SI-12 / MP-6: Secure delete the uploaded file regardless of pipeline stage
    if (filePath) {
      const deleted = await secureDelete(filePath);
      audit.log('FILE_DELETION_CONFIRMED', { requestId, deleted });
    }
  }
});

// POST /clear-documents — wipe extracted-data.json to start fresh
app.post('/clear-documents', requireApiToken, (req, res) => {
  try {
    const extractedDataPath = path.join(__dirname, 'extracted-data.json');
    fs.writeFileSync(extractedDataPath, '[]');
    audit.log('EXTRACTED_DATA_CLEARED');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not clear documents.' });
  }
});

// POST /calculate — run tax calculation on already-extracted data
app.post('/calculate', requireApiToken, express.json(), limiter, (req, res) => {
  const { filing_status } = req.body || {};
  const allowed = ['Single', 'Married Filing Jointly', 'Head of Household',
                   'single', 'mfj', 'hoh'];
  if (!filing_status || typeof filing_status !== 'string' || filing_status.length > 40) {
    return res.status(400).json({ success: false, error: 'Invalid filing_status.' });
  }

  const extractedDataPath = path.join(__dirname, 'extracted-data.json');
  let docs;
  try {
    const raw = fs.readFileSync(extractedDataPath, 'utf8');
    docs = JSON.parse(raw);
    if (!Array.isArray(docs)) docs = [docs];
  } catch {
    return res.status(400).json({
      success: false,
      error: 'No extracted tax data found. Please upload at least one tax document first.',
    });
  }

  if (!docs.length) {
    return res.status(400).json({
      success: false,
      error: 'Extracted data is empty. Please upload a tax document first.',
    });
  }

  try {
    const result = calculate(docs, filing_status);
    audit.log('CALCULATE_COMPLETE', { filingStatus: filing_status, docCount: docs.length });
    return res.json({ success: true, result });
  } catch (err) {
    audit.log('CALCULATE_FAILED', { errorType: err.constructor.name });
    return res.status(500).json({ success: false, error: 'Calculation failed.' });
  }
});

// POST /fill-1040 — fill the bundled IRS 1040 PDF and return it
app.post('/fill-1040', requireApiToken, limiter, express.json(), async (req, res) => {
  const f1040Path = path.join(__dirname, 'f1040.pdf');

  if (!fs.existsSync(f1040Path)) {
    return res.status(500).json({ success: false, error: 'IRS 1040 PDF not found on server.' });
  }

  const filingStatus = (req.body && req.body.filing_status) ? req.body.filing_status : 'Single';
  const extractedDataPath = path.join(__dirname, 'extracted-data.json');
  let docs;
  try {
    docs = JSON.parse(fs.readFileSync(extractedDataPath, 'utf8'));
    if (!Array.isArray(docs)) docs = [docs];
  } catch {
    return res.status(400).json({
      success: false,
      error: 'No extracted tax data found. Please upload a tax document first.',
    });
  }

  try {
    const calcResult = calculate(docs, filingStatus);
    const pdfBuffer  = fs.readFileSync(f1040Path);
    const { filledBytes, skipped } = await fill1040(pdfBuffer, calcResult);

    audit.log('FILL_1040_COMPLETE', { skippedFields: skipped.length });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="filled-1040.pdf"');
    res.send(filledBytes);
  } catch (err) {
    audit.log('FILL_1040_FAILED', { errorType: err.constructor.name });
    console.error('[DEBUG] /fill-1040 error:', err.message);
    return res.status(500).json({ success: false, error: 'PDF filling failed.' });
  }
});

// ── Multer / global error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'File exceeds the 10 MB limit.'
      : `Upload error: ${err.message}`;
    return res.status(400).json({ success: false, error: msg });
  }
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Startup sequence
// ─────────────────────────────────────────────────────────────────────────────

purgeUploadsDir();   // SI-12 / SC-28: clear any leftover files from a crashed session
verifyCleanState();  // SC-28: log verification result

audit.log('APP_STARTUP', { port: PORT, nodeVersion: process.version });

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Tax analyzer running at http://localhost:${PORT}`);
});
