/**
 * tax-calculator.js — Server-side 2025 federal income tax calculation.
 * Reads tax-rules.json for all brackets and thresholds.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let _rules = null;
function loadTaxRules() {
  if (!_rules) {
    _rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'tax-rules.json'), 'utf8'));
  }
  return _rules;
}

function bracketTax(income, brackets) {
  let tax = 0;
  for (const bracket of brackets) {
    const low  = bracket.min;
    const high = bracket.max !== null ? bracket.max : Infinity;
    if (income <= low) break;
    tax += (Math.min(income, high) - low) * bracket.rate;
  }
  return tax;
}

function normalizeFilingStatus(filingStatus) {
  const s = (filingStatus || '').toLowerCase().trim();
  if (s === 'mfj' || s.includes('jointly') || s === 'married_filing_jointly') return 'married_filing_jointly';
  if (s === 'hoh' || s.includes('head') || s === 'head_of_household') return 'head_of_household';
  return 'single';
}

function calculate(docs, filingStatus) {
  const rules = loadTaxRules();
  const fsKey = normalizeFilingStatus(filingStatus);

  // ── 1. Collect income components ──────────────────────────────────────────
  let w2Wages = 0, federalWithheld = 0, interestIncome = 0;
  let ordinaryDividends = 0, qualifiedDividends = 0, section199ADividends = 0, seIncome = 0, shortTermGains = 0, longTermGains = 0;

  for (const doc of docs) {
    const dtype = doc.type || '';
    if (dtype === 'W-2') {
      w2Wages         += doc.wages              || 0;
      federalWithheld += doc.federalTaxWithheld || 0;
    } else if (dtype === '1099-INT') {
      interestIncome  += doc.interestIncome     || 0;
    } else if (dtype === '1099-DIV') {
      ordinaryDividends    += doc.ordinaryDividends    || 0;
      qualifiedDividends   += doc.qualifiedDividends   || 0;
      section199ADividends += doc.section199ADividends || 0;
    } else if (dtype === '1099-NEC') {
      seIncome        += doc.nonemployeeCompensation || 0;
    } else if (dtype === '1099-B') {
      const sales = doc.sales || [];
      if (sales.length) {
        for (const sale of sales) {
          const gl   = sale.gainLoss || 0;
          const term = (sale.term || '').toLowerCase();
          if (term.includes('long')) longTermGains += gl;
          else                       shortTermGains += gl;
        }
      } else {
        shortTermGains += doc.netGainLoss || 0;
      }
    }
  }

  const netCapGain  = shortTermGains + longTermGains;
  const grossIncome = w2Wages + interestIncome + ordinaryDividends + seIncome + netCapGain;

  // ── 2. SE tax ──────────────────────────────────────────────────────────────
  let seTax = 0, halfSeDeduction = 0;
  if (seIncome > 0) {
    seTax           = 0.153 * 0.9235 * seIncome;
    halfSeDeduction = seTax / 2;
  }

  // ── 3. QBI deduction ───────────────────────────────────────────────────────
  const qbiRules        = rules.other_key_numbers.qualified_business_income_deduction;
  const qbiPhaseOutBegin = fsKey === 'married_filing_jointly'
    ? qbiRules.phase_out_mfj.begins
    : qbiRules.phase_out_single.begins;
  // ── 4. AGI — only above-the-line deductions (half SE tax) ────────────────
  const agi = grossIncome - halfSeDeduction;

  // ── 5. Standard deduction ──────────────────────────────────────────────────
  const standardDeduction = rules.standard_deductions[fsKey];

  // ── 6. QBI deduction (below-the-line, reduces taxable income not AGI) ─────
  // SE income: 20% deduction subject to phase-out above threshold
  // Section 199A dividends: 20% deduction, no phase-out
  let qbiDeduction = 0;
  if (seIncome > 0 && agi <= qbiPhaseOutBegin) {
    qbiDeduction += 0.20 * seIncome;
  }
  qbiDeduction += 0.20 * section199ADividends;

  // ── 7. Taxable income ──────────────────────────────────────────────────────
  const taxableIncome = Math.max(0, agi - standardDeduction - qbiDeduction);

  // ── 8. Ordinary vs preferential income split ──────────────────────────────
  // Qualified dividends and net LTCG are taxed at preferential (LTCG) rates.
  // Non-qualified dividends (ordinary - qualified) and short-term gains are
  // taxed at ordinary rates. Preferential income is stacked on top of ordinary
  // income to determine which LTCG bracket applies.
  const preferentialIncome = Math.min(
    qualifiedDividends + Math.max(0, longTermGains),
    taxableIncome
  );
  const ordinaryTaxable = Math.max(0, taxableIncome - preferentialIncome);

  // ── 7. Ordinary income tax (on non-preferential income only) ──────────────
  const ordinaryTax = bracketTax(ordinaryTaxable, rules.federal_income_tax_brackets[fsKey]);

  // ── 8. LTCG / qualified dividend tax (stacked on top of ordinary income) ──
  const ltcgBrackets = rules.long_term_capital_gains[fsKey];
  const ltcgTax = ltcgBrackets
    ? bracketTax(ordinaryTaxable + preferentialIncome, ltcgBrackets) -
      bracketTax(ordinaryTaxable, ltcgBrackets)
    : 0;

  // ── 9. NIIT ────────────────────────────────────────────────────────────────
  const niitRules     = rules.other_key_numbers.net_investment_income_tax;
  const niitThreshold = fsKey === 'married_filing_jointly'
    ? niitRules.magi_threshold_mfj : niitRules.magi_threshold_single;
  const netInvestmentIncome = interestIncome + ordinaryDividends + shortTermGains + longTermGains;
  let niit = 0;
  if (agi > niitThreshold) {
    niit = 0.038 * Math.min(netInvestmentIncome, agi - niitThreshold);
  }

  // ── 10. Additional Medicare ────────────────────────────────────────────────
  const amtRules     = rules.other_key_numbers.additional_medicare_tax;
  const amtThreshold = fsKey === 'married_filing_jointly'
    ? amtRules.threshold_mfj : amtRules.threshold_single;
  let additionalMedicare = 0;
  if ((w2Wages + seIncome) > amtThreshold) {
    additionalMedicare = 0.009 * ((w2Wages + seIncome) - amtThreshold);
  }

  // ── 11–13. Totals ──────────────────────────────────────────────────────────
  const otherTaxes  = seTax + niit + additionalMedicare;
  const totalTax    = ordinaryTax + ltcgTax + otherTaxes;
  const balance     = federalWithheld - totalTax;
  const refund      = Math.max(0, balance);
  const amountOwed  = Math.max(0, -balance);

  return {
    filingStatus,
    filingStatusKey: fsKey,
    w2Wages,
    interestIncome,
    ordinaryDividends,
    qualifiedDividends,
    section199ADividends,
    seIncome,
    shortTermGains,
    longTermGains,
    netCapGain,
    grossIncome,
    seTax,
    halfSeDeduction,
    qbiDeduction,
    agi,
    standardDeduction,
    taxableIncome,
    ordinaryTax,
    ltcgTax,
    niit,
    additionalMedicare,
    otherTaxes,
    totalTax,
    totalWithheld: federalWithheld,
    refund,
    amountOwed,
  };
}

module.exports = { calculate };
