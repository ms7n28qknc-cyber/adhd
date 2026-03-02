"""
process_data.py - GP/ADHD prescribing data processor (standard library only)

Reads:
  /data/gp-registered-patients-by-practice-2015-01_to_2025-12.csv  (GP patients)
  /data/gp-prescribing-2023-2025-ADHD-only-combined-fixed.csv      (prescribing)

  GP_FILENAME must match the exact filename in your /data folder.
  Run with --list-data to print all CSV files found there.

Outputs to /site/data/:
  practices-index.json          - all practices for search/autocomplete
  practices/{id}.json           - per-practice detail
  overall-stats.json            - NI-wide monthly aggregates
  averages.json                 - per-capita yearly rates (NI, LCG, practice)

Optional CLI overrides:
  --data-dir <path>   default: /data
  --out-dir  <path>   default: /site/data
  --list-data         print CSV files in data-dir and exit
"""

import csv
import json
import os
import sys
from collections import defaultdict

GP_FILENAME = "gp-registered-patients-by-practice-2015-01_to_2025-12_v2.csv"
RX_FILENAME = "FinalList.csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_float(value, default=0.0):
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value, default=0):
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def build_address(*parts):
    """Join non-empty address parts with ', '."""
    return ", ".join(p.strip() for p in parts if p and p.strip())


def round2(value):
    return round(value, 2)


# ---------------------------------------------------------------------------
# Closure detection
# ---------------------------------------------------------------------------

def detect_closure(registered_patients, month_cols, end_month="2025-12", min_consecutive=6):
    """
    Determine whether a practice has closed.

    A practice is considered closed if its registered patient count is 0 (or
    missing) for at least `min_consecutive` consecutive months running all the
    way through to `end_month`.

    Returns:
        (closed: bool, closedDate: str|None)
        closedDate is the last month where patient count was > 0, formatted
        as "YYYY-MM".  None if the practice appears to have always been empty
        (data anomaly) or was not closed.
    """
    relevant = sorted(m for m in month_cols if m <= end_month)

    if not relevant or relevant[-1] != end_month:
        # Data doesn't reach end_month — can't assess closure reliably.
        return False, None

    if len(relevant) < min_consecutive:
        return False, None

    # Count consecutive zero/null months walking backwards from end_month.
    consecutive_zeros = 0
    last_with_patients = None

    for m in reversed(relevant):
        val = registered_patients.get(m)
        if val is None or val == 0:
            consecutive_zeros += 1
        else:
            last_with_patients = m
            break

    if consecutive_zeros < min_consecutive:
        return False, None

    # Require at least one month with patients — otherwise it's a data gap,
    # not a closure (e.g. a practice that never appeared in patient counts).
    if last_with_patients is None:
        return False, None

    return True, last_with_patients


# ---------------------------------------------------------------------------
# Step 1 – Read GP registered-patients file
# ---------------------------------------------------------------------------

def read_gp_file(path):
    """
    Returns:
        practices  : dict keyed by int PracNo ->
                     {doctorName, surgeryName, address, postcode, lcg,
                      registered_patients: {month_str: int|None}}
        month_cols : sorted list of month strings found in the header

    CSV columns:
        PracticeName  = lead doctor name  (e.g. "Dr. HOEY & PARTNERS")
        Address1      = surgery/practice name (e.g. "HARLAND MEDICAL PRACTICE")
        Address2+3    = street address
    """
    practices = {}
    month_cols = []

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        headers = reader.fieldnames or []

        # Identify monthly columns (format YYYY-MM)
        fixed_cols = {"PracNo", "PracticeName", "Address1", "Address2",
                      "Address3", "Postcode", "LCG"}
        month_cols = sorted(
            [h.strip() for h in headers if h.strip() not in fixed_cols and h.strip()],
        )

        for row in reader:
            prac_no_raw = row.get("PracNo", "").strip()
            if not prac_no_raw:
                continue
            prac_no = safe_int(prac_no_raw)
            if prac_no == 0:
                continue

            # Address1 is the surgery name; Address2+3 are the street address
            address = build_address(
                row.get("Address2", ""),
                row.get("Address3", ""),
            )

            registered = {}
            for m in month_cols:
                val = row.get(m, "").strip()
                registered[m] = safe_int(val) if val else None

            practices[prac_no] = {
                "doctorName": row.get("PracticeName", "").strip(),
                "surgeryName": row.get("Address1", "").strip(),
                "address": address,
                "postcode": row.get("Postcode", "").strip(),
                "lcg": row.get("LCG", "").strip(),
                "registered_patients": registered,
            }

    return practices, month_cols


