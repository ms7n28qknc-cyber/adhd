"""
enrich_list_sizes.py
--------------------
Fetches GP practice list sizes (registered patient counts) from the
OpenPrescribing API and uses them to add rates (items per 1,000 patients)
to the England JSON files produced by process_england_data.py.

Run this after process_england_data.py has completed.

Usage:
  python3 enrich_list_sizes.py
"""

import json
import sys
from pathlib import Path

import pandas as pd
import requests

OUTPUT_DIR = Path('site/data/england')
API_BASE   = 'https://openprescribing.net/api/1.0'


# ── Fetch all list sizes ──────────────────────────────────────────────────────

def fetch_list_sizes():
    """
    Pull total registered patients per practice per month from OpenPrescribing.
    Returns a DataFrame with columns: practice_code, month, list_size
    """
    if Path('list_sizes.json').exists():
        import json as _j
        print('Reading from list_sizes.json...')
        import pandas as _pd
        data = _j.loads(Path('list_sizes.json').read_text())
        df = _pd.DataFrame(data)
        df = df.rename(columns={'row_id': 'practice_code', 'date': 'month'})
        df['month'] = _pd.to_datetime(df['month']).dt.strftime('%Y-%m')
        df['list_size'] = _pd.to_numeric(df['total_list_size'], errors='coerce')
        df = df[['practice_code', 'month', 'list_size']].dropna(subset=['list_size'])
        df['list_size'] = df['list_size'].astype(int)
        print(f'  {len(df):,} practice-month records')
        print(f'  Months: {df["month"].min()} -> {df["month"].max()}')
        return df
    print('Fetching practice list sizes from OpenPrescribing...')

    response = requests.get(
        f'{API_BASE}/org_details/',
        params={
            'org_type': 'practice',
            'keys':     'total_list_size',
            'format':   'json',
        },
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()

    df = pd.DataFrame(data)
    df = df.rename(columns={'row_id': 'practice_code', 'date': 'month'})
    df['month'] = pd.to_datetime(df['month']).dt.strftime('%Y-%m')
    df['list_size'] = pd.to_numeric(df['total_list_size'], errors='coerce')

    df = df[['practice_code', 'month', 'list_size']].dropna(subset=['list_size'])
    df['list_size'] = df['list_size'].astype(int)

    print(f'  {len(df):,} practice-month list size records')
    print(f'  Months: {df["month"].min()}  →  {df["month"].max()}')
    return df


# ── Enrich per-practice files ─────────────────────────────────────────────────

def enrich_practices(list_sizes):
    practice_dir = OUTPUT_DIR / 'practices'
    files        = list(practice_dir.glob('*.json'))

    # Build a quick lookup: (code, month) → list_size
    ls = list_sizes.set_index(['practice_code', 'month'])['list_size']

    print(f'Enriching {len(files):,} practice files...')
    enriched = 0

    for i, path in enumerate(files, 1):
        code = path.stem
        with open(path) as f:
            data = json.load(f)

        changed = False
        for entry in data.get('months', []):
            month     = entry['month']
            list_size = ls.get((code, month))

            if list_size and list_size > 0:
                entry['list_size'] = int(list_size)
                entry['rate']      = round(entry['total_items'] / list_size * 1000, 4)
                changed = True

        if changed:
            with open(path, 'w') as f:
                json.dump(data, f, separators=(',', ':'))
            enriched += 1

        if i % 500 == 0:
            print(f'  {i:,} / {len(files):,} processed...', end='\r', flush=True)

    print(f'  {enriched:,} practice files updated          ')


# ── Enrich rankings.json ──────────────────────────────────────────────────────

def enrich_rankings(list_sizes):
    path = OUTPUT_DIR / 'rankings.json'
    if not path.exists():
        print('rankings.json not found — skipping')
        return

    print('Updating rankings.json with rates...')

    with open(path) as f:
        data = json.load(f)

    # Derive the period from the file
    period_months = data.get('period', '').split('–')
    if len(period_months) == 2:
        start, end = period_months[0].strip(), period_months[1].strip()
        valid_months = list_sizes[
            (list_sizes['month'] >= start) & (list_sizes['month'] <= end)
        ]
    else:
        valid_months = list_sizes

    # Average list size per practice over the period
    avg_list = valid_months.groupby('practice_code')['list_size'].mean()

    for entry in data['rankings']:
        code     = entry['code']
        avg_size = avg_list.get(code)
        if avg_size and avg_size > 0:
            # Rate = items per 1,000 patients per month (averaged over 12 months)
            entry['rate'] = round(entry['items_12m'] / avg_size / 12 * 1000, 4)

    # Re-sort by rate (practices without a rate go to the bottom)
    data['rankings'].sort(
        key=lambda x: x['rate'] if x['rate'] is not None else -1,
        reverse=True,
    )
    for i, entry in enumerate(data['rankings'], 1):
        entry['rank'] = i

    data['note'] = 'Ranked by items per 1,000 registered patients per month (12-month average).'

    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

    rated = sum(1 for e in data['rankings'] if e['rate'] is not None)
    print(f'  {rated:,} of {len(data["rankings"]):,} practices have rates')


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not (OUTPUT_DIR / 'practices').exists():
        print('Error: practice files not found.')
        print('Run process_england_data.py first.')
        sys.exit(1)

    list_sizes = fetch_list_sizes()
    enrich_practices(list_sizes)
    enrich_rankings(list_sizes)

    print()
    print('Done. Practice files and rankings now include rates per 1,000 patients.')


if __name__ == '__main__':
    main()
