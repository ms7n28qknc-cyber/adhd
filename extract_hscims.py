#!/usr/bin/env python3
"""
extract_hscims.py
=================
Reads the HSCIMS 2025 data-tables workbook and extracts mental health
indicators for each HSC Trust and Northern Ireland overall.

Usage
-----
    # First run to inspect sheet structure:
    python extract_hscims.py --explore

    # Normal extraction (writes site/data/health-context.json):
    python extract_hscims.py

    # Override file paths:
    python extract_hscims.py --xlsx /path/to/file.xlsx --out /path/to/out.json

Output JSON structure
---------------------
{
  "moodAnxiety":    { "ni": {...}, "trusts": {...}, "deprivationQuintiles": {...} },
  "selfHarm":       { same structure, values per 1,000 (divided by 100) },
  "suicide":        { same structure, values per 1,000 (divided by 100) },
  "drugAdmissions": { same structure, if present },
  "alcoholDeaths":  { same structure, if present }
}
"""

import sys
import os
import json
import re
import openpyxl

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

XLSX_SEARCH_PATHS = [
    "data/hscims-report-2025-data-tables-by-area.xlsx",
    "/data/hscims-report-2025-data-tables-by-area.xlsx",
]

OUT_DEFAULT = "site/data/health-context.json"

# Sheet names to try (exact match, then case-insensitive)
SHEET_NI     = ["NI", "Northern Ireland"]
SHEET_TRUSTS = {
    "Belfast":       ["Belfast HSCT", "Belfast"],
    "Northern":      ["Northern HSCT", "Northern"],
    "South Eastern": ["South Eastern HSCT", "South Eastern", "South Eastern  HSCT"],
    "Southern":      ["Southern HSCT", "Southern"],
    "Western":       ["Western HSCT", "Western"],
}

# Years to extract
TARGET_YEARS = [2019, 2020, 2021, 2022, 2023]

# Indicator keyword → output key, scale factor (multiply raw value by this)
INDICATORS = {
    "moodAnxiety": {
        "keywords": ["mood", "anxiety"],   # all keywords must appear (case-insensitive)
        "scale": 1.0,                      # already per 1,000
        "required": True,
    },
    "selfHarm": {
        "keywords": ["self-harm", "self harm"],  # any one match is enough
        "scale": 1 / 100,                        # per 100,000 → per 1,000
        "required": True,
    },
    "suicide": {
        "keywords": ["suicide"],
        "scale": 1 / 100,
        "required": True,
    },
    "drugAdmissions": {
        "keywords": ["drug"],
        "scale": 1 / 100,
        "required": False,
    },
    "alcoholDeaths": {
        "keywords": ["alcohol"],
        "scale": 1 / 100,
        "required": False,
    },
}

# Column roles — in the typical HSCIMS layout each indicator table has:
#   col 0: year label
#   col 1: area total (NI overall or Trust total)
#   col 2: Quintile 1 / Most Deprived
#   col 3: Quintile 2
#   col 4: Quintile 3
#   col 5: Quintile 4
#   col 6: Quintile 5 / Least Deprived
# Adjust these if --explore reveals a different structure.
COL_YEAR     = 0
COL_AREA_AVG = 1
COL_Q1_DEPR  = 2   # most deprived
COL_Q5_LEAST = 6   # least deprived

# ---------------------------------------------------------------------------
# Workbook helpers
# ---------------------------------------------------------------------------

def find_xlsx(override=None):
    if override:
        if os.path.isfile(override):
            return override
        raise FileNotFoundError(f"Excel file not found: {override}")
    for p in XLSX_SEARCH_PATHS:
        if os.path.isfile(p):
            return p
    raise FileNotFoundError(
        "Excel file not found. Expected one of:\n  " +
        "\n  ".join(XLSX_SEARCH_PATHS) +
        "\nProvide the path with --xlsx /path/to/file.xlsx"
    )


