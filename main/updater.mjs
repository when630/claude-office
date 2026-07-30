// 자동 업데이트 — GitHub Releases의 latest.yml을 읽어 새 버전을 백그라운드로 받아 둔다.
// 트레이 상주 앱이라 사용자가 앱을 끌 일이 거의 없으므로, 받아두고 알린 뒤
// 트레이 메뉴의 재시작을 기다린다. 그냥 두면 다음 종료 때 조용히 설치된다.
//
// electron-updater는 CJS 모듈이라 named import가 ESM에서 깨진다 — default로 받아 푼다.
// (electron-userland/electron-builder#7976)
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// onReady(version): 새 버전을 받아 뒀을 때 한 번 불린다.
// 패키징 안 된 개발 실행에서는 electron-updater가 스스로 검사를 건너뛴다.
export function initUpdater({ onReady }) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => onReady?.(info.version));
  autoUpdater.on('error', (err) => console.error('[updater]', err.message));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_EVERY_MS);
}

export function installNow() {
  autoUpdater.quitAndInstall();
}
