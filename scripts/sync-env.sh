#!/usr/bin/env bash
# .env.production → Vercel production 환경변수 동기화
# SSOT: .env.production (로컬 파일)
# 사용: ./scripts/sync-env.sh
set -euo pipefail

ENV_FILE="${1:-.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

echo "Syncing $ENV_FILE → Vercel production..."

while IFS= read -r line; do
  # Skip comments and empty lines
  [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  echo "  $key"
  echo "$val" | npx vercel env add "$key" production --force 2>/dev/null || \
  echo "$val" | npx vercel env add "$key" production 2>/dev/null || \
  echo "    ⚠ failed (may need vercel login)"
done < "$ENV_FILE"

echo "Done. Run 'npx vercel --prod' or push to redeploy."
