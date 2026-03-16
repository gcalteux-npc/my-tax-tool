# W-2 to Form 1040 (2025) Field Mapping

This document maps every W-2 box to its corresponding line(s) on the 2025 Form 1040.

---

## Primary Income & Withholding

| W-2 Box | W-2 Label | → | 1040 Line | 1040 Description | Notes |
|---|---|---|---|---|---|
| Box 1 | Wages, tips, other compensation | → | **1a** | Total amount from Form(s) W-2, box 1 | Primary wage entry. If multiple W-2s, sum all Box 1 values. |
| Box 2 | Federal income tax withheld | → | **25a** | Federal income tax withheld from Form(s) W-2 | Sum all W-2 Box 2 values if multiple employers. |
| Box 1 (sum) | — | → | **1z** | Add lines 1a through 1h | 1z = sum of 1a–1h. If only W-2 income, 1z = 1a. |
| Box 1 (sum) | — | → | **9** | Total income | Included in the sum: 1z + 2b + 3b + 4b + 5b + 6b + 7a + 8. |

---

## Wages Flowing Through Adjusted Gross Income

| W-2 Box | W-2 Label | → | 1040 Line | 1040 Description | Notes |
|---|---|---|---|---|---|
| Box 1 | Wages | → | **11a** | Adjusted gross income | AGI = Line 9 minus Line 10. Box 1 wages are the primary input. |
| Box 1 | Wages | → | **11b** | AGI (carried to page 2) | Line 11b mirrors 11a on page 2. |
| Box 1 | Wages | → | **15** | Taxable income | Taxable income = Line 11b minus Line 14 (deductions). |

---

## Tip Income

| W-2 Box | W-2 Label | → | 1040 Line | 1040 Description | Notes |
|---|---|---|---|---|---|
| Box 7 | Social security tips | → | **1a** | Wages, tips | Reported tips included in Box 1; no separate 1040 entry needed. |
| Box 8 | Allocated tips | → | **1h** | Other earned income | Allocated tips NOT included in Box 1; must be added separately on 1h. |
| Box 1c tip income | Tip income not in Box 1 | → | **1c** | Tip income not reported on line 1a | Use if tips were not reported to employer. |

---

## Dependent Care Benefits

| W-2 Box | W-2 Label | → | 1040 Line | 1040 Description | Notes |
|---|---|---|---|---|---|
| Box 10 | Dependent care benefits | → | **1e** | Taxable dependent care benefits from Form 2441, line 26 | Must complete Form 2441 first; only the taxable portion flows to 1e. |

---

## Adoption Benefits

| W-2 Box | W-2 Label | → | 1040 Line | 1040 Description | Notes |
|---|---|---|---|---|---|
| Box 12, Code T | Adoption benefits | → | **1f** | Employer-provided adoption benefits from Form 8839, line 31 | Must complete Form 8839 first. |

---

## Nonqualified Deferred Compensation

| W-2 Box | W-2 Label | → | 1040 Line | 1040 Description | Notes |
|---|---|---|---|---|---|
| Box 11 | Nonqualified deferred compensation | → | **1a** | Wages, tips, other compensation | Already included in Box 1; no separate 1040 line. |

---

## Box 12 Codes — Selected Key Items

| W-2 Box 12 Code | Description | → | 1040 Line | Notes |
|---|---|---|---|---|
| Code A | Uncollected SS tax on tips | → | **Schedule 2, Line 13** | Flows to 1040 via Schedule 2. |
| Code B | Uncollected Medicare tax on tips | → | **Schedule 2, Line 13** | Flows to 1040 via Schedule 2. |
| Code C | Taxable cost of group-term life insurance | → | **1a** | Already included in Box 1 wages. |
| Code D | 401(k) elective deferrals | → | *(no 1040 line)* | Pre-tax; reduces Box 1. Informational only. |
| Code E | 403(b) elective deferrals | → | *(no 1040 line)* | Pre-tax; reduces Box 1. Informational only. |
| Code G | 457(b) deferrals | → | *(no 1040 line)* | Pre-tax; reduces Box 1. Informational only. |
| Code J | Nontaxable sick pay | → | *(no 1040 line)* | Not included in Box 1; no entry required. |
| Code L | Substantiated employee business expense reimbursements | → | *(no 1040 line)* | Not taxable; informational only. |
| Code P | Excludable moving expense reimbursements (military) | → | *(no 1040 line)* | Not taxable for qualifying military. |
| Code Q | Nontaxable combat pay | → | **1i** | Nontaxable combat pay election. |
| Code R | Employer HSA contributions | → | **Schedule 2 / Form 8889** | Informational; HSA reported separately. |
| Code S | SIMPLE retirement deferrals | → | *(no 1040 line)* | Pre-tax; reduces Box 1. |
| Code T | Adoption benefits | → | **1f** | Via Form 8839. |
| Code W | Employer HSA contributions | → | **Form 8889** | Flows to Schedule 2 if excess. |
| Code AA | Roth 401(k) contributions | → | *(no 1040 line)* | After-tax; informational only. |
| Code DD | Cost of employer-sponsored health coverage | → | *(no 1040 line)* | Informational only; not taxable. |
| Code EE | Roth 403(b) contributions | → | *(no 1040 line)* | After-tax; informational only. |

