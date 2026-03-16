# Security Controls — NIST 800-53

This document maps each implemented NIST SP 800-53 Rev. 5 security control to the
file and code that implements it, and explains in plain English what it protects against.

---

## AC-2 — Account Management
**File:** `server.js` — `loadOrCreateSessionKey()`, `requireApiToken()`
**Also:** `.session-key` (gitignored), `index.html` (`SESSION_TOKEN` injection)

On first startup the server generates a cryptographically random 32-byte (64-char hex)
token and writes it to `.session-key` with mode `0o600` (owner read-only). Every
subsequent request to `/analyze` must include this token in the `X-Api-Token` header or
it is rejected with HTTP 401. The token is embedded in the served HTML at page-load time
so the frontend sends it automatically. This prevents any other device or person on the
local network from submitting documents to the app.

---

## AC-3 — Access Enforcement
**File:** `server.js` — `requireApiToken()` middleware

The `requireApiToken` middleware enforces that only requests bearing the correct session
token can reach the `/analyze` endpoint. Failures are logged to `audit.log` with the
requestor's IP address.

---

## AC-4 — Information Flow Enforcement
**File:** `server.js` — `DataFlowEnforcer` class

A `DataFlowEnforcer` instance is created for every `/analyze` request and tracks
progress through eight required pipeline stages in order:
`upload → extract → encrypt → decrypt → organize → analyze → return → destroy`

If any stage is skipped, repeated, or executed out of order, the enforcer throws
immediately and the request is aborted. This prevents data from flowing backwards
through the pipeline or being retained past the `destroy` stage.

---

## AC-12 — Session Termination
**File:** `index.html` — inactivity timer

The frontend sets a 15-minute inactivity timer that resets on any mouse, keyboard,
scroll, or touch event. When the timer fires, all analysis results are removed from the
DOM, the selected file is cleared, and a "Session cleared for security" message is shown.
This prevents tax data from remaining visible on an unattended screen.

---

## AU-2 — Event Logging
**File:** `audit-logger.js`, `server.js`

The following events are recorded to `audit.log`:

| Event | Fields logged |
|---|---|
| `APP_STARTUP` | port, Node.js version |
| `APP_SHUTDOWN` | signal name |
| `UPLOAD_RECEIVED` | request ID, file size, file extension |
| `PROCESSING_STARTED` | request ID |
| `PROCESSING_COMPLETE` | request ID, duration (ms) |
| `PROCESSING_FAILED` | request ID, error class name only |
| `RATE_LIMIT_TRIGGERED` | IP (truncated to 15 chars) |
| `AC2_AUTH_FAILURE` | IP (truncated) |
| `FILE_DELETION_CONFIRMED` | request ID, deletion success flag |
| `SC28_STARTUP_VERIFICATION` | uploads-empty flag, counts |
| `STARTUP_PURGE_COMPLETE` | file count purged |

File contents, extracted text, and tax data are **never** logged.

---

## AU-3 — Content of Audit Records
**File:** `audit-logger.js`

Every log entry is a JSON object containing `timestamp` (ISO 8601), `event` (machine-
readable string), and safe metadata fields. Error log entries record only the error
constructor name (e.g. `TypeError`), never the error message, which may contain
fragments of document content.

---

## AU-9 — Protection of Audit Information
**File:** `audit-logger.js` — `fs.appendFileSync(..., { flag: 'a' })`

The audit log file is opened exclusively with the `'a'` (append-only) flag. It is never
opened with `'w'` (write/truncate) or `'r+'` (read-write) mode. This makes it
structurally impossible for application code to overwrite or erase existing log entries.
`audit.log` is listed in `.gitignore` so it is never committed to version control.

---

## AU-11 — Audit Record Retention
**File:** `audit-logger.js` — `rotate()`

When `audit.log` reaches 1 MB it is automatically rotated: the current log is renamed
`audit.log.1`, previous rotations shift down (`audit.log.1` → `audit.log.2`, etc.), and
a fresh `audit.log` is started. A maximum of 3 rotated files is kept; `audit.log.4` and
older are deleted. This bounds total disk use at ~4 MB while retaining recent history.

---

## SC-8 — Transmission Confidentiality
**File:** `server.js` — localhost-only middleware, HTTPS comment at top of file

A middleware applied to all routes checks the incoming IP address. If the request
originates from any address other than `127.0.0.1` or `::1`, the request is rejected
with HTTP 403 and a `SC8_NON_LOCAL_REJECTED` event is written to the audit log. A
prominent comment at the top of `server.js` explains that HTTPS is required before the
app is shared with anyone.

---

## SC-12 — Cryptographic Key Management
**File:** `server.js` — `ENCRYPTION_KEY`, `encryptText()`, `decryptText()`

On startup the server generates a 32-byte AES-256-GCM key using `crypto.randomBytes(32)`
and stores it only in the Node.js process memory — it is never written to disk. After
`readDocument()` returns the raw extracted text, that text is immediately encrypted with
a fresh random IV and the plaintext variable is set to `null`. The ciphertext is decrypted
only immediately before sanitization and validation. The plaintext variable is nulled again
before the Claude API call. This protects tax document content against memory-scraping
attacks during the processing window.

---

## SC-28 — Protection of Information at Rest
**File:** `server.js` — `verifyCleanState()`, `purgeUploadsDir()`

On every startup the server scans the `uploads/` directory and the project tree for any
`.tmp` files. The results are logged to `audit.log` via `SC28_STARTUP_VERIFICATION`.
Because the app deliberately stores nothing, any files found represent a crash recovery
situation and are securely deleted before the server accepts requests.

