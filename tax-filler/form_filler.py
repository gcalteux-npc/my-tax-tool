"""
form_filler.py — Fills an IRS 1040 PDF using pypdf.

Usage (CLI):
    python form_filler.py --list-fields f1040.pdf
"""

import argparse
import sys

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    print("pypdf not installed. Run: pip install 'pypdf>=4.0'", file=sys.stderr)
    sys.exit(1)


def list_fields(pdf_path):
    """Print all fillable field names in a PDF to help map field names."""
    reader = PdfReader(pdf_path)
    fields = reader.get_fields()
    if not fields:
        print("No fillable fields found in this PDF.")
        return
    print(f"Found {len(fields)} fillable fields in '{pdf_path}':\n")
    for name, field in sorted(fields.items()):
        value   = field.get('/V', '')
        ftype   = field.get('/FT', '')
        tooltip = field.get('/TU', '')
        print(f"  {name!r}")
        if tooltip:
            print(f"    tooltip : {tooltip}")
        if ftype:
            print(f"    type    : {ftype}")
        if value:
            print(f"    value   : {value}")


def _fmt(value):
    """Format a float as a dollar amount string for PDF fields."""
    if value is None or value == 0.0:
        return ''
    return f'{value:,.2f}'


def fill_1040(pdf_path, calc_result, output_path):
    """
    Fill an IRS 1040 PDF with values from a tax_calculator result dict.

    The field name mapping below targets the 2024 IRS Form 1040 fillable PDF.
    IRS field names change each year — run `--list-fields` to discover the
    actual names in whichever year's PDF you downloaded and update this dict.

    Common 2024 IRS 1040 PDF field name pattern:
        topmostSubform[0].Page1[0].f1_NN[0]
    The short aliases (f1_NN[0]) used here match the names that appear when
    you inspect the PDF in Adobe Acrobat or with `--list-fields`.
    """
    c = calc_result

    # Map: PDF field name → value to write
    # Run `python form_filler.py --list-fields <pdf>` to verify these names.
    field_map = {
        # Line 1a  — W-2 wages, salaries, tips
        'f1_04[0]':  _fmt(c.get('w2_wages')),
        # Line 2b  — Taxable interest
        'f1_09[0]':  _fmt(c.get('interest_income')),
        # Line 3b  — Ordinary dividends
        'f1_11[0]':  _fmt(c.get('ordinary_dividends')),
        # Line 7   — Net capital gain or (loss)
        'f1_16[0]':  _fmt((c.get('short_term_gains') or 0)
                          + (c.get('long_term_gains') or 0)),
        # Line 8   — Other income (Schedule 1) — NEC
        'f1_18[0]':  _fmt(c.get('se_income')),
        # Line 9   — Total income
        'f1_19[0]':  _fmt(c.get('gross_income')),
        # Line 11  — Adjusted gross income
        'f1_21[0]':  _fmt(c.get('agi')),
        # Line 12  — Standard deduction
        'f1_23[0]':  _fmt(c.get('standard_deduction')),
        # Line 15  — Taxable income
        'f1_26[0]':  _fmt(c.get('taxable_income')),
        # Line 16  — Tax
        'f1_27[0]':  _fmt(c.get('ordinary_tax')),
        # Line 17  — AMT (0 — not calculated)
        'f1_28[0]':  '',
        # Line 23  — Other taxes (SE tax + NIIT + add'l Medicare)
        'f1_34[0]':  _fmt(c.get('other_taxes')),
        # Line 24  — Total tax
        'f1_35[0]':  _fmt(c.get('total_tax')),
        # Line 25a — W-2 federal income tax withheld
        'f1_36[0]':  _fmt(c.get('total_withheld')),
        # Line 33  — Total payments
        'f1_44[0]':  _fmt(c.get('total_withheld')),
        # Line 34  — Refund amount (blank if owed)
        'f1_45[0]':  _fmt(c.get('refund')),
        # Line 37  — Amount owed (blank if refund)
        'f1_48[0]':  _fmt(c.get('amount_owed')),
    }

    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    writer.append(reader)

    # Attempt to fill; silently skip fields not present in this PDF version
    available = set(reader.get_fields() or {})
    filtered  = {k: v for k, v in field_map.items() if k in available}
    skipped   = [k for k in field_map if k not in available]

    for page in writer.pages:
        writer.update_page_form_field_values(page, filtered, auto_regenerate=False)

    with open(output_path, 'wb') as fh:
        writer.write(fh)

    print(f"Filled PDF written to: {output_path}")
    if skipped:
        print(f"\nNote: {len(skipped)} field(s) not found in this PDF "
              f"(names may differ for this form year):")
        for name in skipped:
            print(f"  {name!r}")
        print("\nRun `python form_filler.py --list-fields <pdf>` to see "
              "actual field names and update the mapping in form_filler.py.")


# ── CLI entry point ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='IRS 1040 PDF utilities',
    )
    parser.add_argument(
        '--list-fields',
        metavar='PDF',
        help='Print all fillable field names in the given IRS PDF',
    )
    args = parser.parse_args()

    if args.list_fields:
        list_fields(args.list_fields)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