# ---------------------------------------------------------------------------
# Step 2 – Read prescribing file and aggregate
# ---------------------------------------------------------------------------

def read_rx_file(path):
    """
    Returns:
        rx_by_practice : prac_no -> month -> drug -> brand ->
                         {items, quantity, gross, actual}
        overall        : month -> drug ->
                         {items, quantity, gross, actual}
        overall_practices_by_month : month -> set of prac_nos
        row_count      : int
        date_range     : (min_month, max_month)
    """
    rx = defaultdict(
        lambda: defaultdict(
            lambda: defaultdict(
                lambda: defaultdict(
                    lambda: {"items": 0, "quantity": 0.0,
                             "gross": 0.0, "actual": 0.0}
                )
            )
        )
    )

    overall = defaultdict(
        lambda: defaultdict(
            lambda: {"items": 0, "quantity": 0.0, "gross": 0.0, "actual": 0.0}
        )
    )

    overall_practices_by_month = defaultdict(set)

    row_count = 0
    all_months = set()

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            row_count += 1

            # Practice – stored as float string e.g. "1234.0"
            # Column may be "Practice" or "PRACTICE" depending on source file
            prac_raw = (row.get("Practice") or row.get("PRACTICE") or "").strip()
            if not prac_raw:
                continue
            prac_no = safe_int(prac_raw)
            if prac_no == 0:
                continue

            # Month key – prefer "month" column if YYYY-MM, else reconstruct
            month_raw = row.get("month", "").strip()
            if len(month_raw) == 7 and month_raw[4] == "-":
                month = month_raw
            else:
                year = row.get("Year", "").strip()
                mon = row.get("Month", "").strip().zfill(2)
                month = f"{year}-{mon}" if year and mon else month_raw

            if not month:
                continue

            drug = row.get("VTM_NM", "Unknown").strip() or "Unknown"
            brand = (row.get("AMP_NM", "").strip()
                     or row.get("VMP_NM", "").strip()
                     or "Unknown")

            items = safe_int(row.get("Total Items", 0))
            quantity = safe_float(row.get("Total Quantity", 0))
            gross = safe_float(row.get("Gross Cost (\xa3)", 0) or
                               row.get("Gross Cost (£)", 0))
            actual = safe_float(row.get("Actual Cost (\xa3)", 0) or
                                row.get("Actual Cost (£)", 0))

            cell = rx[prac_no][month][drug][brand]
            cell["items"] += items
            cell["quantity"] += quantity
            cell["gross"] += gross
            cell["actual"] += actual

            oc = overall[month][drug]
            oc["items"] += items
            oc["quantity"] += quantity
            oc["gross"] += gross
            oc["actual"] += actual

            overall_practices_by_month[month].add(prac_no)
            all_months.add(month)

    min_month = min(all_months) if all_months else ""
    max_month = max(all_months) if all_months else ""

    return rx, overall, overall_practices_by_month, row_count, (min_month, max_month)


# ---------------------------------------------------------------------------
# Step 3 – Build per-practice prescribing summary
# ---------------------------------------------------------------------------

