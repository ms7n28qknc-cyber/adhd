# ADHD Prescribing NI — Data Explorer

A static single-page application showing GP practice-level ADHD prescribing
data across Northern Ireland, 2015–2025.

---

## Repository layout

```
adhd/
├── process_data.py        # Data processing script (run locally)
├── README.md              # This file
├── data/                  # Source CSVs — NOT committed; keep locally
│   ├── gp-registered-patients-by-practice-2015-01_to_2025-12.csv
│   └── gp-prescribing-2023-2025-ADHD-only-combined-fixed.csv
└── site/                  # Everything under here gets uploaded to GoDaddy
    ├── .htaccess
    ├── index.html
    ├── css/style.css
    ├── js/app.js
    └── data/
        ├── practices-index.json
        ├── overall-stats.json
        └── practices/
            ├── 1001.json
            ├── 1002.json
            └── …
```

---

## Deployment — what to upload

Upload the **contents of the `site/` folder** (not the folder itself) to the
document root of your subdomain.  The result on the server should look like:

```
public_html/adhd/          ← or whatever your subdomain root is
├── .htaccess
├── index.html
├── css/
├── js/
└── data/
```

> **Tip:** Upload via File Manager in cPanel, or use an FTP client such as
> FileZilla pointing at the same path.

---

## Setting up the subdomain in GoDaddy cPanel

1. Log in to your GoDaddy account and open **cPanel**.
2. Under **Domains**, click **Subdomains**.
3. Fill in:
   - **Subdomain:** e.g. `adhd`
   - **Domain:** `themoment.blog`
   - **Document Root:** cPanel will suggest `public_html/adhd` — accept it.
4. Click **Create**.  DNS propagation can take a few minutes.
5. Upload the contents of `site/` into `public_html/adhd/` (or whichever
   root was set in step 3).
6. Visit `https://adhd.themoment.blog` to verify.

### Confirming `.htaccess` is active

GoDaddy shared hosting runs Apache with `mod_rewrite` enabled by default.
If you see a 500 error after uploading, temporarily rename `.htaccess` to
rule it out; then re-enable line by line.  The most common culprit is
`mod_expires` or `mod_deflate` not being loaded — both directives are wrapped
in `<IfModule>` so they fail silently, but the `Header` directives in
`mod_headers` may still cause issues on very restrictive hosts.  If so, remove
the `<FilesMatch>` blocks from `.htaccess`.

---

## Re-processing data when you get updated CSVs

### 1. Update the source files

Place the new CSVs in a local `/data/` directory (or anywhere you like — you
can override the path with `--data-dir`):

```
/data/gp-registered-patients-by-practice-2015-01_to_2025-12.csv
/data/gp-prescribing-2023-2025-ADHD-only-combined-fixed.csv
```

If your new GP patients file has a different name, either:

- **Update the constant** in `process_data.py`:
  ```python
  GP_FILENAME = "your-actual-filename.csv"
  ```
- **Or** run with `--list-data` to confirm what's in the folder:
  ```bash
  python3 process_data.py --list-data --data-dir /path/to/data
  ```

### 2. Run the processing script

```bash
# Default paths (/data → source, /site/data → output)
python3 process_data.py

# Custom paths
python3 process_data.py \
  --data-dir /path/to/your/csvs \
  --out-dir  /path/to/adhd/site/data
```

The script prints a summary including file sizes and date ranges.  It
requires only Python 3 standard library — no pip installs needed.

### 3. Update date references if the range changes

If the new data extends beyond 2025-12, update these two places:

| File | What to change |
|---|---|
| `site/js/app.js` | `DATA_START` and `DATA_END` constants (lines ~20-21) |
| `site/index.html` | Hero subtitle, meta description, intro paragraph, months KPI |

### 4. Re-upload

Upload only the regenerated files (everything inside `site/data/`) to the
server, overwriting the old versions.

---

## Per-practice file size

With 36 months of data (2023–2025), practice files average **~38 KB** each.

With 132 months (2015–2025, 3.7× more months), expect files around
**~130–150 KB** each — well under the ~1 MB threshold where client-side JSON
loading becomes noticeably slow.  The site fetches each practice file only
when a user navigates to that practice, so even at 300+ practices the total
payload is minimal.

---

## Data sources

| Dataset | Source |
|---|---|
| GP Registered Patients by Practice | [OpenDataNI — BSO](https://www.opendatani.gov.uk) |
| GP Prescribing Data (ADHD) | [OpenDataNI — BSO](https://www.opendatani.gov.uk) |

Both are published under the
[UK Open Government Licence (OGL) v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
