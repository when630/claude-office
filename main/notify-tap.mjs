// 무엇을 기다리는지 알아내기 — Claude Code의 Notification 훅을 심어 그 순간의 문구를 받아온다.
//
// 선택지가 떠 있는 동안 대화 파일에는 아무것도 안 쓰인다(docs/characters.md). 그래서 터미널
// 세션은 "기다린다"는 사실만 알고 무엇을 묻는지는 알 수 없었다. 훅은 그 순간
// `message`·`title`·`notification_type`을 넘겨주므로, 사용량 tap과 같은 방식으로 받아 둔다.
//
// 훅이 실행할 스크립트는 tap을 켤 때 userData에 써 둔다 — 패키징본의 asar 안에 있는 파일은
// 밖에서 node로 실행할 수 없다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLAUDE_DIR, NOTIFY_DIR } from './paths.mjs';
import { t, has } from '../shared/i18n.mjs';

const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

// 세션이 끝난 뒤 남은 파일을 언제까지 믿을지. 이보다 오래된 것은 읽지 않고 지운다.
const NOTE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// 실패 사유를 지금 언어의 문구로 (사용량 tap과 같은 규칙 — 사유 키는 결과에 그대로 남는다)
export function reasonText(reason) {
  const key = `ntap.reason.${reason}`;
  return has(key) ? t(key, { settings: SETTINGS }) : t('ntap.failed');
}

// 훅이 돌릴 스크립트. 세션마다 파일 하나를 덮어쓰므로 파일이 자라지 않는다.
// 조용히 실패해야 한다 — 여기서 죽으면 세션 쪽 알림이 막힌다.
//
// 주석은 앱 언어와 무관하게 영어다 — 사용량 tap의 심는 코드와 같은 이유다.
function scriptSource() {
  // .mjs로 저장하므로 ESM이다 — require는 여기서 정의되지 않는다(그렇게 썼다가 훅이 통째로
  // 죽는 것을 실측에서 잡았다).
  return `// Notification hook installed by Claude Office. Deleting it only silences
// "what it is waiting for" in the app. Overwrites one file per session.
import fs from 'node:fs';
import path from 'node:path';

const DIR = ${JSON.stringify(NOTIFY_DIR)};
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (buf += c));
process.stdin.on('end', () => {
  try {
    const p = JSON.parse(buf);
    // 파일 이름이 되므로 좁게 받는다
    const id = String(p.session_id ?? '').replace(/[^A-Za-z0-9._-]/g, '');
    if (!id) return;
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DIR, id + '.json'),
      JSON.stringify({
        at: Date.now(),
        sessionId: id,
        cwd: p.cwd ?? '',
        type: p.notification_type ?? '',
        title: p.title ?? '',
        message: p.message ?? '',
      }),
    );
  } catch {
    /* 훅은 조용히 실패해야 한다 */
  }
});
`;
}

function hasNode() {
  try {
    const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { encoding: 'utf8' });
    return res.status === 0 && Boolean(res.stdout?.trim());
  } catch {
    return false;
  }
}

function readSettings() {
  try {
    const text = fs.readFileSync(SETTINGS, 'utf8');
    const json = JSON.parse(text);
    return json && typeof json === 'object' ? json : {};
  } catch (err) {
    // 파일이 없는 건 정상 — 그때는 새로 만든다. 형식이 깨진 것과는 구분해야 한다.
    if (err.code === 'ENOENT') return {};
    return null;
  }
}

