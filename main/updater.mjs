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
// onManual(version): 받아둘 수 없는 플랫폼에서 새 버전을 발견했을 때 한 번 불린다.
// 패키징 안 된 개발 실행에서는 electron-updater가 스스로 검사를 건너뛴다.
export function initUpdater({ onReady, onManual }) {
  autoUpdater.on('error', (err) => console.error('[updater]', err.message));

  // 맥은 Squirrel.Mac이 코드 서명을 검증해서, 서명 없는 빌드는 받아도 설치가 거부된다.
  // 4시간마다 100MB를 헛받는 대신 검사만 하고, 새 버전이 있으면 알림으로 안내한다.
  // 서명을 넣게 되면 이 분기를 지우면 된다 — 아래 경로가 맥에서도 그대로 돈다.
  if (process.platform === 'darwin') {
    autoUpdater.autoDownload = false;
    const seen = new Set();
    autoUpdater.on('update-available', (info) => {
      if (seen.has(info.version)) return;
      seen.add(info.version);
      onManual?.(info.version);
    });
  } else {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => onReady?.(info.version));
  }

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_EVERY_MS);
}

export function installNow() {
  autoUpdater.quitAndInstall();
}
