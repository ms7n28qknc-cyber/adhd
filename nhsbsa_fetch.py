"""
nhsbsa_fetch.py
---------------
Fetches ADHD medication prescribing data from the NHSBSA English Prescribing
Dataset (EPD) — England, monthly, GP practice level.

The NHSBSA portal does not support server-side filtering, so this script:
  1. Resolves the download URL via the CKAN resource_show API
  2. Streams the monthly CSV (200–500 MB) to a temp file
  3. Reads it back in chunks, keeping only BNF prefix '0404' rows
  4. Saves the filtered output (~few hundred KB)
  5. Deletes the raw temp file

BNF section 0404 = CNS Stimulants and Drugs Used for ADHD:
  Methylphenidate, Lisdexamfetamine, Atomoxetine, Dexamfetamine, Guanfacine

Usage:
  python3 nhsbsa_fetch.py                    # fetch RESOURCE_ID (default month)
  python3 nhsbsa_fetch.py --list-resources   # show all available months + IDs
"""

import os
import sys
import zipfile

import pandas as pd
import requests

# ── Configuration ─────────────────────────────────────────────────────────────

RESOURCE_API  = 'https://opendata.nhsbsa.net/api/3/action/resource_show'
PACKAGE_API   = 'https://opendata.nhsbsa.net/api/3/action/package_show'
PACKAGE_SLUG  = 'english-prescribing-data-epd'

# Default: most recent available month (June 2025 = EPD_202506).
# Run --list-resources to see all available IDs.
RESOURCE_ID   = '07442fa4-4701-49a1-bd70-11cdc18ee039'
OUTPUT_FILE   = 'adhd_england_202506.csv'

# --all-years: skip months whose EPD name sorts before this value.
# EPD names are like 'EPD_201501', so string comparison works fine.
# Set to 'EPD_201501' to start from January 2015.
START_MONTH   = 'EPD_201501'

BNF_PREFIX    = '0404'      # BNF chapter 4, section 4 = CNS stimulants / ADHD
CHUNK_ROWS    = 100_000     # Rows per chunk when reading CSV
DL_CHUNK_BYTES = 1_048_576  # 1 MB per streaming chunk during download


# ── Step 1: resolve the download URL ─────────────────────────────────────────

def get_download_url(resource_id):
    """Return (url, format_string) for the given CKAN resource ID."""
    r = requests.get(RESOURCE_API, params={'id': resource_id}, timeout=30)
    r.raise_for_status()
    payload = r.json()

    if not payload.get('success'):
        raise RuntimeError(
            f'resource_show failed.\nError: {payload.get("error", {})}'
        )

    result = payload['result']
    url    = result.get('url') or result.get('download_url')
    if not url:
        raise RuntimeError(
            f'No download URL in resource metadata. Keys: {list(result.keys())}'
        )

    fmt  = result.get('format', '').upper()
    size = result.get('size')
    size_str = f'{int(size) / 1_048_576:.0f} MB' if size else 'size unknown'

    print(f'Resource : {result.get("name", resource_id)}  [{fmt}]  ({size_str})')
    print(f'URL      : {url}')
    return url, fmt


# ── Step 2: stream to disk ────────────────────────────────────────────────────

def stream_download(url, dest_path):
    """Stream-download url → dest_path, printing MB progress."""
    print(f'\nDownloading → {dest_path}')

    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        total   = int(r.headers.get('Content-Length', 0))
        written = 0

        with open(dest_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=DL_CHUNK_BYTES):
                if chunk:
                    f.write(chunk)
                    written += len(chunk)
                    mb = written / 1_048_576
                    if total:
                        print(f'  {mb:.0f} / {total/1_048_576:.0f} MB  ({written/total*100:.0f}%)',
                              end='\r', flush=True)
                    else:
                        print(f'  {mb:.0f} MB', end='\r', flush=True)

    print(f'\nDownloaded {written / 1_048_576:.1f} MB')