function saveSettings(next) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    // 손으로 고칠 파일이라 백업을 남긴다 (사용량 tap과 같은 규칙)
    if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak`);
    fs.writeFileSync(SETTINGS, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function commandFor(scriptPath) {
  return `node "${scriptPath}"`;
}

// 우리가 심은 항목인지. 스크립트 경로로 알아본다 — 남의 Notification 훅은 건드리지 않는다.
function isOurs(entry, scriptPath) {
  return (entry?.hooks ?? []).some((h) => typeof h?.command === 'string' && h.command.includes(scriptPath));
}

function notificationList(settings) {
  const list = settings?.hooks?.Notification;
  return Array.isArray(list) ? list : [];
}

export function notifyTapStatus(scriptPath) {
  const settings = readSettings();
  if (!settings) return { installed: false, reason: 'bad-settings', settings: SETTINGS };
  const installed = notificationList(settings).some((e) => isOurs(e, scriptPath));
  return { installed, reason: null, settings: SETTINGS };
}

export function installNotifyTap(scriptPath) {
  if (!hasNode()) return { ok: false, reason: 'no-node' };
  const settings = readSettings();
  if (!settings) return { ok: false, reason: 'bad-settings' };

  try {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, scriptSource(), 'utf8');
  } catch {
    return { ok: false, reason: 'write-failed' };
  }

  const list = notificationList(settings);
  if (list.some((e) => isOurs(e, scriptPath))) return { ok: true, already: true };

  // matcher는 생략한다 — permission_prompt와 idle_prompt를 다 받아야 무엇을 기다리는지 가른다
  const next = {
    ...settings,
    hooks: {
      ...(settings.hooks ?? {}),
      Notification: [...list, { hooks: [{ type: 'command', command: commandFor(scriptPath), timeout: 10 }] }],
    },
  };
  if (!saveSettings(next)) return { ok: false, reason: 'write-failed' };
  return { ok: true, already: false };
}

export function removeNotifyTap(scriptPath) {
  const settings = readSettings();
  if (!settings) return { ok: false, reason: 'bad-settings' };
  const list = notificationList(settings);
  const kept = list.filter((e) => !isOurs(e, scriptPath));
  if (kept.length === list.length) return { ok: true, already: true };

  const hooks = { ...(settings.hooks ?? {}) };
  // 남의 훅이 없으면 키째로 뺀다 — 빈 배열을 남겨두면 우리가 손댄 흔적만 남는다
  if (kept.length) hooks.Notification = kept;
  else delete hooks.Notification;

  const next = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;

  if (!saveSettings(next)) return { ok: false, reason: 'write-failed' };
  // 스크립트도 치운다. 남겨두면 무엇이 심어져 있는지 헷갈린다.
  try {
    fs.rmSync(scriptPath, { force: true });
  } catch {
    /* 못 지워도 훅은 이미 빠졌다 */
  }
  return { ok: true, already: false };
}

// 손으로 넣을 수 있게 — settings.json을 앱이 못 고치는 경우(형식이 깨졌거나 권한이 없을 때)
export function manualGuide(scriptPath) {
  return [
    t('ntap.guide.intro', { settings: SETTINGS }),
    '',
    JSON.stringify({ hooks: { Notification: [{ hooks: [{ type: 'command', command: commandFor(scriptPath) }] }] } }, null, 2),
    '',
    t('ntap.guide.script', { script: scriptPath }),
  ].join('\n');
}

// ── 앱이 읽는 쪽

// 세션 id → 지금 무엇을 기다리는지. 오래된 파일은 읽지 않고 지운다.
export function readNotes(now = Date.now()) {
  const notes = new Map();
  let entries;
  try {
    entries = fs.readdirSync(NOTIFY_DIR, { withFileTypes: true });
  } catch {
    return notes; // 연동을 켜지 않았으면 디렉터리가 없다
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const file = path.join(NOTIFY_DIR, e.name);
    try {
      const note = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!note?.sessionId || typeof note.at !== 'number') continue;
      if (now - note.at > NOTE_MAX_AGE_MS) {
        fs.rmSync(file, { force: true });
        continue;
      }
      notes.set(note.sessionId, note);
    } catch {
      /* 쓰는 중이라 깨진 파일 */
    }
  }
  return notes;
}

// 훅이 준 문구를 "무엇을 기다리는지"로 쓸 수 있는지.
//
// `idle_prompt`는 "한동안 조용하다"는 뜻이라 기다리는 내용이 아니다 — 그건 쓰지 않는다.
// 대기가 시작된 시각(statusAt)보다 뚜렷하게 앞선 알림도 버린다. 지난 대기의 잔재다.
const NOTE_SLACK_MS = 60_000;

export function noteNeeds(note, statusAt) {
  if (!note || note.type === 'idle_prompt') return '';
  if (statusAt && note.at < statusAt - NOTE_SLACK_MS) return '';
  return note.message || note.title || '';
}
