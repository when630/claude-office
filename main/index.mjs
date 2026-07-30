// Claude Office — 트레이에 상주하며 로컬 Claude Code 세션을 픽셀 사무실로 보여준다.
import { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, shell, clipboard, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { CLAUDE_DIR, USAGE_FILE } from './paths.mjs';
import { installTap, removeTap, tapStatus, manualGuide, REASONS } from './usage-tap.mjs';
import { initUpdater, installNow } from './updater.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const POLL_MS = 1500;
const APP_ID = 'com.when630.claude-office';

let win = null;
let tray = null;
let timer = null;
let lastSnapshot = null;
let lastJson = '';
let notifiedWaiting = new Set();
let firstTick = true;
let quitting = false;
let trayState = null;
let lastBounds = null; // 창을 다시 열 때 있던 자리로 돌려놓는다
let updateReady = null; // 받아 둔 새 버전 — 트레이 메뉴에 재시작 항목이 생긴다

// ── 설정 (userData/settings.json)
//
// notify·trayHintShown은 main만 쓰고, view는 렌더러가 쓴다(설정 창 → office:setView).
// 방 종류를 방 key(작업 디렉터리 이름)로 기억하므로 앱을 다시 켜도 고른 방이 그대로 남는다.
const defaults = { notify: true, trayHintShown: false, view: { names: 'show', roomThemes: {} } };
const NAME_MODES = ['show', 'mask', 'hide'];
let settings = { ...defaults, view: { ...defaults.view } };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) ?? {};
  } catch {
    saved = {};
  }
  settings = { ...defaults, ...saved, view: sanitizeView(saved.view) };
}

// 렌더러가 보낸 값도, 손으로 고친 settings.json도 같은 문을 지난다 — 모르는 키·엉뚱한 타입은
// 버린다. 이름 모드가 깨져 있으면 방 종류 설정까지 통째로 날리는 대신 그 항목만 기본값으로 돈다.
function sanitizeView(v) {
  const roomThemes = {};
  const src = v && typeof v.roomThemes === 'object' && v.roomThemes ? v.roomThemes : {};
  for (const [key, theme] of Object.entries(src)) {
    if (typeof theme === 'string' && theme) roomThemes[key] = theme;
  }
  return {
    names: NAME_MODES.includes(v?.names) ? v.names : defaults.view.names,
    roomThemes,
  };
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('settings save failed:', err.message);
  }
}

// ── 아이콘 (asar 안에서도 읽히도록 버퍼로 읽는다)
function icon(name) {
  try {
    return nativeImage.createFromBuffer(fs.readFileSync(path.join(ROOT, 'build', name)));
  } catch {
    return nativeImage.createEmpty();
  }
}

// ── 창
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1120,
    height: 720,
    ...(lastBounds ?? {}),
    minWidth: 560,
    minHeight: 360,
    show,
    // 개발 인스턴스는 패키징본과 userData가 달라 락이 안 겹친다 → 둘이 동시에 뜬다.
    // 트레이 아이콘이 두 개 보일 때 어느 쪽인지 알아볼 수 있게 표시해 둔다.
    title: app.isPackaged ? 'Claude Office' : 'Claude Office (dev)',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    icon: icon('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  // 외부 링크(MR 등)는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  const remember = () => {
    if (win && !win.isDestroyed() && !win.isMinimized()) lastBounds = win.getBounds();
  };
  win.on('resize', remember);
  win.on('move', remember);

  // 닫기는 종료가 아니라 트레이로 내려가는 것
  win.on('close', (e) => {
    remember();
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!settings.trayHintShown) {
      settings.trayHintShown = true;
      saveSettings();
      notify('트레이에서 계속 지켜봅니다', '입력 대기가 생기면 알려줍니다. 종료하려면 트레이 아이콘 > 종료.');
    }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow(true);
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// 알림을 눌러 창이 새로 뜨는 경우엔 렌더러가 아직 로드 전이라 곧장 보내면 유실된다
function selectInWindow(key) {
  const existed = win && !win.isDestroyed();
  showWindow();
  if (existed) win.webContents.send('office:select', key);
  else win.webContents.once('did-finish-load', () => win.webContents.send('office:select', key));
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// ── 알림
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: icon('icon.png'), timeoutType: 'default' });
  if (onClick) n.on('click', onClick);
  n.show();
}