def find_sheet(wb, names):
    """Return first matching sheet (exact then case-insensitive)."""
    sheets_lower = {s.lower(): s for s in wb.sheetnames}
    for name in names:
        if name in wb.sheetnames:
            return wb[name]
        if name.lower() in sheets_lower:
            return wb[sheets_lower[name.lower()]]
    return None


def cell_float(val):
    """Convert a cell value to float, or None."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        cleaned = val.replace(",", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def row_to_list(row, length=12):
    """Convert a worksheet row (tuple or list) to a padded list."""
    lst = list(row)
    while len(lst) < length:
        lst.append(None)
    return lst


# ---------------------------------------------------------------------------
# Sheet exploration
# ---------------------------------------------------------------------------

def explore_sheet(ws, max_rows=60):
    print(f"\n{'='*60}")
    print(f"Sheet: {ws.title}  (dims: {ws.dimensions})")
    print(f"{'='*60}")
    for i, row in enumerate(ws.iter_rows(max_row=max_rows, values_only=True), 1):
        non_empty = [(j, v) for j, v in enumerate(row) if v is not None]
        if non_empty:
            vals = "  |  ".join(f"[{j}] {repr(v)}" for j, v in non_empty[:8])
            print(f"  row {i:3d}: {vals}")


def explore(wb):
    print("Sheets:", wb.sheetnames)
    sheets_to_explore = [find_sheet(wb, SHEET_NI)] + [
        find_sheet(wb, names) for names in SHEET_TRUSTS.values()
    ]
    for ws in sheets_to_explore:
        if ws is not None:
            explore_sheet(ws)
        else:
            print("\n[Sheet not found]")


# ---------------------------------------------------------------------------
# Indicator extraction
# ---------------------------------------------------------------------------

def keyword_matches(cell_text, keywords):
    """Return True if cell_text contains any of the keyword phrases."""
    if not isinstance(cell_text, str):
        return False
    lower = cell_text.lower()
    # For mood/anxiety we require both words; for others, any one match
    if len(keywords) > 1 and all(k in lower for k in keywords if "&" not in k):
        return True
    return any(k.lower() in lower for k in keywords)


def find_indicator_row(ws, keywords, max_rows=300):
    """Return 1-based row index of first cell matching any keyword combo."""
    for i, row in enumerate(ws.iter_rows(max_row=max_rows, values_only=True), 1):
        for val in row:
            if keyword_matches(val, keywords):
                return i
    return None


def extract_year_block(ws, start_row, scale, max_scan=50):
    """
    Scan rows below start_row for year-labelled data rows.
    Returns dict: { year_str: {'area': float, 'q1': float, 'q5': float} }
    """
    result = {}
    rows = list(ws.iter_rows(
        min_row=start_row, max_row=start_row + max_scan, values_only=True
    ))

    # Try to auto-detect column header row (row with "quintile" or "deprived" text)
    area_col = COL_AREA_AVG
    q1_col   = COL_Q1_DEPR
    q5_col   = COL_Q5_LEAST

    for row in rows[:10]:
        vals = [str(v).lower() if v else "" for v in row]
        if any("quintile" in v or "deprived" in v or "q1" in v for v in vals):
            # Found header row — re-map columns
            for j, v in enumerate(vals):
                if "1" in v and ("deprived" in v or "quintile" in v):
                    q1_col = j
                elif "5" in v and ("least" in v or "quintile" in v):
                    q5_col = j
                elif any(word in v for word in ["total", "overall", "ni", "trust", "area", "rate"]):
                    if j > 0:
                        area_col = j
            break

    # Now scan for year rows
    for row in rows:
        padded = row_to_list(row)
        first = next((padded[j] for j in range(4) if padded[j] is not None), None)

        year = None
        if isinstance(first, int) and first in TARGET_YEARS:
            year = first
        elif isinstance(first, str):
            m = re.search(r'\b(201[5-9]|202[0-9])\b', first)
            if m:
                year = int(m.group(1))

        if year and year in TARGET_YEARS:
            area_val = cell_float(padded[area_col])
            q1_val   = cell_float(padded[q1_col])
            q5_val   = cell_float(padded[q5_col])

            def scale_val(v):
                return round(v * scale, 4) if v is not None else None

            result[str(year)] = {
                "area":    scale_val(area_val),
                "q1Deprived":  scale_val(q1_val),
                "q5Least":     scale_val(q5_val),
            }

    return result


def extract_indicator(ws, ind_key, ind_cfg):
    """Extract one indicator from a sheet. Returns year-keyed dict or None."""
    row_idx = find_indicator_row(ws, ind_cfg["keywords"])
    if row_idx is None:
        return None
    return extract_year_block(ws, row_idx + 1, ind_cfg["scale"])


# ---------------------------------------------------------------------------
# Main extraction logic
# ---------------------------------------------------------------------------

def extract_all(wb):
    output = {}

    ni_sheet = find_sheet(wb, SHEET_NI)
    if ni_sheet is None:
        print(f"WARNING: NI sheet not found. Tried: {SHEET_NI}", file=sys.stderr)

    trust_sheets = {}
    for trust_name, sheet_names in SHEET_TRUSTS.items():
        ws = find_sheet(wb, sheet_names)
        if ws is None:
            print(f"WARNING: Sheet for '{trust_name}' not found. Tried: {sheet_names}", file=sys.stderr)
        trust_sheets[trust_name] = ws

    for ind_key, ind_cfg in INDICATORS.items():
        print(f"\nExtracting: {ind_key}")

        # NI overall
        ni_data = {}
        ni_q1   = {}
        ni_q5   = {}
        if ni_sheet:
            block = extract_indicator(ni_sheet, ind_key, ind_cfg)
            if block:
                for yr, vals in block.items():
                    ni_data[yr] = vals["area"]
                    ni_q1[yr]   = vals["q1Deprived"]
                    ni_q5[yr]   = vals["q5Least"]
                print(f"  NI: found {len(block)} years")
            else:
                kw = ind_cfg["keywords"]
                print(f"  NI: indicator not found (keywords: {kw})")
                if ind_cfg["required"]:
                    print(f"  HINT: Run with --explore to inspect sheet layout")

        # Trust data
        trusts_out = {}
        for trust_name, ws in trust_sheets.items():
            if ws is None:
                continue
            block = extract_indicator(ws, ind_key, ind_cfg)
            if block:
                trusts_out[trust_name] = {
                    "average":     {yr: v["area"]       for yr, v in block.items()},
                    "mostDeprived":{yr: v["q1Deprived"] for yr, v in block.items()},
                }
                print(f"  {trust_name}: found {len(block)} years")
            else:
                print(f"  {trust_name}: indicator not found")

        if not ni_data and not trusts_out:
            if ind_cfg["required"]:
                print(f"  ERROR: Could not extract {ind_key} from any sheet")
            continue

        output[ind_key] = {
            "ni": ni_data,
            "trusts": trusts_out,
            "deprivationQuintiles": {
                "mostDeprived": ni_q1,
                "leastDeprived": ni_q5,
            },
        }

    return output


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    explore_mode = "--explore" in args
    xlsx_path    = None
    out_path     = OUT_DEFAULT

    i = 0
    while i < len(args):
        if args[i] == "--xlsx" and i + 1 < len(args):
            xlsx_path = args[i + 1]; i += 2
        elif args[i] == "--out" and i + 1 < len(args):
            out_path = args[i + 1]; i += 2
        else:
            i += 1

    try:
        xlsx_file = find_xlsx(xlsx_path)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading: {xlsx_file}")
    wb = openpyxl.load_workbook(xlsx_file, read_only=True, data_only=True)
    print(f"Sheets: {wb.sheetnames}")

    if explore_mode:
        explore(wb)
        return

    data = extract_all(wb)

    if not data:
        print("\nERROR: No data extracted. Run with --explore to inspect the workbook layout.")
        sys.exit(1)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), indent=2)

    print(f"\nWritten: {out_path}")
    print(f"  indicators: {list(data.keys())}")


if __name__ == "__main__":
    main()
