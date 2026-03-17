/**
 * form-filler.js — Fills an IRS 1040 PDF using pdf-lib.
 *
 * Field names verified against the 2024 IRS Form 1040 fillable PDF
 * downloaded from irs.gov/pub/irs-pdf/f1040.pdf.
 * Full XFA-path field names are required — short names are not matched.
 */

'use strict';

const { PDFDocument } = require('pdf-lib');

/** Format a number as a 2-decimal string; blank for zero/null. */
function fmt(value) {
  if (!value || value === 0) return '';
  return value.toFixed(2);
}

/**
 * Build the field → value mapping from a tax_calculator result object.
 * Field names use full XFA paths as reported by listFields().
 */
function buildFieldMap(r) {
  const P1 = (n) => `topmostSubform[0].Page1[0].${n}`;
  const P2 = (n) => `topmostSubform[0].Page2[0].${n}`;

  // ── Step 1: Compute component values ──────────────────────────────────
  const totalDeductions = (r.standardDeduction || 0) + (r.qbiDeduction || 0);

  // f2_20: Line 25d — sum of 25a + 25b + 25c
  const f2_17val = r.totalWithheld || 0;
  const f2_18val = 0; // 1099 withholding — not yet mapped
  const f2_19val = 0; // other withholding — not yet mapped
  const f2_20val = f2_17val + f2_18val + f2_19val;

  return {
    // ── Page 1 — Income ────────────────────────────────────────────────
    // Line 1a  — W-2 wages (Box 1)
    [P1('f1_47[0]')]:  fmt(r.w2Wages),
    // Line 1z  — Total wages (sum of 1a–1h; only 1a filled now)
    [P1('f1_57[0]')]:  fmt(r.w2Wages),
    // Line 2b  — Taxable interest
    [P1('f1_59[0]')]:  fmt(r.interestIncome),
    // Line 3a  — Qualified dividends
    [P1('f1_60[0]')]:  fmt(r.qualifiedDividends),
    // Line 3b  — Ordinary dividends
    [P1('f1_61[0]')]:  fmt(r.ordinaryDividends),
    // Line 7   — Net capital gain or (loss)
    [P1('f1_70[0]')]:  fmt(r.netCapGain),
    // Line 8   — Other income from Schedule 1 (NEC / SE income)
    [P1('f1_72[0]')]:  fmt(r.seIncome),
    // Line 9   — Total income
    [P1('f1_73[0]')]:  fmt(r.grossIncome),
    // Line 10  — Adjustments to income (half SE tax — above-the-line only)
    [P1('f1_74[0]')]:  fmt(r.halfSeDeduction),
    // Line 11  — Adjusted gross income
    [P1('f1_75[0]')]:  fmt(r.agi),

    // ── Page 2 — Deductions, Tax, Payments ────────────────────────────
    // Line 11b — AGI carried to page 2 (mirrors 11a)
    [P2('f2_01[0]')]:  fmt(r.agi),
    // Line 12e — Standard deduction (or itemized)
    [P2('f2_02[0]')]:  fmt(r.standardDeduction),
    // Line 13a — QBI deduction (20% of SE income + Section 199A dividends)
    [P2('f2_03[0]')]:  fmt(r.qbiDeduction),
    // Line 14  — Total deductions (12e + 13a)
    [P2('f2_05[0]')]:  fmt(totalDeductions),
    // Line 15  — Taxable income (11b minus line 14)
    [P2('f2_06[0]')]:  fmt(r.taxableIncome),
    // Line 16  — Income tax
    [P2('f2_08[0]')]:  fmt(r.ordinaryTax),
    // Line 23  — Other taxes (SE tax + NIIT + additional Medicare)
    [P2('f2_15[0]')]:  fmt(r.otherTaxes),
    // Line 24  — Total tax
    [P2('f2_16[0]')]:  fmt(r.totalTax),
    // Line 25a — W-2 federal income tax withheld
    [P2('f2_17[0]')]:  fmt(f2_17val),
    // Line 25d — Total withholding (25a + 25b + 25c)
    [P2('f2_20[0]')]:  fmt(f2_20val),
    // Line 33  — Total payments
    [P2('f2_29[0]')]:  fmt(r.totalWithheld),
    // Line 34  — Overpayment amount
    [P2('f2_30[0]')]:  fmt(r.refund),
    // Line 35a — Refund
    [P2('f2_31[0]')]:  fmt(r.refund),
    // Line 37  — Amount owed
    [P2('f2_35[0]')]:  fmt(r.amountOwed),
  };
}

/**
 * Fill the bundled IRS 1040 PDF buffer with calculated values.
 * Returns { filledBytes, skipped } where skipped is a list of
 * field names not found in this PDF version.
 */
async function fill1040(pdfBuffer, calcResult) {
  const pdfDoc   = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const form     = pdfDoc.getForm();
  const fieldMap = buildFieldMap(calcResult);
  const skipped  = [];

  for (const [fieldName, value] of Object.entries(fieldMap)) {
    if (!value) continue;
    try {
      form.getTextField(fieldName).setText(value);
    } catch {
      skipped.push(fieldName);
    }
  }

  const filledBytes = await pdfDoc.save();
  return { filledBytes: Buffer.from(filledBytes), skipped };
}

/**
 * Return a list of all form field names found in a PDF buffer.
 */
async function listFields(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const form   = pdfDoc.getForm();
  return form.getFields().map(f => ({ name: f.getName(), type: f.constructor.name }));
}

module.exports = { fill1040, listFields };
