#!/usr/bin/env node
// Drive mp3 placeholder(~4KB) 전수 교체 — 앱 UI(mp3 백필) 로직을 헤드리스로 재현.
// data/<articleId>.mp3 중 20KB 미만(placeholder)만, mp3_cache/<vid>.mp3 실파일로 in-place PATCH.
// 재실행 안전(idempotent): 이미 실파일(>20KB)은 스킵.
//
// 사용:
//   TOKEN=<google_oauth_token> node scripts/drive-mp3-backfill.mjs [--dry] [--folder eng-trainer]
//   MP3_CACHE 로 소스 폴더 override 가능.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const PLACEHOLDER_MAX = 20_000; // 이 크기 미만 = placeholder

const TOKEN = process.env.TOKEN;
const DRY = process.argv.includes('--dry');
const folderArgIdx = process.argv.indexOf('--folder');
const FOLDER_NAME = folderArgIdx >= 0 ? process.argv[folderArgIdx + 1] : 'eng-trainer';
const MP3_CACHE = process.env.MP3_CACHE ||
  '/Users/mori/Obsidian/Obsidian_Master_v2/01 Command Center/proj-EnglishIdentityTrainer/001YoutubeLecture2DB/utils/expression2clip/cache/mp3_cache';

if (!TOKEN) { console.error('ERROR: TOKEN env 필요'); process.exit(1); }
if (!existsSync(MP3_CACHE)) { console.error('ERROR: mp3_cache 없음:', MP3_CACHE); process.exit(1); }

async function drive(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Drive ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function findFolder(name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
  const res = await drive(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function listFilesIn(folderId) {
  const q = `'${folderId}' in parents and trashed=false`;
  const fields = 'nextPageToken,files(id,name,size)';
  const out = [];
  let pageToken;
  do {
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000&spaces=drive${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await (await drive(url)).json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// 앱 extractVideoIds 재현
function extractVideoIds(a) {
  const ids = new Set();
  const t = a.title?.match(/_([A-Za-z0-9_-]{11})$/);
  if (t) ids.add(t[1]);
  const s = a.source?.match(/(?:youtu\.be\/|[?&]v=|embed\/|\/v\/)([A-Za-z0-9_-]{11})/);
  if (s) ids.add(s[1]);
  return [...ids];
}

async function main() {
  console.log(`folder=${FOLDER_NAME}  dry=${DRY}  cache=${MP3_CACHE}`);

  const rootId = await findFolder(FOLDER_NAME);
  if (!rootId) throw new Error(`root 폴더 '${FOLDER_NAME}' 없음`);
  const dataId = await findFolder('data', rootId);
  if (!dataId) throw new Error(`data 폴더 없음`);

  const files = await listFilesIn(dataId);
  const fileMap = new Map(files.map(f => [f.name, { id: f.id, size: Number(f.size || 0) }]));

  const indexFile = files.find(f => f.name === 'index.json');
  if (!indexFile) throw new Error('index.json 없음');
  const index = JSON.parse(await (await drive(`${DRIVE_API}/files/${indexFile.id}?alt=media`)).text());
  const articles = index.articles || [];
  console.log(`index.json articles=${articles.length}, data files=${files.length}`);

  // mp3_cache 목록
  const cacheFiles = new Set((await readdir(MP3_CACHE)).filter(n => /^[A-Za-z0-9_-]{11}\.mp3$/.test(n)));
  console.log(`mp3_cache real files=${cacheFiles.size}`);

  let replaced = 0, skipped = 0, noEntry = 0, noVid = 0, noSource = 0, failed = 0;
  const failures = [];

  for (const a of articles) {
    const entry = fileMap.get(`${a.id}.mp3`);
    if (!entry) { noEntry++; continue; }               // Drive에 mp3 자체 없음
    if (entry.size > PLACEHOLDER_MAX) { skipped++; continue; } // 이미 실파일

    const vids = extractVideoIds(a);
    if (!vids.length) { noVid++; failures.push(`novid: ${a.id} "${a.title}"`); continue; }
    const vid = vids.find(v => cacheFiles.has(`${v}.mp3`));
    if (!vid) { noSource++; failures.push(`nosrc: ${a.id} vids=${vids.join(',')}`); continue; }

    const srcPath = path.join(MP3_CACHE, `${vid}.mp3`);
    const buf = await readFile(srcPath);
    const srcSize = (await stat(srcPath)).size;
    if (srcSize <= PLACEHOLDER_MAX) { noSource++; failures.push(`srcplaceholder: ${vid} ${srcSize}B`); continue; }

    if (DRY) { console.log(`[dry] ${a.id}.mp3 ← ${vid}.mp3 (${entry.size}B → ${srcSize}B)`); replaced++; continue; }

    try {
      await drive(`${UPLOAD_API}/files/${entry.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'audio/mpeg' },
        body: buf,
      });
      replaced++;
      console.log(`✓ ${a.id}.mp3 ← ${vid}.mp3 (${entry.size}B → ${srcSize}B)`);
    } catch (e) {
      failed++;
      failures.push(`fail: ${a.id} ${e.message}`);
      if (e.status === 401) { console.error('토큰 만료(401) — 중단. 재로그인 후 재실행하면 이어감.'); break; }
    }
  }

  console.log('\n=== 요약 ===');
  console.log(`${DRY ? '[dry] ' : ''}교체=${replaced}  스킵(이미실파일)=${skipped}  Drive에mp3없음=${noEntry}  vid없음=${noVid}  소스없음=${noSource}  실패=${failed}`);
  if (failures.length) {
    console.log('\n--- 미처리/실패 상세 ---');
    for (const f of failures.slice(0, 50)) console.log('  ' + f);
    if (failures.length > 50) console.log(`  ... +${failures.length - 50}건`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
