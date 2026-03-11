"""
process_england_data.py
-----------------------
Processes the combined England EPD ADHD dataset into the JSON files
the website needs. Designed to run on 8 GB RAM — reads the CSV in
chunks and aggregates immediately, so only ~300 MB of aggregated data
accumulates in memory rather than the full 2–4 GB raw file.

Inputs:
  adhd_england_all_years.csv   — combined output from nhsbsa_fetch.py

Outputs (all written to site/data/england/):
  practices-index.json         — lightweight search index for all practices
  practices/{code}.json        — per-practice monthly data + drug breakdown
  overview.json                — national monthly totals by drug
  icb-summary.json             — ICB-level monthly totals
  drug-mix.json                — national drug mix proportions over time
  rankings.json                — practice rankings (items only; run
                                  enrich_list_sizes.py to add rates)

Usage:
  python3 process_england_data.py
  python3 process_england_data.py --input path/to/other.csv
"""

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

# ── Configuration ─────────────────────────────────────────────────────────────

INPUT_FILE  = 'adhd_england_all_years.csv'
OUTPUT_DIR  = Path('site/data/england')
CHUNK_SIZE  = 50_000   # rows per chunk — conservative for 8 GB RAM

# Drugs to include — mirrors the NI site's drug breakdown exactly.
# Modafinil is included for consistency with NI (it appears in BNF 0404 but
# is not an ADHD treatment; included so comparisons are apples-to-apples).
# Caffeine and Pitolisant are excluded as they don't appear in NI data.
CORE_DRUGS = {
    'Methylphenidate hydrochloride',
    'Lisdexamfetamine dimesylate',
    'Dexamfetamine sulfate',
    'Atomoxetine hydrochloride',
    'Guanfacine',
    'Modafinil',
}

DRUG_SHORT = {
    'Methylphenidate hydrochloride': 'Methylphenidate',
    'Lisdexamfetamine dimesylate':   'Lisdexamfetamine',
    'Dexamfetamine sulfate':         'Dexamfetamine',
    'Atomoxetine hydrochloride':     'Atomoxetine',
    'Guanfacine':                    'Guanfacine',
    'Modafinil':                     'Modafinil',
}

# Metadata columns — preferred names. Older EPD months used different names
# for some fields (e.g. ICB_NAME was CCG_NAME / PCO_NAME before 2022).
# The metadata pass detects which are actually present and reads only those.
META_COLS_WANTED = [
    'YEAR_MONTH', 'PRACTICE_CODE', 'PRACTICE_NAME',
    'ADDRESS_1', 'ADDRESS_2', 'ADDRESS_3', 'ADDRESS_4', 'POSTCODE',
    'ICB_CODE', 'ICB_NAME', 'REGIONAL_OFFICE_NAME',
]
# Fallback column name mappings (old name → canonical name used in output)
META_COL_ALIASES = {
    'ICB_NAME':             ['CCG_NAME', 'PCO_NAME'],
    'REGIONAL_OFFICE_NAME': ['REGIONAL_TEAM_NAME', 'NHS_AREA_TEAM_NAME'],
    'ICB_CODE':             ['CCG_CODE', 'PCO_CODE'],
}


# ── Pass 1: chunked aggregation ───────────────────────────────────────────────

