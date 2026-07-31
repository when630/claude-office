// 발견한 세션의 터미널을 열어 준다.
//
// 앱에서 세션에 답을 대신 밀어넣지는 않는다 — 남의 터미널 stdin을 건드리는 일이다.
// 여기서 하는 일은 "그 작업 디렉터리에서 attach 명령을 실행하는 터미널 창 하나"까지다.
//
// 렌더러가 만든 명령 문자열은 받지 않는다. id만 받아 여기서 조립한다 — 렌더러에서 온
// 문자열을 그대로 셸에 넘기면 그게 곧 임의 명령 실행 통로가 된다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { t, has } from '../shared/i18n.mjs';

// 셸에 들어가는 값이라 좁게 받는다. 세션 id는 UUID, 잡 id는 짧은 hex다.
const ID_OK = /^[A-Za-z0-9._-]{1,128}$/;

// 실패 사유를 지금 언어로. 돌려주는 결과에는 사유 키(reason)를 그대로 남기고 문구만 여기서
// 만든다 — 부르는 쪽이 키로 분기할 수 있어야 한다.
export function reasonText(reason) {
  const key = `terminal.reason.${reason}`;
  return has(key) ? t(key) : t('terminal.failed');
}

export function attachCommand({ jobId, sessionId } = {}) {
  if (jobId && ID_OK.test(jobId)) return `claude attach ${jobId}`;
  if (sessionId && ID_OK.test(sessionId)) return `claude --resume ${sessionId}`;
  return null;
}

// spawn 실패(ENOENT 등)는 비동기로 온다 — 'spawn'이 먼저 오면 떴다는 뜻이다.
function trySpawn(file, args, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: 'ignore', ...opts });
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      // 앱을 종료해도 열어 준 터미널은 남아야 한다
      child.unref();
      resolve(true);
    });
  });
}

// 셸을 띄우고 그 안에서 명령을 돌린다. claude를 바로 실행하면 세션이 끝나는 순간 창이 닫혀
// 무슨 일이 있었는지 볼 수 없다. Windows Terminal이 있으면 이미 열린 창에 새 탭으로 붙인다(-w 0).
async function openWindows(dir, cmd) {
  const shell = ['powershell', '-NoExit', '-Command', cmd];
  if (await trySpawn('wt.exe', ['-w', '0', 'nt', ...(dir ? ['-d', dir] : []), ...shell])) return true;
  // Windows Terminal이 없는 환경 — conhost로 떨어진다. start의 첫 인자는 창 제목이라 비워 둔다.
  const args = ['/c', 'start', '', ...shell];
  // cwd가 사라진 뒤에 spawn하면 ENOENT가 난다 — 그때는 디렉터리 없이 한 번 더 시도한다
  if (dir && (await trySpawn('cmd.exe', args, { cwd: dir }))) return true;
  return trySpawn('cmd.exe', args);
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function appleQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// 맥은 Terminal.app에 새 창을 띄운다. iTerm을 쓰더라도 세션에 붙는 것은 같다.
function openMac(dir, cmd) {
  const line = dir ? `cd ${shQuote(dir)} && ${cmd}` : cmd;
  const script = `tell application "Terminal"\n  activate\n  do script ${appleQuote(line)}\nend tell`;
  return trySpawn('osascript', ['-e', script]);
}

export async function openTerminal({ cwd, jobId, sessionId } = {}) {
  const cmd = attachCommand({ jobId, sessionId });
  if (!cmd) return { ok: false, reason: 'no-id' };

  // 디렉터리가 사라졌으면 그냥 홈에서 연다 — cwd는 편의일 뿐이고 명령 자체는 어디서든 돈다
  let dir = null;
  try {
    if (cwd && fs.statSync(cwd).isDirectory()) dir = cwd;
  } catch {
    /* 사라진 디렉터리 */
  }

  if (process.platform === 'win32') {
    return (await openWindows(dir, cmd)) ? { ok: true, cmd } : { ok: false, reason: 'failed', cmd };
  }
  if (process.platform === 'darwin') {
    return (await openMac(dir, cmd)) ? { ok: true, cmd } : { ok: false, reason: 'failed', cmd };
  }
  return { ok: false, reason: 'unsupported', cmd };
}