function maybeNotifyWaiting(snapshot) {
  const waiting = new Map();
  for (const room of snapshot.rooms) {
    for (const w of room.workers) if (w.mood === 'waiting') waiting.set(w.key, w);
  }

  // 앱을 막 켠 순간엔 이미 대기 중이던 것들까지 쏟아내지 않는다
  if (firstTick) {
    notifiedWaiting = new Set(waiting.keys());
    firstTick = false;
    return;
  }

  if (settings.notify) {
    for (const [key, w] of waiting) {
      if (notifiedWaiting.has(key)) continue;
      // 터미널 세션은 무엇을 묻는지 알 수 없다(선택지는 답하기 전엔 대화 파일에 안 남는다)
      notify(
        `${w.name} 이(가) 기다립니다`,
        w.needs || (w.kind === 'bg' ? '입력이 필요합니다' : '터미널에 선택지나 확인이 떠 있습니다'),
        () => selectInWindow(key),
      );
    }
  }
  notifiedWaiting = new Set(waiting.keys());
}

// ── 트레이
function trayIconFor(stats) {
  if (stats.waiting > 0) return 'tray-wait.png';
  if (stats.failed > 0) return 'tray-fail.png';
  return 'tray.png';
}

function updateTray(stats) {
  if (!tray) return;
  const next = trayIconFor(stats);
  if (next !== trayState) {
    tray.setImage(icon(next));
    trayState = next;
  }
  const parts = [`${stats.total}명 출근`];
  if (stats.typing) parts.push(`${stats.typing} 작업 중`);
  if (stats.waiting) parts.push(`${stats.waiting} 입력 대기`);
  if (stats.failed) parts.push(`${stats.failed} 실패`);
  const who = app.isPackaged ? 'Claude Office' : 'Claude Office (dev)';
  tray.setToolTip(`${who} — ${parts.join(' · ')}`);
}