def aggregate_chunks(input_file):
    """
    Read the CSV in chunks of CHUNK_SIZE rows. Each chunk is immediately
    reduced to a small aggregated form (practice × month × drug → items/cost)
    before the next chunk is read. Only the aggregated mini-frames accumulate
    in memory.

    Returns a single aggregated DataFrame with columns:
      PRACTICE_CODE, ICB_CODE, MONTH, DRUG, items, cost
    """
    print(f'Reading {input_file} in {CHUNK_SIZE:,}-row chunks...')

    agg_frames = []
    total_raw  = 0
    chunk_num  = 0

    for chunk in pd.read_csv(
        input_file,
        chunksize=CHUNK_SIZE,
        dtype=str,
        low_memory=False,
    ):
        chunk_num  += 1
        total_raw  += len(chunk)

        # Filter to core drugs first (reduces chunk size before any other work)
        chunk = chunk[chunk['CHEMICAL_SUBSTANCE_BNF_DESCR'].isin(CORE_DRUGS)]
        if chunk.empty:
            continue

        # Convert numeric columns
        chunk = chunk.copy()
        chunk['ITEMS']       = pd.to_numeric(chunk['ITEMS'],       errors='coerce').fillna(0)
        chunk['ACTUAL_COST'] = pd.to_numeric(chunk['ACTUAL_COST'], errors='coerce').fillna(0)

        # Normalise month to YYYY-MM
        chunk['MONTH'] = chunk['YEAR_MONTH'].str[:4] + '-' + chunk['YEAR_MONTH'].str[4:]

        # Normalise ICB/CCG code column — older EPD months (pre-2022) use CCG_CODE
        for _alias in ['CCG_CODE', 'PCO_CODE']:
            if _alias in chunk.columns and 'ICB_CODE' not in chunk.columns:
                chunk = chunk.rename(columns={_alias: 'ICB_CODE'})
                break
        if 'ICB_CODE' not in chunk.columns:
            chunk['ICB_CODE'] = ''

        # Short drug label
        chunk['DRUG'] = chunk['CHEMICAL_SUBSTANCE_BNF_DESCR'].map(DRUG_SHORT)

        # Aggregate this chunk — from ~50k rows down to a few thousand
        agg = (
            chunk
            .groupby(['PRACTICE_CODE', 'ICB_CODE', 'MONTH', 'DRUG'], as_index=False)
            .agg(items=('ITEMS', 'sum'), cost=('ACTUAL_COST', 'sum'))
        )
        agg_frames.append(agg)

        print(f'  Chunk {chunk_num:>4}: {total_raw:>10,} rows read, '
              f'{sum(len(f) for f in agg_frames):>8,} aggregated rows kept',
              end='\r', flush=True)

    print(f'\n  Done — {total_raw:,} raw rows → combining aggregated frames...')

    # Combine all aggregated mini-frames and re-aggregate
    # (same practice/month/drug may appear in multiple chunks)
    combined = pd.concat(agg_frames, ignore_index=True)
    df = (
        combined
        .groupby(['PRACTICE_CODE', 'ICB_CODE', 'MONTH', 'DRUG'], as_index=False)
        .agg(items=('items', 'sum'), cost=('cost', 'sum'))
    )

    months    = df['MONTH'].nunique()
    practices = df['PRACTICE_CODE'].nunique()
    print(f'  {len(df):,} aggregated rows  ·  {practices:,} practices  ·  {months} months')
    print(f'  Date range: {df["MONTH"].min()}  →  {df["MONTH"].max()}')
    return df


# ── Pass 2: practice metadata ─────────────────────────────────────────────────

def build_practice_meta(input_file, practice_codes):
    """
    Read only the metadata columns from the CSV, keep the most recent
    record for each practice.  Uses the full file but loads only a
    small subset of columns so memory usage stays low.

    Column detection: reads the header first, then intersects with
    META_COLS_WANTED (falling back to aliases for columns that changed
    name across EPD versions, e.g. ICB_NAME vs CCG_NAME).
    """
    print('\nBuilding practice metadata (lightweight pass)...')

    # --- Detect available columns from header ---
    header_df  = pd.read_csv(input_file, nrows=0, dtype=str)
    all_cols   = set(header_df.columns)

    # Build the list of columns to actually request, resolving aliases
    col_map    = {}   # canonical_name → actual_csv_column_name
    usecols    = []

    for want in META_COLS_WANTED:
        if want in all_cols:
            col_map[want] = want
            usecols.append(want)
        else:
            # Try aliases
            for alias in META_COL_ALIASES.get(want, []):
                if alias in all_cols:
                    col_map[want] = alias
                    usecols.append(alias)
                    print(f'  Note: using {alias!r} as fallback for {want!r}')
                    break
            # If neither found, skip silently (row.get will return '')

    print(f'  Reading {len(usecols)} of {len(all_cols)} columns')

    latest_month = {}   # practice_code → most recent YEAR_MONTH string seen
    meta         = {}   # practice_code → metadata dict

    for chunk in pd.read_csv(
        input_file,
        chunksize=CHUNK_SIZE,
        usecols=usecols,
        dtype=str,
        low_memory=False,
    ):
        # Rename aliased columns back to canonical names for uniform access
        rename = {v: k for k, v in col_map.items() if k != v}
        if rename:
            chunk = chunk.rename(columns=rename)

        chunk = chunk[chunk['PRACTICE_CODE'].isin(practice_codes)]
        if chunk.empty:
            continue

        for _, row in chunk.drop_duplicates('PRACTICE_CODE').iterrows():
            code  = row['PRACTICE_CODE']
            month = row.get('YEAR_MONTH', '')

            if code not in latest_month or month > latest_month[code]:
                latest_month[code] = month

                addr_parts = [
                    row.get('ADDRESS_1', ''), row.get('ADDRESS_2', ''),
                    row.get('ADDRESS_3', ''), row.get('ADDRESS_4', ''),
                ]
                address = ', '.join(p for p in addr_parts if p and str(p) != 'nan')

                meta[code] = {
                    'code':     code,
                    'name':     row.get('PRACTICE_NAME', code),
                    'address':  address,
                    'postcode': row.get('POSTCODE', ''),
                    'icb_code': row.get('ICB_CODE', ''),
                    'icb_name': row.get('ICB_NAME', ''),
                    'region':   row.get('REGIONAL_OFFICE_NAME', ''),
                }

    print(f'  Metadata built for {len(meta):,} practices')
    return meta