def build_prescribing_for_practice(prac_rx):
    """
    prac_rx: month -> drug -> brand -> {items, quantity, gross, actual}

    Returns: month -> {
        total_items, total_quantity, gross_cost, actual_cost,
        drugs: {drug: {total_items, ..., brands: {brand: {...}}}}
    }
    """
    result = {}
    for month, drugs in prac_rx.items():
        month_total = {"items": 0, "quantity": 0.0, "gross": 0.0, "actual": 0.0}
        drug_summaries = {}

        for drug, brands in drugs.items():
            drug_total = {"items": 0, "quantity": 0.0, "gross": 0.0, "actual": 0.0}
            brand_details = {}

            for brand, agg in brands.items():
                drug_total["items"] += agg["items"]
                drug_total["quantity"] += agg["quantity"]
                drug_total["gross"] += agg["gross"]
                drug_total["actual"] += agg["actual"]
                brand_details[brand] = {
                    "total_items": agg["items"],
                    "total_quantity": round2(agg["quantity"]),
                    "gross_cost": round2(agg["gross"]),
                    "actual_cost": round2(agg["actual"]),
                }

            drug_summaries[drug] = {
                "total_items": drug_total["items"],
                "total_quantity": round2(drug_total["quantity"]),
                "gross_cost": round2(drug_total["gross"]),
                "actual_cost": round2(drug_total["actual"]),
                "brands": brand_details,
            }

            month_total["items"] += drug_total["items"]
            month_total["quantity"] += drug_total["quantity"]
            month_total["gross"] += drug_total["gross"]
            month_total["actual"] += drug_total["actual"]

        result[month] = {
            "total_items": month_total["items"],
            "total_quantity": round2(month_total["quantity"]),
            "gross_cost": round2(month_total["gross"]),
            "actual_cost": round2(month_total["actual"]),
            "drugs": drug_summaries,
        }

    return result


# ---------------------------------------------------------------------------
# Step 3.5 – Per-capita yearly rates
# ---------------------------------------------------------------------------

def build_yearly_rates(practices, rx_by_practice, month_cols):
    """
    For each practice, LCG, and NI as a whole, calculate the average monthly
    ADHD items per 1,000 registered patients for each calendar year.

    Formula per year:
        rate = (total_items_that_year / 12) / (avg_registered_patients / 1000)
             = total_items * 1000 / (12 * avg_registered_patients)

    A practice is excluded from a year's denominator if its average registered
    patients for that year is 0 (closed / not yet open).

    Returns:
        practice_rates : {prac_no: {year_str: float|None}}
        lcg_rates      : {lcg_name: {year_str: float|None}}
        ni_rates       : {year_str: float|None}
    """
    # Group month columns by year
    months_by_year = defaultdict(list)
    for m in month_cols:
        months_by_year[m[:4]].append(m)
    years = sorted(months_by_year)

    # NI and LCG accumulators: year -> {items, patients}
    ni_acc  = {y: {"items": 0, "patients": 0.0} for y in years}
    lcg_acc = defaultdict(lambda: {y: {"items": 0, "patients": 0.0} for y in years})

    practice_rates = {}

    for prac_no, info in practices.items():
        lcg = info["lcg"]
        reg = info["registered_patients"]
        prac_rx = rx_by_practice.get(prac_no, {})

        rates = {}
        for year in years:
            yr_months = months_by_year[year]

            # Mean registered patients (skip null months; treat as not recorded)
            patient_vals = [reg[m] for m in yr_months
                            if reg.get(m) is not None]
            avg_patients = (sum(patient_vals) / len(patient_vals)
                            if patient_vals else 0.0)

            if avg_patients <= 0:
                rates[year] = None
                continue

            # Total ADHD items across this year's months
            year_items = sum(
                agg["items"]
                for m in yr_months if m in prac_rx
                for brands in prac_rx[m].values()
                for agg in brands.values()
            )

            rate = round(year_items * 1000 / (12 * avg_patients), 2)
            rates[year] = rate

            # Accumulate into NI and LCG totals
            ni_acc[year]["items"]    += year_items
            ni_acc[year]["patients"] += avg_patients
            if lcg:
                lcg_acc[lcg][year]["items"]    += year_items
                lcg_acc[lcg][year]["patients"] += avg_patients

        practice_rates[prac_no] = rates

    # Compute NI rates
    ni_rates = {}
    for year in years:
        acc = ni_acc[year]
        if acc["patients"] > 0:
            ni_rates[year] = round(acc["items"] * 1000 / (12 * acc["patients"]), 2)
        else:
            ni_rates[year] = None

    # Compute LCG rates
    lcg_rates = {}
    for lcg, yr_map in lcg_acc.items():
        lcg_rates[lcg] = {}
        for year in years:
            acc = yr_map[year]
            if acc["patients"] > 0:
                lcg_rates[lcg][year] = round(
                    acc["items"] * 1000 / (12 * acc["patients"]), 2
                )
            else:
                lcg_rates[lcg][year] = None

    return practice_rates, lcg_rates, ni_rates


