# Tax Document Analyzer

A Node.js tool that uses the Claude API to analyze tax documents (W-2s and 1099s), extract structured data, and produce plain-English summaries to help users understand their tax situation.

## Project Structure

- **document-reader.js** — Handles ingestion of tax documents (PDF/image upload, base64 encoding, and passing documents to the Claude API via vision).
- **data-organizer.js** — Takes raw extracted data from Claude and normalizes it into structured objects (income sources, withholdings, deductions, etc.).
- **tax-analyzer.js** — Sends organized data back to Claude to generate a plain-English tax summary, including estimated liability, refund outlook, and notable items.
- **server.js** — Express server that wires together the pipeline: accepts file uploads, calls document-reader → data-organizer → tax-analyzer, and returns results to the frontend.
- **index.html** — Single-page UI for uploading tax documents and displaying the plain-English summary returned by the server.

## Architecture

```
index.html  →  POST /analyze  →  server.js
                                    ├── document-reader.js   (Claude API: extract raw data)
                                    ├── data-organizer.js    (normalize into structured objects)
                                    └── tax-analyzer.js      (Claude API: generate summary)
```

## Key Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `express` — HTTP server
- `multer` — Multipart file upload handling

## Running the Project

```bash
npm install
ANTHROPIC_API_KEY=your_key_here node server.js
```

Then open `http://localhost:3000` in your browser.