---

## Box 13 Checkboxes

| W-2 Box 13 | Description | → | 1040 / Schedule Impact | Notes |
|---|---|---|---|---|
| Statutory employee | Worker is a statutory employee | → | **Schedule C** | Wages go on Schedule C, not Line 1a. |
| Retirement plan | Employee participated in employer plan | → | *(affects IRA deductibility)* | May limit deductible IRA contribution on Schedule 1. |
| Third-party sick pay | Sick pay from insurer | → | **1a** | Typically already in Box 1; may affect Schedule SE. |

---

## Social Security & Medicare Taxes (FICA)

| W-2 Box | W-2 Label | → | 1040 Line | Notes |
|---|---|---|---|---|
| Box 3 | Social security wages | → | *(no direct 1040 line)* | Used to verify SS tax; not entered on 1040 directly. |
| Box 4 | Social security tax withheld | → | **Schedule 2, Line 13** | Excess SS withheld (if multiple W-2s) may create a credit. |
| Box 5 | Medicare wages and tips | → | *(no direct 1040 line)* | Used for Additional Medicare Tax calculation (Form 8959). |
| Box 6 | Medicare tax withheld | → | *(no direct 1040 line)* | Reconciled on Form 8959 if wages > $200k. |

---

## State & Local (Not on Federal 1040)

| W-2 Box | W-2 Label | → | Federal 1040 Line | Notes |
|---|---|---|---|---|
| Box 15 | State / Employer state ID | → | *(state return only)* | Not used on federal Form 1040. |
| Box 16 | State wages, tips, etc. | → | *(state return only)* | Not used on federal Form 1040. |
| Box 17 | State income tax withheld | → | **Schedule A** (if itemizing) | Deductible as state tax on Schedule A, capped at $10,000 SALT. |
| Box 18 | Local wages, tips, etc. | → | *(local return only)* | Not used on federal Form 1040. |
| Box 19 | Local income tax withheld | → | **Schedule A** (if itemizing) | Included in SALT deduction, capped at $10,000. |
| Box 20 | Locality name | → | *(informational)* | Not used on federal Form 1040. |

---

## Summary Flow: W-2 → Form 1040 (Single W-2, No Other Income)

```
W-2 Box 1 (Wages)
    → 1040 Line 1a
    → 1040 Line 1z  (= 1a when no other wage types)
    → 1040 Line 9   (total income, assuming no other sources)
    → 1040 Line 11a (AGI, after Schedule 1 adjustments on Line 10)
    → 1040 Line 11b (AGI carried to page 2)
    → 1040 Line 15  (taxable income = 11b minus Line 14 deductions)
    → 1040 Line 16  (income tax per tax tables/brackets)
    → 1040 Line 24  (total tax = Line 22 + Line 23)

W-2 Box 2 (Federal Tax Withheld)
    → 1040 Line 25a
    → 1040 Line 25d (total withholding)
    → 1040 Line 33  (total payments)
    → 1040 Line 34  (overpayment, if Line 33 > Line 24)
    → 1040 Line 35a (refund) OR Line 37 (amount owed)
```

---

## Notes

- **Multiple W-2s:** Sum all Box 1 values for Line 1a; sum all Box 2 values for Line 25a.
- **Line 1z** is always the sum of lines 1a through 1h — it equals 1a only if no other wage types (tips, household wages, etc.) apply.
- **Line 9** adds 1z, 2b, 3b, 4b, 5b, 6b, 7a, and 8 — W-2 wages are only one component.
- **Schedule 2** handles additional taxes (SE tax, AMT, etc.) that feed into Line 17 and Line 23 on the 1040.
- **Schedule 3** handles additional credits that feed into Line 20 and Line 31 on the 1040.
