// 자동 업데이트 — GitHub Releases의 latest.yml을 읽어 새 버전을 백그라운드로 받아 둔다.
// 트레이 상주 앱이라 사용자가 앱을 끌 일이 거의 없으므로, 받아두고 알린 뒤
// 트레이 메뉴의 재시작을 기다린다. 그냥 두면 다음 종료 때 조용히 설치된다.
//
// electron-updater는 CJS 모듈이라 named import가 ESM에서 깨진다 — default로 받아 푼다.
// (electron-userland/electron-builder#7976)
import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// onReady(version): 새 버전을 받아 뒀을 때 한 번 불린다.
// onManual(version): 받아둘 수 없는 플랫폼에서 새 버전을 발견했을 때 한 번 불린다.
// 설정 창이 읽는 상태. 트레이 메뉴의 재시작 항목(updateReady)과 별개로 "지금 어디까지 왔나"를 적는다.
//   idle | checking | available | downloading | ready | manual | error | unsupported
const state = { status: 'idle', version: null, percent: 0, error: null, checkedAt: null };
let onStateChange = () => {};
const emit = () => onStateChange(state);

export function updaterState() {
  return { ...state, manual: process.platform === 'darwin' };
}

// 사용자에게 보일 한 줄로 줄인다. 내부 경로나 스택은 내보내지 않는다.
function shortError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT/.test(msg)) return 'offline';
  if (/404/.test(msg)) return 'no-release';
  if (/rate limit/i.test(msg)) return 'rate-limit';
  return msg.split('\n')[0].slice(0, 120) || 'unknown';
}

export function initUpdater({ onReady, onManual, onChange }) {
  onStateChange = onChange ?? (() => {});
  // 개발 실행에서는 아무것도 걸지 않는다.
  //
  // electron-updater는 이 경우에도 스스로 검사를 건너뛰지만, `checkForUpdates()`를 부를 때마다
  // `isUpdaterActive()`가 "Skip checkForUpdates because application is not packed and dev update
  // config is not forced"를 info로 찍는다 — 고칠 것이 없는데 콘솔에 경고처럼 남고, 하는 일도
  // 없는 4시간 타이머가 함께 걸린다.
  //
  // 개발 실행에서 정말 검사를 돌려보려면 `autoUpdater.forceDevUpdateConfig = true`로 두고
  // 저장소 루트에 `dev-app-update.yml`(publish 설정과 같은 내용)을 둔다.
  if (!app.isPackaged) {
    state.status = 'unsupported';
    return;
  }

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message);
    state.status = 'error';
    state.error = shortError(err);
    emit();
  });
  autoUpdater.on('checking-for-update', () => {
    state.status = 'checking';
    emit();
  });
  autoUpdater.on('update-not-available', () => {
    state.status = 'idle';
    state.checkedAt = Date.now();
    emit();
  });
  autoUpdater.on('download-progress', (p) => {
    state.status = 'downloading';
    state.percent = Math.round(p?.percent ?? 0);
    emit();
  });

  // 맥은 Squirrel.Mac이 코드 서명을 검증해서, 서명 없는 빌드는 받아도 설치가 거부된다.
  // 4시간마다 100MB를 헛받는 대신 검사만 하고, 새 버전이 있으면 알림으로 안내한다.
  // 서명을 넣게 되면 이 분기를 지우면 된다 — 아래 경로가 맥에서도 그대로 돈다.
  if (process.platform === 'darwin') {
    autoUpdater.autoDownload = false;
    const seen = new Set();
    autoUpdater.on('update-available', (info) => {
      state.status = 'manual';
      state.version = info?.version ?? null;
      emit();
      if (seen.has(info.version)) return;
      seen.add(info.version);
      onManual?.(info.version);
    });
  } else {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      state.status = 'available';
      state.version = info?.version ?? null;
      emit();
    });
    autoUpdater.on('update-downloaded', (info) => {
      state.status = 'ready';
      state.version = info?.version ?? state.version;
      emit();
      onReady?.(info.version);
    });
  }

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_EVERY_MS);
}

// 설정 창의 "지금 확인". 끝날 때까지 기다렸다가 상태를 돌려준다 — 오류는 이벤트로 이미 state에 적혔다.
export async function checkNow() {
  if (!app.isPackaged) return updaterState();
  await autoUpdater.checkForUpdates().catch(() => {});
  return updaterState();
}

export function installNow() {
  autoUpdater.quitAndInstall();
}

// 설정 창의 "지금 설치". 받아 둔 것이 있을 때만 재시작하며 갈아끼운다. 맥(서명 없음)은 갈아끼울 수
// 없으니 부르는 쪽이 받는 곳을 연다 — 돌려주는 값이 무엇을 했는지 말한다.
export function installFromSettings() {
  if (state.status !== 'ready') return { installing: false };
  setImmediate(installNow);
  return { installing: true };
}
