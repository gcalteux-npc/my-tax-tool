// AU-2 / AU-3 / AU-9 / AU-11
// Append-only audit logger. Never logs file contents, extracted text, or tax data.
// Auto-rotates at 1 MB; keeps a maximum of 3 rotated files.

const fs   = require('fs');
const path = require('path');

const LOG_PATH      = path.join(__dirname, 'audit.log');
const MAX_SIZE      = 1 * 1024 * 1024; // 1 MB
const MAX_ROTATIONS = 3;

// ── Log rotation ──────────────────────────────────────────────────────────────
function rotate() {
  // Shift existing rotations down: audit.log.3 deleted, .2→.3, .1→.2, log→.1
  for (let i = MAX_ROTATIONS; i >= 1; i--) {
    const older  = `${LOG_PATH}.${i}`;
    const newer  = i === 1 ? LOG_PATH : `${LOG_PATH}.${i - 1}`;
    try {
      if (fs.existsSync(older)) fs.unlinkSync(older);
      if (fs.existsSync(newer)) fs.renameSync(newer, older);
    } catch (err) {
      // Best-effort — do not throw; a rotation failure must not break the app
      process.stderr.write(`[audit-logger] rotation error: ${err.message}\n`);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Append a structured JSON audit entry.
 * @param {string} event   - Machine-readable event name (e.g. 'AUTH_FAILURE')
 * @param {object} details - Safe metadata only — NO file contents, text, or tax data
 */
function log(event, details = {}) {
  try {
    // Rotate before writing if the current log has reached the size limit
    try {
      const stat = fs.statSync(LOG_PATH);
      if (stat.size >= MAX_SIZE) rotate();
    } catch (_) {
      // File does not exist yet — no rotation needed
    }

    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...details,
    }) + '\n';

    // AU-9: open with 'a' flag only — never 'w' or 'r+'
    fs.appendFileSync(LOG_PATH, entry, { flag: 'a' });
  } catch (err) {
    // Audit failures must never crash the application
    process.stderr.write(`[audit-logger] write failed: ${err.message}\n`);
  }
}

module.exports = { log };
