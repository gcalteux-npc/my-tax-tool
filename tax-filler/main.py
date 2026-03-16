"""
main.py — CLI entry point for the Python tax calculator / 1040 filler.

Usage:
    python main.py <path-to-extracted-json> [--pdf 1040.pdf] [--out filled-1040.pdf]
    python main.py extracted-data.json
    python main.py extracted-data.json --pdf f1040.pdf --out filled.pdf
"""

import argparse
import json
import sys

import tax_calculator
from form_filler import fill_1040


def _fmt_usd(value):
    if value is None:
        return '$0.00'
    sign = '-' if value < 0 else ''
    return f'{sign}${abs(value):,.2f}'


def print_report(result):
    """Print a detailed line-by-line calculation report to the terminal."""
    r = result
    w = 52  # column width for alignment

    def line(label, value, indent=0):
        prefix = '  ' * indent
        print(f"  {prefix}{label:<{w - 2 * indent}}{_fmt_usd(value):>14}")

    def divider(char='-'):
        print('  ' + char * (w + 12))

    def section(title):
        print(f"\n{'─' * 68}")
        print(f"  {title}")
        print(f"{'─' * 68}")

    print()
    print('=' * 68)
    print('  2025 FEDERAL INCOME TAX CALCULATION')
    print(f"  Filing status: {r['filing_status']}")
    print('=' * 68)

    section('INCOME')
    line('W-2 wages (Line 1a)',              r['w2_wages'])
    line('Taxable interest (Line 2b)',        r['interest_income'])
    line('Ordinary dividends (Line 3b)',      r['ordinary_dividends'])
    line('Nonemployee compensation (NEC)',    r['se_income'])
    line('Short-term capital gains',         r['short_term_gains'])
    line('Long-term capital gains (Line 7)', r['long_term_gains'])
    divider()
    line('GROSS INCOME (Line 9)',            r['gross_income'])

    section('ABOVE-THE-LINE DEDUCTIONS')
    if r['se_income'] > 0:
        line('Self-employment tax (15.3% × 92.35% × NEC)', r['se_tax'])
        line('Deductible half of SE tax',                  r['half_se_deduction'])
        line('QBI deduction (20% of NEC)',                 r['qbi_deduction'])
    else:
        print('  None applicable.')

    section('ADJUSTED GROSS INCOME')
    line('Gross income',                     r['gross_income'])
    line('Less: half SE tax deduction',     -r['half_se_deduction'])
    line('Less: QBI deduction',             -r['qbi_deduction'])
    divider()
    line('AGI (Line 11)',                    r['agi'])

    section('TAXABLE INCOME')
    line('AGI',                              r['agi'])
    line('Standard deduction (Line 12)',    -r['standard_deduction'])
    divider()
    line('TAXABLE INCOME (Line 15)',         r['taxable_income'])

    section('TAX COMPUTATION')
    line('Ordinary income tax (Line 16)',    r['ordinary_tax'])
    if r['ltcg_tax']:
        line('Long-term capital gains tax', r['ltcg_tax'])
    if r['se_tax']:
        line('Self-employment tax',         r['se_tax'])
    if r['niit']:
        line('Net Investment Income Tax (3.8%)', r['niit'])
    if r['additional_medicare']:
        line('Additional Medicare Tax (0.9%)',   r['additional_medicare'])
    divider()
    line('TOTAL TAX (Line 24)',             r['total_tax'])

    section('PAYMENTS')
    line('Federal income tax withheld (Line 25a)', r['total_withheld'])
    divider()
    line('TOTAL PAYMENTS (Line 33)',        r['total_withheld'])

    section('REFUND / AMOUNT OWED')
    if r['refund'] > 0:
        line('REFUND (Line 34)',            r['refund'])
    elif r['amount_owed'] > 0:
        line('AMOUNT OWED (Line 37)',       r['amount_owed'])
    else:
        print('  Tax is exactly covered — no refund or balance due.')

    print()
    print('=' * 68)
    print()


def prompt_filing_status():
    print('\nFiling status:')
    print('  1) Single')
    print('  2) Married Filing Jointly (MFJ)')
    print('  3) Head of Household (HOH)')
    choice = input('Enter 1, 2, or 3 [default: 1]: ').strip() or '1'
    mapping = {
        '1': 'Single',
        '2': 'Married Filing Jointly',
        '3': 'Head of Household',
    }
    status = mapping.get(choice)
    if not status:
        print(f"Unrecognized choice '{choice}', defaulting to Single.")
        status = 'Single'
    return status


def main():
    parser = argparse.ArgumentParser(
        description='Calculate 2025 federal tax liability from extracted tax documents.',
    )
    parser.add_argument(
        'json_file',
        help='Path to extracted-data.json (array of tax document objects)',
    )
    parser.add_argument(
        '--pdf',
        metavar='1040.pdf',
        help='Path to a blank IRS 1040 fillable PDF to fill in',
    )
    parser.add_argument(
        '--out',
        metavar='filled-1040.pdf',
        default='filled-1040.pdf',
        help='Output path for the filled 1040 PDF (default: filled-1040.pdf)',
    )
    args = parser.parse_args()

    # Load extracted data
    try:
        with open(args.json_file) as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: file not found — {args.json_file}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON in {args.json_file} — {e}", file=sys.stderr)
        sys.exit(1)

    # Support both a single object and an array
    if isinstance(data, dict):
        docs = [data]
    elif isinstance(data, list):
        docs = data
    else:
        print('Error: expected a JSON object or array of objects.', file=sys.stderr)
        sys.exit(1)

    if not docs:
        print('No tax documents found in the JSON file.', file=sys.stderr)
        sys.exit(1)

    doc_types = [d.get('type', 'UNKNOWN') for d in docs]
    print(f"\nLoaded {len(docs)} document(s): {', '.join(doc_types)}")

    filing_status = prompt_filing_status()

    result = tax_calculator.calculate(docs, filing_status)
    print_report(result)

    if args.pdf:
        fill_1040(args.pdf, result, args.out)


if __name__ == '__main__':
    main()