def write_averages(lcg_rates, ni_rates, out_dir):
    """Write averages.json with NI-wide and LCG-level yearly rates."""
    path = os.path.join(out_dir, "averages.json")
    write_json(path, {"ni": ni_rates, "lcg": lcg_rates})
    return path


# ---------------------------------------------------------------------------
# Step 4 – Write outputs
# ---------------------------------------------------------------------------

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"))


def write_practices_index(practices, out_dir):
    index = [
        {
            "id": prac_no,
            "doctorName": info["doctorName"],
            "surgeryName": info["surgeryName"],
            "address": info["address"],
            "postcode": info["postcode"],
            "lcg": info["lcg"],
            "closed": info.get("closed", False),
            "closedDate": info.get("closedDate"),
        }
        for prac_no, info in sorted(practices.items())
    ]
    path = os.path.join(out_dir, "practices-index.json")
    write_json(path, index)
    return path


def write_practice_files(practices, rx_by_practice, out_dir, practice_rates=None):
    practices_dir = os.path.join(out_dir, "practices")
    practice_rates = practice_rates or {}
    for prac_no, info in practices.items():
        prac_rx = rx_by_practice.get(prac_no, {})
        prescribing = build_prescribing_for_practice(prac_rx)
        doc = {
            "id": prac_no,
            "doctorName": info["doctorName"],
            "surgeryName": info["surgeryName"],
            "address": info["address"],
            "postcode": info["postcode"],
            "lcg": info["lcg"],
            "closed": info.get("closed", False),
            "closedDate": info.get("closedDate"),
            "registered_patients": info["registered_patients"],
            "yearlyRatePerCapita": practice_rates.get(prac_no, {}),
            "prescribing": prescribing,
        }
        write_json(os.path.join(practices_dir, f"{prac_no}.json"), doc)
    return practices_dir