# ── Step 3: unzip if needed ───────────────────────────────────────────────────

def maybe_unzip(file_path):
    """If file_path is a ZIP, extract the first CSV and return its path."""
    if not zipfile.is_zipfile(file_path):
        return file_path

    print('Archive detected — extracting CSV...')
    out_dir = file_path + '_extracted'
    os.makedirs(out_dir, exist_ok=True)

    with zipfile.ZipFile(file_path, 'r') as zf:
        csvs = [n for n in zf.namelist() if n.lower().endswith('.csv')]
        if not csvs:
            raise RuntimeError(f'No CSV found inside {file_path}')
        zf.extract(csvs[0], out_dir)
        print(f'Extracted: {csvs[0]}')
        return os.path.join(out_dir, csvs[0])


# ── Step 4: chunk-filter to ADHD rows ────────────────────────────────────────

def filter_to_adhd(csv_path, output_path):
    """
    Read csv_path in CHUNK_ROWS-row chunks, keep rows where BNF_CODE starts
    with BNF_PREFIX, write to output_path.  Returns the filtered DataFrame.
    """
    print(f'\nFiltering to BNF prefix {BNF_PREFIX!r}...')

    bnf_col   = None
    kept      = []
    total_in  = 0

    for chunk in pd.read_csv(csv_path, chunksize=CHUNK_ROWS, dtype=str, low_memory=False):
        total_in += len(chunk)

        if bnf_col is None:
            # Detect BNF code column on first chunk
            candidates = ['BNF_CODE', 'BNF_CHEMICAL_SUBSTANCE_CODE']
            bnf_col = next((c for c in candidates if c in chunk.columns), None)
            if bnf_col is None:
                print(f'\nColumns in file: {list(chunk.columns)}')
                raise RuntimeError('Could not find a BNF code column.')
            print(f'BNF column : {bnf_col}')

        match = chunk[chunk[bnf_col].str.startswith(BNF_PREFIX, na=False)]
        if not match.empty:
            kept.append(match)

        print(f'  {total_in:,} rows scanned, {sum(len(d) for d in kept):,} kept...',
              end='\r', flush=True)

    print()  # newline after \r progress

    if not kept:
        raise RuntimeError(
            f'No rows matched prefix {BNF_PREFIX!r}. '
            f'Check BNF_PREFIX or inspect the file manually.'
        )

    df = pd.concat(kept, ignore_index=True)
    df.to_csv(output_path, index=False)

    pct = len(df) / total_in * 100
    print(f'Scanned {total_in:,} rows  →  kept {len(df):,} ({pct:.2f}%)')
    print(f'Saved → {output_path}')
    return df


# ── Summary ───────────────────────────────────────────────────────────────────

def print_summary(df):
    print()
    print('─' * 55)
    print('SUMMARY')
    print('─' * 55)
    print(f'Rows       : {len(df):,}')
    print(f'Columns    : {list(df.columns)}')

    # Drug names
    name_col = next(
        (c for c in ['BNF_DESCRIPTION', 'BNF_CHEMICAL_SUBSTANCE',
                     'CHEMICAL_SUBSTANCE_BNF_DESCR', 'BNF_NAME']
         if c in df.columns), None
    )
    if name_col:
        names = df[name_col].dropna().unique()
        print(f'\nUnique entries in {name_col} ({len(names)}):')
        for n in sorted(names):
            print(f'  {n}')

    # Items
    items_col = next(
        (c for c in ['ITEMS', 'TOTAL_ITEMS', 'QUANTITY'] if c in df.columns), None
    )
    if items_col:
        total = pd.to_numeric(df[items_col], errors='coerce').sum()
        print(f'\nTotal items : {total:,.0f}')

    print('─' * 55)


# ── list-resources ────────────────────────────────────────────────────────────