---

## SC-39 — Process Isolation
**File:** `server.js` — `crypto.randomUUID()` per request

Every `/analyze` request is assigned a UUID at entry. All sensitive variables
(`rawText`, `encryptedBlob`, `sanitized`, `organizedData`, `analysis`) are declared with
`let` inside the async handler function and scoped to that call frame — they cannot leak
between concurrent requests. All audit log entries include the request ID so any single
request can be traced end-to-end through the log.

---

## SI-2 — Flaw Remediation
**File:** `server.js` — `GET /health`

The `/health` endpoint returns the application version (from `package.json`), process
uptime in seconds, and a real-time count of files in `uploads/`. An operator can query
this endpoint at any time to confirm the app is in a clean state without restarting it.

---

## SI-3 — Malicious Code Protection
**File:** `server.js` — `detectMagicNumber()`, `detectPromptInjection()`, `sanitizeText()`

Three layers of protection:
1. **Magic number validation** — the first 4 bytes of every uploaded file are compared
   against known signatures for PDF (`%PDF`), JPEG (`FF D8 FF`), and PNG (`89 50 4E 47`).
   Files that fail are rejected before any parsing begins.
2. **Prompt injection scanning** — the extracted text is scanned for patterns such as
   "ignore previous instructions", "system prompt", "you are now", and similar before it
   reaches the Claude API. Matches cause the request to be rejected with HTTP 422.
3. **HTML/JS stripping** — `<script>` blocks, HTML tags, and `javascript:` strings are
   removed from the extracted text before it is processed further.

---

## SI-10 — Information Input Validation
**File:** `server.js` — `hasSufficientTaxData()`, `extensionMatchesMagic()`, multer limits

Three validation checks beyond magic numbers:
1. **Dollar-amount threshold** — extracted text must contain at least 3 strings matching
   the dollar-amount pattern (`$?[\d,]+\.\d{2}`) before the Claude API is called. This
   rejects blank scans, cover pages, and non-financial documents.
2. **Extension–magic mismatch check** — the detected magic-number type is compared to the
   file extension. A `.pdf` file whose bytes look like a JPEG is rejected.
3. **File size cap** — multer enforces a hard 10 MB limit; files exceeding it are rejected
   before any bytes are written to disk beyond what multer already buffered.

---

## SI-12 — Information Management and Retention
**File:** `server.js` — `secureDelete()`, `finally` block, SIGINT/SIGTERM handlers

Four mechanisms ensure no tax data is retained:
1. **Secure delete** — before `fs.unlinkSync()`, the file is opened in `r+` mode and
   every byte is overwritten with `crypto.randomBytes()`, then `fsyncSync()` flushes the
   overwrite to physical storage. The directory entry is removed only after the content
   is gone.
2. **`finally` block** — the secure delete runs unconditionally, even if the pipeline
   throws mid-execution.
3. **Variable nulling** — all six sensitive pipeline variables are set to `null`
   immediately after use and again in the `finally` block.
4. **Exit handlers** — `SIGINT`, `SIGTERM`, and `SIGQUIT` handlers call `purgeUploadsDir()`
   before the process exits, so a Ctrl-C does not leave files on disk.

---

## MP-6 — Media Sanitization
**File:** `server.js` — multer `filename` callback

Every uploaded file is immediately renamed to a `crypto.randomUUID()` value with only
the original extension preserved. The original filename is never used in any system
call, log entry, or response. Combined with the secure-delete procedure from SI-12, this
satisfies MP-6 for temporary media.

---

## RA-5 — Vulnerability Scanning
**File:** `security-check.js`
**Script:** `npm run security-check`

`security-check.js` performs five automated checks:
1. Confirms all required security packages (`helmet`, `express-rate-limit`, `dotenv`,
   `multer`, `@anthropic-ai/sdk`) are present in `package.json`.
2. Confirms critical runtime files (`.env`, `.session-key`, `audit-logger.js`, etc.) exist.
3. Confirms `.env`, `uploads/`, `.session-key`, and `audit.log` are all listed in `.gitignore`.
4. Confirms `uploads/` is empty (zero tax documents at rest).
5. Runs `npm audit` and fails the script if any critical or high severity vulnerabilities
   are found.

Exit code is `0` on full pass, `1` if any check fails.

---

## Summary table

| Control | Short description | Primary file |
|---|---|---|
| AC-2 | Session token auth | `server.js` |
| AC-3 | Token enforcement middleware | `server.js` |
| AC-4 | DataFlowEnforcer pipeline | `server.js` |
| AC-12 | 15-min inactivity timeout | `index.html` |
| AU-2 | Event logging | `audit-logger.js` |
| AU-3 | Structured log content | `audit-logger.js` |
| AU-9 | Append-only log | `audit-logger.js` |
| AU-11 | Log rotation at 1 MB | `audit-logger.js` |
| SC-8 | Localhost-only enforcement | `server.js` |
| SC-12 | AES-256-GCM in-memory encryption | `server.js` |
| SC-28 | Startup clean-state verification | `server.js` |
| SC-39 | Per-request UUID isolation | `server.js` |
| SI-2 | /health status endpoint | `server.js` |
| SI-3 | Magic numbers + injection scan | `server.js` |
| SI-10 | Dollar-amount + extension validation | `server.js` |
| SI-12 | Secure delete + exit handlers | `server.js` |
| MP-6 | UUID rename + secure wipe | `server.js` |
| RA-5 | Automated security scan script | `security-check.js` |
