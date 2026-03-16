"""
tax_calculator.py — Pure calculation logic for 2025 federal income tax.

Reads ../tax-rules.json for brackets and thresholds.
"""

import json
import os


def _load_tax_rules():
    rules_path = os.path.join(os.path.dirname(__file__), '..', 'tax-rules.json')
    with open(rules_path) as f:
        return json.load(f)


def _bracket_tax(income, brackets):
    """Sum marginal tax across brackets for a given income."""
    tax = 0.0
    for bracket in brackets:
        low = bracket['min']
        high = bracket['max'] if bracket['max'] is not None else float('inf')
        rate = bracket['rate']
        if income <= low:
            break
        taxable_in_bracket = min(income, high) - low
        tax += taxable_in_bracket * rate
    return tax


def _normalize_filing_status(filing_status):
    fs = filing_status.lower().strip()
    if fs in ('mfj', 'married filing jointly', 'married_filing_jointly'):
        return 'married_filing_jointly'
    if fs in ('hoh', 'head of household', 'head_of_household'):
        return 'head_of_household'
    return 'single'


def calculate(docs, filing_status):
    """
    Given a list of extracted tax document objects (from data-organizer.js)
    and a filing status string, return a dict with every intermediate value.

    Parameters
    ----------
    docs : list[dict]   — array from extracted-data.json
    filing_status : str — 'Single', 'MFJ', or 'HOH' (case-insensitive)

    Returns
    -------
    dict with all line-level values
    """
    rules = _load_tax_rules()
    fs_key = _normalize_filing_status(filing_status)

    # ── 1. Collect income components ────────────────────────────────────────
    w2_wages           = 0.0
    federal_withheld   = 0.0
    interest_income    = 0.0
    ordinary_dividends = 0.0
    se_income          = 0.0   # 1099-NEC nonemployee compensation
    short_term_gains   = 0.0   # 1099-B short-term (taxed as ordinary income)
    long_term_gains    = 0.0   # 1099-B long-term (preferential rates)

    for doc in docs:
        dtype = doc.get('type', '')

        if dtype == 'W-2':
            w2_wages         += doc.get('wages') or 0.0
            federal_withheld += doc.get('federalTaxWithheld') or 0.0

        elif dtype == '1099-INT':
            interest_income  += doc.get('interestIncome') or 0.0

        elif dtype == '1099-DIV':
            ordinary_dividends += doc.get('ordinaryDividends') or 0.0

        elif dtype == '1099-NEC':
            se_income        += doc.get('nonemployeeCompensation') or 0.0

        elif dtype == '1099-B':
            sales = doc.get('sales') or []
            if sales:
                for sale in sales:
                    gl   = sale.get('gainLoss') or 0.0
                    term = (sale.get('term') or '').lower()
                    if 'long' in term:
                        long_term_gains  += gl
                    else:
                        short_term_gains += gl
            else:
                # Aggregate fallback — treat as short-term
                short_term_gains += doc.get('netGainLoss') or 0.0

    gross_income = (w2_wages + interest_income + ordinary_dividends
                    + se_income + short_term_gains)

    # ── 2. Self-employment tax ───────────────────────────────────────────────
    # SE tax = 15.3% × 92.35% × net SE income
    se_tax            = 0.0
    half_se_deduction = 0.0
    if se_income > 0:
        se_tax            = 0.153 * 0.9235 * se_income
        half_se_deduction = se_tax / 2

    # ── 3. QBI deduction ────────────────────────────────────────────────────
    # 20% of net SE income if AGI below phase-out threshold
    qbi_rules = rules['other_key_numbers']['qualified_business_income_deduction']
    if fs_key == 'married_filing_jointly':
        qbi_phase_out_begin = qbi_rules['phase_out_mfj']['begins']
    else:
        qbi_phase_out_begin = qbi_rules['phase_out_single']['begins']

    rough_agi     = gross_income - half_se_deduction
    qbi_deduction = 0.0
    if se_income > 0 and rough_agi <= qbi_phase_out_begin:
        qbi_deduction = 0.20 * se_income

    # ── 4. AGI ───────────────────────────────────────────────────────────────
    agi = gross_income - half_se_deduction - qbi_deduction

    # ── 5. Standard deduction ────────────────────────────────────────────────
    std_deductions    = rules['standard_deductions']
    standard_deduction = std_deductions[fs_key]

    # ── 6. Taxable income ────────────────────────────────────────────────────
    taxable_income = max(0.0, agi - standard_deduction)

    # ── 7. Ordinary income tax ───────────────────────────────────────────────
    brackets     = rules['federal_income_tax_brackets'][fs_key]
    ordinary_tax = _bracket_tax(taxable_income, brackets)

    # ── 8. Long-term capital gains tax ──────────────────────────────────────
    ltcg_tax = 0.0
    if long_term_gains > 0:
        ltcg_rules = rules['long_term_capital_gains']
        # HOH not separately listed — use single brackets
        ltcg_fs = 'single' if fs_key == 'head_of_household' else fs_key
        if ltcg_fs in ltcg_rules:
            ltcg_tax = _bracket_tax(long_term_gains, ltcg_rules[ltcg_fs])

    # ── 9. Net Investment Income Tax (NIIT) ──────────────────────────────────
    niit_rules    = rules['other_key_numbers']['net_investment_income_tax']
    niit_threshold = (
        niit_rules['magi_threshold_mfj']
        if fs_key == 'married_filing_jointly'
        else niit_rules['magi_threshold_single']
    )
    magi = agi  # simplified: MAGI ≈ AGI (no above-line exclusions in scope)
    net_investment_income = (interest_income + ordinary_dividends
                             + short_term_gains + long_term_gains)
    niit = 0.0
    if magi > niit_threshold:
        niit = 0.038 * min(net_investment_income, magi - niit_threshold)

    # ── 10. Additional Medicare Tax ──────────────────────────────────────────
    amt_rules      = rules['other_key_numbers']['additional_medicare_tax']
    amt_threshold  = (
        amt_rules['threshold_mfj']
        if fs_key == 'married_filing_jointly'
        else amt_rules['threshold_single']
    )
    total_wages_se      = w2_wages + se_income
    additional_medicare = 0.0
    if total_wages_se > amt_threshold:
        additional_medicare = 0.009 * (total_wages_se - amt_threshold)

    # ── 11. Total tax ────────────────────────────────────────────────────────
    other_taxes = se_tax + niit + additional_medicare
    total_tax   = ordinary_tax + ltcg_tax + other_taxes

    # ── 12. Total withheld ───────────────────────────────────────────────────
    total_withheld = federal_withheld  # W-2 box 2 (1099 withholding not common)

    # ── 13. Refund / amount owed ─────────────────────────────────────────────
    balance     = total_withheld - total_tax
    refund      = max(0.0, balance)
    amount_owed = max(0.0, -balance)

    return {
        'filing_status':     filing_status,
        'filing_status_key': fs_key,
        # Income components
        'w2_wages':           w2_wages,
        'interest_income':    interest_income,
        'ordinary_dividends': ordinary_dividends,
        'se_income':          se_income,
        'short_term_gains':   short_term_gains,
        'long_term_gains':    long_term_gains,
        'gross_income':       gross_income,
        # Deductions
        'se_tax':             se_tax,
        'half_se_deduction':  half_se_deduction,
        'qbi_deduction':      qbi_deduction,
        # AGI / Taxable income
        'agi':                agi,
        'standard_deduction': standard_deduction,
        'taxable_income':     taxable_income,
        # Tax components
        'ordinary_tax':         ordinary_tax,
        'ltcg_tax':             ltcg_tax,
        'niit':                 niit,
        'additional_medicare':  additional_medicare,
        'other_taxes':          other_taxes,
        'total_tax':            total_tax,
        # Payments
        'total_withheld': total_withheld,
        'refund':         refund,
        'amount_owed':    amount_owed,
    }
