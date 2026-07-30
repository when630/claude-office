// 세션(5시간)·주간(7일) 사용률을 Claude Office가 읽을 수 있게 statusline에 한 줄 심는다.
//
// 왜 이런 짓을 하는가: 그 두 숫자는 Claude Code가 statusline 스크립트의 stdin으로만 넘긴다.
// ~/.claude 어디에도 파일로 남지 않고, CLI에도 꺼낼 명령이 없다. 그래서 statusline이 받은
// payload를 그대로 ~/.claude/office-usage.json에 떨어뜨리게 하고 앱은 그 파일만 읽는다
// (읽는 쪽은 main/usage.mjs).
//
// 손대는 파일은 사용자의 statusline 스크립트 하나뿐이고, 바꾸기 전에 .bak을 남긴다.
// 심는 코드는 try/catch로 감싸 있어 실패해도 statusline 자체는 그대로 돈다.
//
// 여기는 순수 로직만 둔다 — 출력도 process.exit도 하지 않는다. 트레이 메뉴(main/index.mjs)와
// CLI(tools/install-usage-tap.mjs)가 같은 함수를 쓰기 때문이다. 패키징본에는 npm도
// tools/도 없으므로 트레이 쪽이 사실상 유일한 입구다.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, USAGE_FILE } from './paths.mjs';

export const BEGIN = '# >>> claude-office usage tap >>>';
export const END = '# <<< claude-office usage tap <<<';

// 실패 사유. 트레이는 이걸로 안내 문구를 고르고, CLI는 그대로 찍는다.
export const REASONS = {
  'no-statusline': '~/.claude/settings.json에 statusLine 설정이 없습니다.',
  'not-powershell': 'statusLine이 가리키는 PowerShell 스크립트(.ps1)를 찾지 못했습니다.',
  'no-stdin-line': 'statusline 스크립트에서 stdin을 읽는 줄($x = [Console]::In.ReadToEnd())을 찾지 못했습니다.',
  'not-installed': '심어진 tap이 없습니다.',
  'already-installed': '이미 심어져 있습니다.',
  'write-failed': 'statusline 스크립트를 고쳐 쓰지 못했습니다.',
};

export function snippet(varName) {
  return [
    BEGIN,
    `# Claude Office가 세션·주간 사용률을 읽어가는 자리. payload를 그대로 남긴다.`,
    `# 지워도 statusline 동작에는 영향이 없다 (앱에서 사용량 표시만 사라진다).`,
    `try {`,
    `    $__officeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }`,
    `    [IO.File]::WriteAllText((Join-Path $__officeDir 'office-usage.json'), $${varName}, (New-Object System.Text.UTF8Encoding $false))`,
    `} catch { }`,
    END,
  ].join('\r\n');
}

function readSettings() {
  for (const name of ['settings.local.json', 'settings.json']) {
    const file = path.join(CLAUDE_DIR, name);
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json?.statusLine?.command) return { file, command: json.statusLine.command };
    } catch {
      /* 없거나 못 읽는 파일은 넘긴다 */
    }
  }
  return null;
}

// powershell ... -File "C:\...\statusline.ps1"  에서 경로만 뽑는다
function statuslinePath(command) {
  const quoted = command.match(/-File\s+"([^"]+)"/i) ?? command.match(/-File\s+(\S+)/i);
  if (quoted) return quoted[1];
  const bare = command.match(/([A-Za-z]:\\[^"]*?\.ps1|\/[^\s"]*?\.ps1)/);
  return bare ? bare[1] : null;
}

// statusline 스크립트를 찾는다. 못 찾은 이유까지 같이 돌려준다 — 안내에 그대로 쓴다.
export function findStatusline() {
  const found = readSettings();
  if (!found) return { file: null, command: null, reason: 'no-statusline' };
  const file = statuslinePath(found.command);
  if (!file || !file.toLowerCase().endsWith('.ps1') || !fs.existsSync(file)) {
    return { file: null, command: found.command, settings: found.file, reason: 'not-powershell' };
  }
  return { file, command: found.command, settings: found.file, reason: null };
}

function read(file) {
  const raw = fs.readFileSync(file);
  return {
    hadBom: raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf,
    text: raw.toString('utf8').replace(/^\uFEFF/, ''),
  };
}

// Korean Windows의 PowerShell 5.1은 BOM 없는 UTF-8을 cp949로 읽는다 —
// 한글 주석을 넣으므로 원래 BOM이 없었더라도 붙여서 저장한다.
function save(file, next) {
  const backup = `${file}.bak`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, `\uFEFF${next}`, 'utf8');
  return backup;
}

const BLOCK = new RegExp(
  `\\r?\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  'g',
);

// 지금 상태. 트레이 메뉴를 그릴 때마다 부른다 — 작은 파일 두세 개만 읽는다.
export function tapStatus() {
  const found = findStatusline();
  if (!found.file) return { installed: false, file: null, command: found.command, reason: found.reason };
  try {
    return { installed: read(found.file).text.includes(BEGIN), file: found.file, command: found.command, reason: null };
  } catch {
    return { installed: false, file: found.file, command: found.command, reason: 'not-powershell' };
  }
}

export function installTap() {
  const found = findStatusline();
  if (!found.file) return { ok: false, reason: found.reason, command: found.command };

  let text;
  let hadBom;
  try {
    ({ text, hadBom } = read(found.file));
  } catch {
    return { ok: false, reason: 'not-powershell', file: found.file };
  }
  if (text.includes(BEGIN)) return { ok: true, already: true, file: found.file };

  // stdin을 읽는 줄 바로 뒤에 끼워 넣는다 — 그 시점에 payload가 온전히 손에 있다.
  const stdinLine = text.match(/^([ \t]*)\$(\w+)\s*=\s*\[Console\]::In\.ReadToEnd\(\)[ \t]*$/m);
  if (!stdinLine) return { ok: false, reason: 'no-stdin-line', file: found.file };

  const insertAt = stdinLine.index + stdinLine[0].length;
  const next = `${text.slice(0, insertAt)}\r\n${snippet(stdinLine[2])}${text.slice(insertAt)}`;
  try {
    const backup = save(found.file, next);
    return { ok: true, file: found.file, backup, varName: stdinLine[2], hadBom };
  } catch (err) {
    return { ok: false, reason: 'write-failed', file: found.file, error: err.message };
  }
}

export function removeTap() {
  const found = findStatusline();
  if (!found.file) return { ok: false, reason: found.reason, command: found.command };

  let text;
  try {
    ({ text } = read(found.file));
  } catch {
    return { ok: false, reason: 'not-powershell', file: found.file };
  }
  if (!text.includes(BEGIN)) return { ok: true, already: true, file: found.file };

  try {
    const backup = save(found.file, text.replace(BLOCK, ''));
    return { ok: true, file: found.file, backup };
  } catch (err) {
    return { ok: false, reason: 'write-failed', file: found.file, error: err.message };
  }
}

// 자동으로 못 붙였을 때 띄우는 안내. 트레이 대화상자와 CLI가 같은 문구를 쓴다.
export function manualGuide() {
  return [
    'statusline이 stdin으로 받은 원본 JSON을 그대로 아래 경로에 쓰면 됩니다.',
    '',
    `  대상 파일: ${USAGE_FILE}`,
    '',
    'PowerShell ($raw에 stdin이 들어 있다고 할 때):',
    snippet('raw').replace(/\r\n/g, '\n'),
    '',
    'bash ($payload에 stdin이 들어 있다고 할 때):',
    `  printf '%s' "$payload" > "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/office-usage.json"`,
  ].join('\n');
}