// ── 사용량 연동. 계정 사용률은 statusline 스크립트에 한 줄 심어야 들어온다(main/usage-tap.mjs).
// 패키징본에는 npm도 tools/도 들어가지 않으니 여기가 사실상 유일한 입구다.
function toggleTap(want) {
  const res = want ? installTap() : removeTap();

  // 실패하면 체크가 원래대로 돌아가 있어야 한다 — 메뉴를 다시 만드는 게 가장 확실하다
  if (tray) tray.setContextMenu(buildTrayMenu());

  if (res.ok) {
    if (res.already) {
      notify('사용량 연동', want ? '이미 연동돼 있습니다.' : '연동된 것이 없습니다.');
    } else if (want) {
      notify('사용량 연동을 켰습니다', 'Claude Code 세션에서 statusline이 한 번 그려지면 사용량이 뜹니다.');
    } else {
      notify('사용량 연동을 껐습니다', 'statusline에서 심어둔 줄을 뺐습니다. 앱의 사용량 표시만 사라집니다.');
    }
    return;
  }

  // 자동으로 못 붙였으면 손으로 넣을 수 있게 안내를 띄운다 (statusline이 bash인 경우 등)
  const guide = manualGuide();
  dialog
    .showMessageBox({
      type: 'warning',
      title: '사용량 연동',
      message: REASONS[res.reason] ?? '사용량 연동에 실패했습니다.',
      detail: [res.command && `statusLine 명령: ${res.command}`, res.error, '', guide].filter(Boolean).join('\n'),
      buttons: ['확인', '안내 복사'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 1) clipboard.writeText(guide);
    })
    .catch(() => {
      /* 대화상자를 못 띄우는 상황이면 그냥 넘긴다 */
    });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    ...(updateReady
      ? [
          { label: `업데이트 설치하고 재시작 (v${updateReady})`, click: installNow },
          { type: 'separator' },
        ]
      : []),
    { label: '사무실 열기', click: showWindow },
    { type: 'separator' },
    {
      label: '입력 대기 알림',
      type: 'checkbox',
      checked: settings.notify,
      click: (item) => {
        settings.notify = item.checked;
        saveSettings();
      },
    },
    {
      label: '사용량 연동 (statusline)',
      type: 'checkbox',
      checked: tapStatus().installed,
      click: (item) => toggleTap(item.checked),
    },
    {
      label: '로그인 시 자동 시작',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(icon('tray.png'));
  trayState = 'tray.png';
  tray.setToolTip('Claude Office');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

// ── 폴링

// 스냅샷이 **실제로** 달라졌는지 볼 때는 `ts`(스냅샷을 뜬 시각)를 뺀다. 그걸 그대로 비교하면
// 매 틱 값이 달라져 아래 중복 전송 차단이 아무 일도 하지 않고, 아무 일이 없는데도 1.5초마다
// IPC와 패널 재생성이 돌아 스크롤 위치와 텍스트 선택이 풀린다.
//
// 경과 시간을 절대 시각(statusAt)으로 넘기는 것도 같은 이유다 — 상대값이었다면 여기서 아무리
// 걸러도 매 틱 달라졌을 것이다. 실측해 보면 유휴 세션만 있는 동안 이 서명은 완전히 고정된다.
function signature(snapshot) {
  return JSON.stringify(snapshot, (k, v) => (k === 'ts' ? undefined : v));
}

async function tick() {
  let snapshot;
  try {
    snapshot = await collect();
  } catch (err) {
    console.error('[collect]', err.message);
    return;
  }
  const json = signature(snapshot);
  lastSnapshot = snapshot;
  updateTray(snapshot.stats);
  maybeNotifyWaiting(snapshot);
  if (json === lastJson) return;
  lastJson = json;
  if (win && !win.isDestroyed()) win.webContents.send('office:state', snapshot);
}

// ── 수명주기
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
    loadSettings();

    ipcMain.handle('office:getState', () => lastSnapshot);
    ipcMain.handle('office:meta', () => ({
      claudeDir: CLAUDE_DIR,
      usageFile: USAGE_FILE,
      version: app.getVersion(),
      electron: process.versions.electron,
    }));
    ipcMain.on('office:open-external', (_e, url) => openExternal(url));
    ipcMain.on('office:copy', (_e, text) => clipboard.writeText(String(text ?? '')));

    // 설정 창(렌더러)이 쓰는 표시 설정. 저장된 값을 되돌려주므로 렌더러는 반영만 하면 된다.
    ipcMain.handle('office:getView', () => settings.view);
    ipcMain.handle('office:setView', (_e, patch) => {
      settings.view = sanitizeView({ ...settings.view, ...(patch ?? {}) });
      saveSettings();
      return settings.view;
    });

    createTray();
    const hidden = process.argv.includes('--hidden');
    createWindow(!hidden);

    // 새 버전은 받아만 두고 강제 재시작하지 않는다 — 재시작은 트레이 메뉴에서,
    // 아니면 다음 종료 때 조용히 설치된다.
    initUpdater({
      onReady: (version) => {
        updateReady = version;
        if (tray) tray.setContextMenu(buildTrayMenu());
        notify(
          `Claude Office ${version} 준비됨`,
          '트레이 메뉴에서 재시작하면 적용됩니다. 그냥 두면 다음 종료 때 설치됩니다.',
        );
      },
    });

    await tick();
    timer = setInterval(tick, POLL_MS);
  });

  // 트레이 상주 앱 — 창을 다 닫아도 살아있어야 한다
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    quitting = true;
    if (timer) clearInterval(timer);
  });
}
