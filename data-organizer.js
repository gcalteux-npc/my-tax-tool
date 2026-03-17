/**
 * Parses a dollar amount string like "$1,234.56" or "1234.56" into a float.
 * Returns null if the string cannot be parsed.
 */
function parseDollar(str) {
  if (!str) return null;
  const cleaned = str.replace(/[$,\s]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

/**
 * Searches text for a dollar amount near a given label pattern.
 * Handles three layouts:
 *   1. Dotted leader on same line: "Label.........27.71"
 *   2. Label followed by amount within 60 chars
 *   3. Amount on the line immediately before the label
 */
function extractAmountNear(text, labelPattern) {
  // Dotted-leader layout (consolidated 1099s): label followed by dots then amount on same line
  const dottedPattern = new RegExp(
    labelPattern.source + /[.\s]{2,}(\d[\d,]*\.\d{2})/.source,
    labelPattern.flags
  );
  const dottedMatch = text.match(dottedPattern);
  if (dottedMatch) return parseDollar(dottedMatch[1]);

  // Label followed by amount within 60 chars (standard layout)
  const forwardPattern = new RegExp(
    labelPattern.source + /[\s\S]{0,60}?(\$?[\d,]+\.\d{1,2})/.source,
    labelPattern.flags
  );
  const forwardMatch = text.match(forwardPattern);
  if (forwardMatch) return parseDollar(forwardMatch[1]);

  // Amount on the line immediately before the label (W-2 box layout)
  const backwardPattern = new RegExp(
    /(\$?[\d,]+\.\d{1,2})[ \t]*\n[ \t]*/.source + labelPattern.source,
    labelPattern.flags
  );
  const backwardMatch = text.match(backwardPattern);
  if (backwardMatch) return parseDollar(backwardMatch[1]);

  return null;
}

/**
 * Extracts a short text value (e.g. employer or payer name) near a label.
 */
function extractTextNear(text, labelPattern, maxLength = 60) {
  const pattern = new RegExp(
    labelPattern.source + /[:\s]+([^\n]{1,60})/.source,
    labelPattern.flags
  );
  const match = text.match(pattern);
  if (!match) return null;
  return match[1].trim().substring(0, maxLength) || null;
}

// ---------------------------------------------------------------------------
// Document-type detection
// ---------------------------------------------------------------------------

function detectDocumentType(text) {
  const upper = text.toUpperCase();
  if (/\bW-?2\b/.test(upper) && /WAGE|EMPLOYER/.test(upper)) return 'W-2';
  if (/1099-?NEC\b/.test(upper) || /NONEMPLOYEE\s+COMPENSATION/.test(upper)) return '1099-NEC';
  if (/1099-?DIV\b/.test(upper) || /DIVIDENDS?\s+AND\s+DISTRIBUTIONS/.test(upper)) return '1099-DIV';
  if (/1099-?INT\b/.test(upper) || /INTEREST\s+INCOME/.test(upper)) return '1099-INT';
  if (/1099-?B\b/.test(upper) || /PROCEEDS\s+FROM\s+BROKER/.test(upper)) return '1099-B';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Box-number extractor for W-2
// W-2 PDFs consistently place the dollar amount on the line immediately
// before the box number and label, e.g.:
//     4410.11
//   2 Federal Income tax withheld
// This is far more reliable than fuzzy label matching.
// ---------------------------------------------------------------------------

/**
 * Extracts the value for a specific W-2 box number.
 * Matches an amount on the line directly preceding "N " or "N\t".
 * Falls back to label-based extraction if the box-number pattern fails.
 */
function extractW2Box(text, boxNumber, fallbackLabelPattern) {
  // Primary: amount on the line immediately before the box number
  const boxPattern = new RegExp(`([\\d,]+\\.\\d{2})[ \\t]*\\n[ \\t]*${boxNumber}[ \\t]`, 'i');
  const boxMatch = text.match(boxPattern);
  if (boxMatch) return parseDollar(boxMatch[1]);

  // Fallback: label-based search (handles PDFs with different layouts)
  if (fallbackLabelPattern) return extractAmountNear(text, fallbackLabelPattern);
  return null;
}

// ---------------------------------------------------------------------------
// Per-type extractors
// ---------------------------------------------------------------------------

// W-2 box number → field mapping:
//   Box 1  = Wages, tips, other compensation
//   Box 2  = Federal income tax withheld
//   Box 17 = State income tax withheld
function extractW2(text) {
  // Employer name appears on the line after "c Employer's name, address, and ZIP code"
  const employerLineMatch = text.match(/employer'?s?\s+name[^\n]*\n\s*([^\n]+)/i);
  const employerName =
    (employerLineMatch && employerLineMatch[1].trim()) ||
    extractTextNear(text, /employer'?s?\s+name/i) ||
    extractTextNear(text, /payer'?s?\s+name/i);

  const wages              = extractW2Box(text, 1,  /wages[,\s]+tips[,\s]+other\s+comp/i);
  const federalWithheld    = extractW2Box(text, 2,  /federal\s+income\s+tax\s+withheld/i);
  const socialSecurityWH   = extractW2Box(text, 4,  /social\s+security\s+tax\s+withheld/i);
  const medicareWH         = extractW2Box(text, 6,  /medicare\s+tax\s+withheld/i);
  const stateWithheld      = extractW2Box(text, 17, /state\s+income\s+tax/i);

  return {
    type: 'W-2',
    employerName,
    wages,
    federalTaxWithheld: federalWithheld,
    socialSecurityTaxWithheld: socialSecurityWH,
    medicareTaxWithheld: medicareWH,
    stateTaxWithheld: stateWithheld,
  };
}

function extract1099INT(text) {
  const payerName =
    extractTextNear(text, /payer'?s?\s+name/i) ||
    extractTextNear(text, /financial\s+institution/i);

  const interestIncome =
    extractAmountNear(text, /(?:box\s*1\b|interest\s+income)/i) ||
    extractAmountNear(text, /total\s+interest/i);

  return {
    type: '1099-INT',
    payerName,
    interestIncome,
  };
}

function extract1099DIV(text) {
  const payerName = extractTextNear(text, /payer'?s?\s+name/i);

  const ordinaryDividends =
    extractAmountNear(text, /1a\s+total\s+ordinary\s+dividends/i) ||
    extractAmountNear(text, /(?:box\s*1a\b|total\s+ordinary\s+dividends)/i) ||
    extractAmountNear(text, /ordinary\s+dividends/i);

  const qualifiedDividends =
    extractAmountNear(text, /1b\s+qualified\s+dividends/i) ||
    extractAmountNear(text, /(?:box\s*1b\b|qualified\s+dividends)/i);

  const section199ADividends =
    extractAmountNear(text, /(?:box\s*5\b|section\s*199\s*a\s+dividends)/i) ||
    extractAmountNear(text, /199\s*a\s+dividends/i);

  return {
    type: '1099-DIV',
    payerName,
    ordinaryDividends,
    qualifiedDividends,
    section199ADividends,
  };
}

function extract1099NEC(text) {
  const payerName = extractTextNear(text, /payer'?s?\s+name/i);

  const nonemployeeCompensation =
    extractAmountNear(text, /(?:box\s*1\b|nonemployee\s+compensation)/i) ||
    extractAmountNear(text, /nec\b/i);

  return {
    type: '1099-NEC',
    payerName,
    nonemployeeCompensation,
  };
}

/**
 * Parses 1099-B transaction lines.
 * Looks for rows containing proceeds, cost basis, and a term indicator.
 * Each matched row becomes an entry in the sales array.
 */
function extract1099B(text) {
  const brokerName =
    extractTextNear(text, /broker'?s?\s+name/i) ||
    extractTextNear(text, /payer'?s?\s+name/i);

  // Try to parse individual sale rows.
  // Typical format: description  proceeds  cost_basis  gain/loss  term
  const sales = [];
  const rowPattern =
    /([A-Z0-9 ]+?)\s+(\$?[\d,]+\.\d{2})\s+(\$?[\d,]+\.\d{2})\s+(-?\$?[\d,]+\.\d{2})\s+(SHORT|LONG|S\b|L\b)/gi;

  let match;
  while ((match = rowPattern.exec(text)) !== null) {
    const termRaw = match[5].toUpperCase();
    sales.push({
      description: match[1].trim(),
      proceeds: parseDollar(match[2]),
      costBasis: parseDollar(match[3]),
      gainLoss: parseDollar(match[4]),
      term: termRaw.startsWith('L') ? 'long-term' : 'short-term',
    });
  }

  // Fall back to aggregate totals when no row-level data was found.
  const proceeds = sales.length
    ? sales.reduce((sum, s) => sum + (s.proceeds || 0), 0)
    : extractAmountNear(text, /(?:total\s+)?proceeds/i);

  const costBasis = sales.length
    ? sales.reduce((sum, s) => sum + (s.costBasis || 0), 0)
    : extractAmountNear(text, /(?:total\s+)?(?:cost\s+basis|cost\/basis)/i);

  const netGainLoss = sales.length
    ? sales.reduce((sum, s) => sum + (s.gainLoss || 0), 0)
    : extractAmountNear(text, /(?:net\s+)?(?:gain|loss)/i);

  return {
    type: '1099-B',
    brokerName,
    proceeds,
    costBasis,
    netGainLoss,
    sales,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function organizeData(rawText) {
  const docType = detectDocumentType(rawText);

  switch (docType) {
    case 'W-2':       return extractW2(rawText);
    case '1099-INT':  return extract1099INT(rawText);
    case '1099-DIV':  return extract1099DIV(rawText);
    case '1099-NEC':  return extract1099NEC(rawText);
    case '1099-B':    return extract1099B(rawText);
    default:
      return { type: 'UNKNOWN', rawText: rawText.substring(0, 500) };
  }
}

module.exports = { organizeData };