def write_overall_stats(overall, overall_practices_by_month, out_dir, closed_practices_count=0):
    months_out = {}
    for month in sorted(overall.keys()):
        drugs = overall[month]
        month_total = {"items": 0, "quantity": 0.0, "gross": 0.0, "actual": 0.0}
        drug_summaries = {}

        for drug, agg in drugs.items():
            drug_summaries[drug] = {
                "total_items": agg["items"],
                "total_quantity": round2(agg["quantity"]),
                "gross_cost": round2(agg["gross"]),
                "actual_cost": round2(agg["actual"]),
            }
            month_total["items"] += agg["items"]
            month_total["quantity"] += agg["quantity"]
            month_total["gross"] += agg["gross"]
            month_total["actual"] += agg["actual"]

        months_out[month] = {
            "total_items": month_total["items"],
            "total_quantity": round2(month_total["quantity"]),
            "gross_cost": round2(month_total["gross"]),
            "actual_cost": round2(month_total["actual"]),
            "practices_prescribing": len(
                overall_practices_by_month.get(month, set())
            ),
            "drugs": drug_summaries,
        }

    path = os.path.join(out_dir, "overall-stats.json")
    write_json(path, {
        "closed_practices_count": closed_practices_count,
        "months": months_out,
    })
    return path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(data_dir="/data", out_dir="/site/data"):
    gp_file = os.path.join(data_dir, GP_FILENAME)
    rx_file = os.path.join(data_dir, RX_FILENAME)
    practices_dir = os.path.join(out_dir, "practices")
    os.makedirs(practices_dir, exist_ok=True)

    print("Reading GP registered-patients file …")
    practices, month_cols = read_gp_file(gp_file)
    print(
        f"  {len(practices)} practices, {len(month_cols)} monthly columns "
        f"({month_cols[0] if month_cols else '?'} – "
        f"{month_cols[-1] if month_cols else '?'})"
    )

    print("Reading prescribing file …")
    rx_by_practice, overall, overall_practices_by_month, row_count, (min_m, max_m) = (
        read_rx_file(rx_file)
    )
    print(
        f"  {row_count:,} rows, {len(rx_by_practice)} practices with prescriptions, "
        f"date range {min_m} – {max_m}"
    )

    print("Detecting closed practices …")
    closed_count = 0
    for prac_no, info in practices.items():
        closed, closed_date = detect_closure(info["registered_patients"], month_cols)
        info["closed"] = closed
        info["closedDate"] = closed_date
        if closed:
            closed_count += 1
    print(f"  {closed_count} practices identified as closed")

    print("Building per-capita yearly rates …")
    practice_rates, lcg_rates, ni_rates = build_yearly_rates(
        practices, rx_by_practice, month_cols
    )
    print(f"  {len(practice_rates)} practices, {len(lcg_rates)} LCGs, "
          f"{len(ni_rates)} years")

    print("Writing practices-index.json …")
    idx_path = write_practices_index(practices, out_dir)

    print("Writing per-practice JSON files …")
    prac_dir = write_practice_files(practices, rx_by_practice, out_dir, practice_rates)
    prac_files = [f for f in os.listdir(prac_dir) if f.endswith(".json")]
    print(f"  {len(prac_files)} files written")

    print("Writing overall-stats.json …")
    stats_path = write_overall_stats(overall, overall_practices_by_month, out_dir, closed_count)

    print("Writing averages.json …")
    avg_path = write_averages(lcg_rates, ni_rates, out_dir)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    def file_size(path):
        try:
            b = os.path.getsize(path)
            if b >= 1_048_576:
                return f"{b / 1_048_576:.1f} MB"
            if b >= 1024:
                return f"{b / 1024:.1f} KB"
            return f"{b} B"
        except OSError:
            return "?"

    total_prac_bytes = sum(
        os.path.getsize(os.path.join(prac_dir, f)) for f in prac_files
    )

    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Practices processed    : {len(prac_files)}")
    print(f"  Closed practices       : {closed_count}")
    print(f"  Prescribing rows       : {row_count:,}")
    print(f"  Date range             : {min_m} – {max_m}")
    print(f"  practices-index.json   : {file_size(idx_path)}")
    print(
        f"  practices/*.json total : {total_prac_bytes / 1024:.1f} KB "
        f"({len(prac_files)} files)"
    )
    print(f"  overall-stats.json     : {file_size(stats_path)}")
    print(f"  averages.json          : {file_size(avg_path)}")
    print("=" * 60)


if __name__ == "__main__":
    args = sys.argv[1:]
    data_dir = "/data"
    out_dir = "/site/data"
    list_data = False
    i = 0
    while i < len(args):
        if args[i] == "--data-dir" and i + 1 < len(args):
            data_dir = args[i + 1]
            i += 2
        elif args[i] == "--out-dir" and i + 1 < len(args):
            out_dir = args[i + 1]
            i += 2
        elif args[i] == "--list-data":
            list_data = True
            i += 1
        else:
            i += 1

    if list_data:
        try:
            csvs = sorted(f for f in os.listdir(data_dir) if f.endswith(".csv"))
            print(f"CSV files in {data_dir}:")
            for f in csvs:
                print(f"  {f}")
        except OSError as e:
            print(f"Cannot read {data_dir}: {e}", file=sys.stderr)
        sys.exit(0)

    main(data_dir=data_dir, out_dir=out_dir)