# ── Output 1: practices-index.json ───────────────────────────────────────────

def write_practices_index(meta):
    print('\nWriting practices-index.json...')
    index = sorted(meta.values(), key=lambda x: x['name'])
    write_json(OUTPUT_DIR / 'practices-index.json', index)
    print(f'  {len(index):,} practices')


# ── Output 2: per-practice JSONs ──────────────────────────────────────────────

def write_practice_files(df, meta, icb_totals):
    """
    icb_totals: dict of {(icb_code, month): total_items}
    """
    print('\nWriting per-practice JSON files...')
    practice_dir = OUTPUT_DIR / 'practices'
    practice_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for code, pdata in df.groupby('PRACTICE_CODE'):
        m = meta.get(code, {'code': code, 'name': code})

        # Monthly totals and drug breakdown
        months_out = []
        for month, mdata in pdata.groupby('MONTH'):
            drugs      = {row['DRUG']: int(row['items'])
                          for _, row in mdata.iterrows() if row['items'] > 0}
            total_items = int(mdata['items'].sum())
            total_cost  = round(float(mdata['cost'].sum()), 2)

            entry = {
                'month':       month,
                'total_items': total_items,
                'total_cost':  total_cost,
                'drugs':       drugs,
            }

            icb_total = icb_totals.get((m.get('icb_code', ''), month))
            if icb_total:
                entry['icb_total_items'] = int(icb_total)

            months_out.append(entry)

        months_out.sort(key=lambda x: x['month'])
        write_json(practice_dir / f'{code}.json', {**m, 'months': months_out})
        count += 1

        if count % 500 == 0:
            print(f'  {count:,} files written...', end='\r', flush=True)

    print(f'  {count:,} practice files written          ')


# ── Output 3: overview.json ───────────────────────────────────────────────────

def write_overview(df):
    print('\nWriting overview.json...')
    pivot = (
        df.groupby(['MONTH', 'DRUG'])
        .agg(items=('items', 'sum'), cost=('cost', 'sum'))
        .unstack(fill_value=0)
    )

    months = []
    for month in sorted(pivot.index):
        drug_items = {drug: int(pivot[('items', drug)][month])
                      for drug in DRUG_SHORT.values()
                      if ('items', drug) in pivot.columns}
        months.append({
            'month':       month,
            'total_items': int(sum(drug_items.values())),
            'total_cost':  round(float(
                sum(pivot[('cost', drug)][month]
                    for drug in DRUG_SHORT.values()
                    if ('cost', drug) in pivot.columns)
            ), 2),
            'drugs': drug_items,
        })

    write_json(OUTPUT_DIR / 'overview.json', {'months': months})
    print(f'  {len(months)} months')


# ── Output 4: icb-summary.json ────────────────────────────────────────────────