def list_resources():
    r = requests.get(PACKAGE_API, params={'id': PACKAGE_SLUG}, timeout=30)
    r.raise_for_status()
    resources = r.json()['result']['resources']
    print(f'\n{len(resources)} resources in EPD package:\n')
    for res in sorted(resources, key=lambda x: x.get('name', ''), reverse=True):
        print(f"  {res.get('name', 'unnamed'):<45}  {res['id']}")
    print()


# ── Cleanup helper ────────────────────────────────────────────────────────────

def cleanup(tmp_raw, csv_path):
    """Delete the raw downloaded file (and any unzip directory) from disk."""
    import shutil
    try:
        if os.path.exists(tmp_raw):
            os.remove(tmp_raw)
            print(f'Deleted raw file : {tmp_raw}')
    except OSError as e:
        print(f'Warning: could not delete {tmp_raw}: {e}')
    if csv_path != tmp_raw:
        unzip_dir = os.path.dirname(csv_path)
        try:
            if os.path.exists(unzip_dir):
                shutil.rmtree(unzip_dir)
                print(f'Deleted unzip dir: {unzip_dir}')
        except OSError as e:
            print(f'Warning: could not delete {unzip_dir}: {e}')


# ── Fetch one month (download → filter → delete raw) ─────────────────────────

def fetch_one(resource_id, output_file):
    """
    Download, filter, and clean up one EPD month.
    Raw file is deleted in a finally block so disk space is always freed,
    even if filtering fails.
    """
    url, fmt = get_download_url(resource_id)

    ext     = '.zip' if 'ZIP' in fmt else '.csv'
    tmp_raw = output_file.replace('.csv', f'_raw{ext}')
    csv_path = tmp_raw  # may be updated to extracted path below

    try:
        stream_download(url, tmp_raw)
        csv_path = maybe_unzip(tmp_raw)
        df = filter_to_adhd(csv_path, output_file)
        return df
    finally:
        # Always delete raw files — even if an error occurred mid-filter
        cleanup(tmp_raw, csv_path)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f'NHSBSA EPD  —  ADHD prescribing fetch')
    print(f'Resource ID : {RESOURCE_ID}')
    print(f'Output      : {OUTPUT_FILE}')
    print()

    df = fetch_one(RESOURCE_ID, OUTPUT_FILE)
    print_summary(df)


def main_all():
    """
    Fetch every available EPD month, filter to ADHD rows, save individual
    CSVs, and combine into one file.  Raw downloads are deleted before the
    next month starts so disk usage stays low.
    """
    import shutil

    r = requests.get(PACKAGE_API, params={'id': PACKAGE_SLUG}, timeout=30)
    r.raise_for_status()
    resources = sorted(
        r.json()['result']['resources'],
        key=lambda x: x.get('name', ''),
    )

    # Filter to months at or after START_MONTH
    resources = [r for r in resources if r.get('name', '') >= START_MONTH]
    print(f'Found {len(resources)} months to fetch (from {START_MONTH} onwards).\n')

    combined_path = 'adhd_england_all_years.csv'
    header_written = False

    for i, res in enumerate(resources, 1):
        name = res.get('name', res['id'])
        rid  = res['id']
        out  = f'adhd_{name.lower()}.csv'

        print(f'\n[{i}/{len(resources)}] {name}')
        print('─' * 55)

        try:
            df = fetch_one(rid, out)
            df['EPD_MONTH'] = name

            # Append to combined file
            df.to_csv(
                combined_path,
                mode='a',
                index=False,
                header=not header_written,
            )
            header_written = True
            print(f'Appended {len(df):,} rows to {combined_path}')

            # Remove the per-month filtered file to save space
            if os.path.exists(out):
                os.remove(out)

        except Exception as e:
            print(f'  ERROR — skipping {name}: {e}')
            # Raw file cleanup already happened inside fetch_one's finally block

    print(f'\nDone. Combined output: {combined_path}')


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if '--list-resources' in sys.argv:
        list_resources()
    elif '--all-years' in sys.argv:
        main_all()
    else:
        main()
