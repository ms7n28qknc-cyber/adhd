#!/usr/bin/env python3
"""
assign_deprivation.py — Enrich GP practice data with NIMDM 2017 deprivation quintiles.

Reads postcode → SOA code automatically from the NISRA Postcode Lookup Dataset.
No manual CSV entry required.

Run:  python3 assign_deprivation.py

Outputs:
    • site/data/practices-index.json      — adds deprivationQuintile field (1-5)
    • site/data/practices/{id}.json       — adds deprivationQuintile field
    • site/data/rankings.json             — adds deprivationQuintile field
    • site/data/deprivation-analysis.json — rates by quintile and year
"""

import csv, json, os, sys, xlrd

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
SITE_DATA    = os.path.join(SCRIPT_DIR, 'site', 'data')

# NISRA Postcode Lookup Dataset (Feb 2026) — lives in site/data/
POSTCODE_CSV = os.path.join(SITE_DATA, 'Postcode lookup dataset February 2026 csv.csv')

QUINTILE_LABELS = {
    1: 'Most Deprived',
    2: 'Deprived',
    3: 'Middle',
    4: 'Less Deprived',
    5: 'Least Deprived',
}


def mdm_rank_to_quintile(rank):
    r = int(rank)
    if r <= 178: return 1
    if r <= 356: return 2
    if r <= 534: return 3
    if r <= 712: return 4
    return 5


def build_soa_quintile_map():
    """Read NIMDM17_SOAresults.xls → {soa_code: quintile}"""
    path = os.path.join(SITE_DATA, 'NIMDM17_SOAresults.xls')
    wb   = xlrd.open_workbook(path)
    ws   = wb.sheet_by_name('MDM')
    m    = {}
    for i in range(1, ws.nrows):
        code = str(ws.cell_value(i, 2)).strip()   # SOA2001 code (e.g. 95GG35S1)
        rank = ws.cell_value(i, 4)                # MDM rank (1 = most deprived)
        if code and rank:
            m[code] = mdm_rank_to_quintile(rank)
    return m


def build_postcode_soa_map(needed_postcodes):
    """
    Read the NISRA Postcode Lookup CSV → {postcode: soa_code}.
    Only loads rows for postcodes we actually need (for speed).
    Postcodes are normalised to uppercase with spaces removed (e.g. BT12JR).
    """
    needed = {pc.replace(' ', '').upper() for pc in needed_postcodes}

    if not os.path.exists(POSTCODE_CSV):
        print(f'\n  ❌  Postcode lookup CSV not found:\n     {POSTCODE_CSV}')
        print('     Download from https://www.nisra.gov.uk/support/geography/northern-ireland-postcode-lookup')
        sys.exit(1)

    lookup  = {}
    skipped = 0
    with open(POSTCODE_CSV, newline='', encoding='utf-8-sig') as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            pc = row['postcode'].strip().upper()
            if pc not in needed:
                skipped += 1
                continue
            soa = row.get('MSOA_current', '').strip()
            if soa:
                lookup[pc] = soa

    return lookup