def write_icb_summary(df, meta):
    print('\nWriting icb-summary.json...')

    # Build ICB name lookup from practice metadata
    icb_names = {}
    for m in meta.values():
        if m.get('icb_code'):
            icb_names[m['icb_code']] = {
                'name':   m.get('icb_name', m['icb_code']),
                'region': m.get('region', ''),
            }

    icb_monthly = df.groupby(['ICB_CODE', 'MONTH', 'DRUG']).agg(
        items=('items', 'sum')
    ).reset_index()

    icbs = {}
    for (icb_code, month), mdata in icb_monthly.groupby(['ICB_CODE', 'MONTH']):
        if icb_code not in icbs:
            info = icb_names.get(icb_code, {})
            icbs[icb_code] = {
                'code':   icb_code,
                'name':   info.get('name', icb_code),
                'region': info.get('region', ''),
                'months': [],
            }
        drugs       = {row['DRUG']: int(row['items']) for _, row in mdata.iterrows()}
        total_items = int(sum(drugs.values()))
        icbs[icb_code]['months'].append({
            'month':       month,
            'total_items': total_items,
            'drugs':       drugs,
        })

    for icb in icbs.values():
        icb['months'].sort(key=lambda x: x['month'])

    result = sorted(icbs.values(), key=lambda x: x['name'])
    write_json(OUTPUT_DIR / 'icb-summary.json', result)
    print(f'  {len(result)} ICBs')

    # Return lookup used by practice files
    icb_totals = {}
    for icb in result:
        for m in icb['months']:
            icb_totals[(icb['code'], m['month'])] = m['total_items']
    return icb_totals


# ── Output 5: drug-mix.json ───────────────────────────────────────────────────

def write_drug_mix(df):
    print('\nWriting drug-mix.json...')
    national = df.groupby(['MONTH', 'DRUG'])['items'].sum().unstack(fill_value=0)

    months = []
    for month in sorted(national.index):
        total = float(national.loc[month].sum())
        if total == 0:
            continue
        months.append({
            'month':       month,
            'total_items': int(total),
            'pct': {drug: round(float(national.at[month, drug]) / total * 100, 2)
                    for drug in national.columns},
        })

    write_json(OUTPUT_DIR / 'drug-mix.json', {'months': months})
    print(f'  {len(months)} months')


# ── Output 6: rankings.json ───────────────────────────────────────────────────

def write_rankings(df, meta):
    print('\nWriting rankings.json...')
    all_months = sorted(df['MONTH'].unique())
    last_12    = all_months[-12:]

    totals = (
        df[df['MONTH'].isin(last_12)]
        .groupby('PRACTICE_CODE')['items']
        .sum()
        .sort_values(ascending=False)
        .reset_index()
    )

    rankings = []
    for rank, (_, row) in enumerate(totals.iterrows(), 1):
        m = meta.get(row['PRACTICE_CODE'], {})
        rankings.append({
            'rank':      rank,
            'code':      row['PRACTICE_CODE'],
            'name':      m.get('name', row['PRACTICE_CODE']),
            'icb':       m.get('icb_name', ''),
            'region':    m.get('region', ''),
            'postcode':  m.get('postcode', ''),
            'items_12m': int(row['items']),
            'rate':      None,   # populated by enrich_list_sizes.py
        })

    write_json(OUTPUT_DIR / 'rankings.json', {
        'period':   f'{last_12[0]} – {last_12[-1]}',
        'note':     'Ranked by total items. Run enrich_list_sizes.py to add rates per 1,000 patients.',
        'rankings': rankings,
    })
    print(f'  {len(rankings):,} practices ranked')


# ── Utility ───────────────────────────────────────────────────────────────────

def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    input_file = INPUT_FILE
    if '--input' in sys.argv:
        input_file = sys.argv[sys.argv.index('--input') + 1]

    if not os.path.exists(input_file):
        print(f'Error: {input_file} not found.')
        print('Run: python3 nhsbsa_fetch.py --all-years')
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Pass 1: read in chunks, aggregate immediately
    df = aggregate_chunks(input_file)

    # Pass 2: lightweight metadata-only pass
    practice_codes = set(df['PRACTICE_CODE'].unique())
    meta = build_practice_meta(input_file, practice_codes)

    # Write all outputs
    write_practices_index(meta)
    icb_totals = write_icb_summary(df, meta)
    write_practice_files(df, meta, icb_totals)
    write_overview(df)
    write_drug_mix(df)
    write_rankings(df, meta)

    print(f'\nDone. Output written to {OUTPUT_DIR}')
    print('Next: run python3 enrich_list_sizes.py to add rates per 1,000 patients.')


if __name__ == '__main__':
    main()
