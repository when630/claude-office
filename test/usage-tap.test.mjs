// 사용량 tap이 statusline 스크립트를 고치는 규칙 (main/usage-tap.mjs).
// 남의 파일을 고치는 코드라 순서와 되돌리기를 붙잡아 둔다.
//
// CLAUDE_DIR은 모듈을 불러올 때 정해지므로 env를 먼저 세우고 동적으로 import한다.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tap-test-'));
const PS1 = path.join(TMP, 'statusline.ps1');
process.env.CLAUDE_CONFIG_DIR = TMP;

const { installTap, removeTap, tapStatus, PRE_BEGIN, PRE_END, BEGIN } = await import('../main/usage-tap.mjs');

// param()은 PowerShell에서 첫 실행문이어야 한다 — 머리말이 그 앞에 가면 스크립트가 깨진다.
const ORIGINAL = [
  '#Requires -Version 5',
  'param()',
  '$ErrorActionPreference = "SilentlyContinue"',
  '$raw = [Console]::In.ReadToEnd()',
  '$j = $raw | ConvertFrom-Json',
  'Write-Host "[$($j.model.display_name)]"',
].join('\r\n');

function body() {
  return fs.readFileSync(PS1, 'utf8').replace(/^﻿/, '');
}

function lineIndex(needle) {
  return body().split('\r\n').findIndex((l) => l.includes(needle));
}

beforeEach(() => {
  fs.writeFileSync(PS1, `﻿${ORIGINAL}`, 'utf8');
  fs.writeFileSync(
    path.join(TMP, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: `powershell -File "${PS1}"` } }),
  );
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('인코딩 머리말은 stdin을 읽는 줄 앞에, 저장은 뒤에 들어간다', () => {
  const res = installTap();
  assert.equal(res.ok, true);
  assert.equal(res.upgraded, false);

  const pre = lineIndex(PRE_BEGIN);
  const read = lineIndex('ReadToEnd');
  const tap = lineIndex(BEGIN);
  assert.ok(pre >= 0 && read >= 0 && tap >= 0, '세 블록이 다 있어야 한다');
  assert.ok(pre < read, '머리말이 읽기보다 앞이어야 인코딩이 적용된다');
  assert.ok(read < tap, '저장은 payload를 손에 든 뒤여야 한다');
});

test('param()은 첫 실행문으로 남는다 — 앞에 문장을 끼우면 스크립트가 깨진다', () => {
  installTap();
  const lines = body().split('\r\n');
  assert.ok(
    lines.findIndex((l) => l.trim() === 'param()') < lineIndex(PRE_BEGIN),
    'param()이 머리말보다 앞에 있어야 한다',
  );
});

test('머리말은 InputEncoding을 UTF-8로 맞춘다', () => {
  installTap();
  const text = body();
  assert.match(text, /\[Console\]::InputEncoding = New-Object System\.Text\.UTF8Encoding \$false/);
  // 실패해도 statusline 자체는 돌아야 한다
  assert.match(text, /try \{ \[Console\]::InputEncoding[\s\S]*?\} catch \{ \}/);
});

test('두 번 심어도 한 번만 들어간다', () => {
  installTap();
  const once = body();
  const again = installTap();
  assert.deepEqual({ ok: again.ok, already: again.already }, { ok: true, already: true });
  assert.equal(body(), once, '파일이 그대로여야 한다');
});

test('예전에 심어둔 tap에는 머리말만 보탠다', () => {
  installTap();
  // 머리말만 지워 예전 상태(인코딩 수정 전 버전이 심은 모양)를 만든다
  const old = body().replace(
    new RegExp(`\\r?\\n?${PRE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PRE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    '',
  );
  fs.writeFileSync(PS1, `﻿${old}`, 'utf8');
  assert.deepEqual(
    { installed: tapStatus().installed, hasEncoding: tapStatus().hasEncoding },
    { installed: true, hasEncoding: false },
    '예전 상태는 tap은 있고 머리말만 없다',
  );

  const res = installTap();
  assert.equal(res.upgraded, true);
  assert.equal(tapStatus().hasEncoding, true);
  // 저장 블록이 두 번 들어가면 payload를 두 번 쓴다
  assert.equal(body().split(BEGIN).length - 1, 1, '저장 블록은 하나여야 한다');
});

test('빼면 원본과 완전히 같아진다', () => {
  installTap();
  const res = removeTap();
  assert.equal(res.ok, true);
  assert.equal(body(), ORIGINAL);
  assert.deepEqual(
    { installed: tapStatus().installed, hasEncoding: tapStatus().hasEncoding },
    { installed: false, hasEncoding: false },
  );
});

test('머리말만 남아 있어도 빼 준다', () => {
  installTap();
  fs.writeFileSync(PS1, `﻿${body().replace(new RegExp(`\\r?\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?# <<< claude-office usage tap <<<`), '')}`, 'utf8');
  assert.equal(removeTap().ok, true);
  assert.equal(body(), ORIGINAL);
});

test('stdin을 읽는 줄이 없으면 손대지 않는다', () => {
  fs.writeFileSync(PS1, '﻿Write-Host "hi"', 'utf8');
  const res = installTap();
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'no-stdin-line' });
  assert.equal(body(), 'Write-Host "hi"', '파일이 그대로여야 한다');
});