def main():
    print('=== Deprivation Enrichment ===\n')

    # 1. Build SOA code → quintile map from NIMDM17
    soa_q = build_soa_quintile_map()
    print(f'NIMDM17: {len(soa_q)} SOA codes loaded')

    # 2. Load practice postcodes
    idx_file  = os.path.join(SITE_DATA, 'practices-index.json')
    prac_dir  = os.path.join(SITE_DATA, 'practices')
    rank_file = os.path.join(SITE_DATA, 'rankings.json')

    with open(idx_file) as f:
        practices = json.load(f)

    all_postcodes = [p.get('postcode', '') for p in practices]

    # 3. Build postcode → SOA code map from NISRA lookup CSV
    pc_soa = build_postcode_soa_map(all_postcodes)
    print(f'Postcode lookup: {len(pc_soa)}/{len(set(pc.replace(" ","").upper() for pc in all_postcodes if pc))} postcodes resolved')

    def get_quintile(postcode):
        pc  = (postcode or '').replace(' ', '').upper()
        soa = pc_soa.get(pc)
        if not soa:
            return None
        q = soa_q.get(soa)
        if q is None:
            print(f'  Warning: SOA code "{soa}" not found in NIMDM17 (postcode {pc})')
        return q

    # 4. Assign quintiles to practices index
    unmatched = []
    practice_q = {}   # id → quintile (or None)
    q_counts   = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}

    for p in practices:
        q = get_quintile(p.get('postcode', ''))
        p['deprivationQuintile'] = q
        practice_q[p['id']] = q
        if q:
            q_counts[q] = q_counts.get(q, 0) + 1
        else:
            unmatched.append(p)

    if unmatched:
        print(f'\n  ⚠️  {len(unmatched)} practices could not be assigned a quintile:')
        for p in unmatched[:10]:
            print(f'    {p["id"]}: {p.get("surgeryName","?")} [{p.get("postcode","?")}]')

    print(f'\nQuintile distribution: {q_counts}')

    # 5. Save practices-index.json
    with open(idx_file, 'w') as f:
        json.dump(practices, f, separators=(',', ':'))
    print('Saved practices-index.json')

    # 6. Update individual practice files
    updated = 0
    for fn in sorted(os.listdir(prac_dir)):
        if not fn.endswith('.json'):
            continue
        fp = os.path.join(prac_dir, fn)
        with open(fp) as f:
            p = json.load(f)
        p['deprivationQuintile'] = practice_q.get(p.get('id'))
        with open(fp, 'w') as f:
            json.dump(p, f, separators=(',', ':'))
        updated += 1
    print(f'Updated {updated} individual practice files')

    # 7. Update rankings.json
    if os.path.exists(rank_file):
        with open(rank_file) as f:
            rankings = json.load(f)
        for r in rankings:
            r['deprivationQuintile'] = practice_q.get(r.get('id'))
        with open(rank_file, 'w') as f:
            json.dump(rankings, f, separators=(',', ':'))
        print('Updated rankings.json')

    # 8. Calculate deprivation-analysis.json
    print('\nCalculating deprivation rates by quintile…')
    years = [str(y) for y in range(2015, 2026)]

    # Accumulators per quintile per year: [total_items, sum_avg_monthly_patients]
    acc = {q: {y: [0.0, 0.0] for y in years} for q in range(1, 6)}
    ni  = {y: [0.0, 0.0] for y in years}

    for fn in sorted(os.listdir(prac_dir)):
        if not fn.endswith('.json'):
            continue
        pid = int(fn.replace('.json', ''))
        q   = practice_q.get(pid)
        if not q:
            continue
        fp = os.path.join(prac_dir, fn)
        with open(fp) as f:
            p = json.load(f)

        rx  = p.get('prescribing', {})
        reg = p.get('registered_patients', {})

        for yr in years:
            items  = sum(rx[m].get('total_items', 0) for m in rx if m.startswith(yr))
            pts_ms = [v for k, v in reg.items() if k.startswith(yr) and v is not None and v > 0]
            if not pts_ms:
                continue
            avg_pt = sum(pts_ms) / len(pts_ms)
            acc[q][yr][0] += items
            acc[q][yr][1] += avg_pt
            ni[yr][0]     += items
            ni[yr][1]     += avg_pt

    by_quintile = {}
    for q in range(1, 6):
        rates = {'label': QUINTILE_LABELS[q]}
        for yr in years:
            it, pt = acc[q][yr]
            rates[yr] = round(it * 1000 / pt, 2) if pt > 0 else None
        by_quintile[str(q)] = rates

    ni_avg = {}
    for yr in years:
        it, pt = ni[yr]
        ni_avg[yr] = round(it * 1000 / pt, 2) if pt > 0 else None

    unmapped_count = sum(1 for p in practices if p.get('deprivationQuintile') is None)

    output = {
        'byQuintile':              by_quintile,
        'practiceCountByQuintile': {str(q): q_counts.get(q, 0) for q in range(1, 6)},
        'niAverage':               ni_avg,
        'unmappedCount':           unmapped_count,
    }

    out_file = os.path.join(SITE_DATA, 'deprivation-analysis.json')
    with open(out_file, 'w') as f:
        json.dump(output, f, indent=2)
    print('Saved deprivation-analysis.json')

    # Summary
    print('\n=== Rates per 1,000 patients (2025) ===')
    for q in range(1, 6):
        r = by_quintile[str(q)].get('2025')
        print(f'  Q{q} {QUINTILE_LABELS[q]}: {r}')
    print(f'  NI average: {ni_avg.get("2025")}')
    print(f'\n✅  Done! Now run: git add -A && git commit -m "Add deprivation analysis" && bash deploy.sh')


if __name__ == '__main__':
    main()
