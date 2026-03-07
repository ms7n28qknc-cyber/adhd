#!/usr/bin/env bash
# deploy.sh — Upload changed files in site/ to GoDaddy via FTP
# Uses lftp's mirror command so only changed files are transferred.
# Reads credentials from .env in the same directory as this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
SITE_DIR="$SCRIPT_DIR/site"

# ── 1. Guard: .env must exist ─────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  ERROR: .env file not found at $ENV_FILE"
  echo "    Copy .env.example to .env and fill in your FTP credentials."
  exit 1
fi

# ── 2. Load credentials ───────────────────────────────────────────────────────
# shellcheck source=/dev/null
source "$ENV_FILE"

: "${FTP_HOST:?'FTP_HOST is not set in .env'}"
: "${FTP_USER:?'FTP_USER is not set in .env'}"
: "${FTP_PASS:?'FTP_PASS is not set in .env'}"
: "${FTP_REMOTE_DIR:=/}"

# ── 3. Guard: site/ directory must exist ─────────────────────────────────────
if [[ ! -d "$SITE_DIR" ]]; then
  echo "❌  ERROR: site/ directory not found at $SITE_DIR"
  exit 1
fi

# ── 4. Guard: lftp must be installed ─────────────────────────────────────────
if ! command -v lftp &>/dev/null; then
  echo "❌  ERROR: lftp is not installed."
  echo "    Install it with:  brew install lftp"
  exit 1
fi

# ── 5. Deploy ─────────────────────────────────────────────────────────────────
echo "🚀  Deploying $SITE_DIR  →  ftp://$FTP_HOST$FTP_REMOTE_DIR"
echo "    (Only changed/new files will be uploaded)"
echo ""

lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" <<EOF
set ftp:ssl-allow no
set net:timeout 30
set net:max-retries 3
set mirror:use-pget-n 5

# mirror flags:
#   --reverse          local → remote
#   --only-newer       skip files that haven't changed
#   --verbose          show each file being transferred
#   --no-perms         GoDaddy shared hosting ignores perms anyway
#   --parallel=5       upload up to 5 files at once
mirror --reverse --only-newer --verbose --no-perms --parallel=5 \
  "$SITE_DIR/" "$FTP_REMOTE_DIR"

bye
EOF

echo ""
echo "✅  Deployment complete."
