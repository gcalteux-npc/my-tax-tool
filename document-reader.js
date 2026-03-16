const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.webp']);
const PDF_EXTENSION = '.pdf';

async function extractFromPDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractFromImage(filePath) {
  const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
  return text;
}

async function readDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === PDF_EXTENSION) {
    return extractFromPDF(filePath);
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return extractFromImage(filePath);
  }

  throw new Error(`Unsupported file type: ${ext}. Supported types: PDF, ${[...IMAGE_EXTENSIONS].join(', ')}`);
}

module.exports = { readDocument };
