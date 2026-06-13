#!/usr/bin/env bash
# Vercel 초기 세팅 (최초 1회 또는 환경 재구성 시)
# 1. 로그인 2. 프로젝트 연결 3. 환경변수 동기화
set -euo pipefail

echo "=== Step 1: Vercel 로그인 ==="
npx vercel whoami 2>/dev/null || npx vercel login

echo ""
echo "=== Step 2: 프로젝트 연결 ==="
npx vercel link --yes

echo ""
echo "=== Step 3: 환경변수 동기화 ==="
./scripts/sync-env.sh

echo ""
echo "=== 완료 ==="
echo "push하면 자동 배포됨. 수동 배포: npx vercel --prod"
