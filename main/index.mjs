// Claude Office — 트레이에 상주하며 로컬 Claude Code 세션을 픽셀 사무실로 보여준다.
import { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, shell, clipboard, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { CLAUDE_DIR, USAGE_FILE } from './paths.mjs';
import { installTap, removeTap, tapStatus, manualGuide, REASONS } from './usage-tap.mjs';
import {
  installNotifyTap,
  removeNotifyTap,
  notifyTapStatus,
  manualGuide as notifyManualGuide,
  REASONS as NOTIFY_REASONS,
} from './notify-tap.mjs';
import { initUpdater, installNow } from './updater.mjs';
import {
  createNotifyState,
  decideNotifications,
  longestWait,
  fmtDur,
  sanitizeNotify,
  BLINK_AFTER_MS,
} from './notify.mjs';
import { openTerminal, REASONS as TERMINAL_REASONS } from './terminal.mjs';
import {
  diffEvents,
  bootEvent,
  appendEvents,
  readEvents,
  pruneFile,
  clearFile,
  summarize,
  dayStart,
  RETAIN_MS,
} from './history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const POLL_MS = 1500;
const APP_ID = 'com.when630.claude-office';
const BLINK_MS = 700;

let win = null;
let tray = null;
let timer = null;
let lastSnapshot = null;
let lastJson = '';
// 무엇을 이미 알렸는지 — 판정은 main/notify.mjs가 하고 여기서는 상태만 들고 있는다
let notifyState = createNotifyState();
let quitting = false;
let trayState = null;
let blinkPhase = false; // 깜빡임의 꺼진 위상 — 이때는 평상 아이콘을 쓴다
let blinkTimer = null;
let lastBounds = null; // 창을 다시 열 때 있던 자리로 돌려놓는다
let updateReady = null; // 받아 둔 새 버전 — 트레이 메뉴에 재시작 항목이 생긴다

// ── 설정 (userData/settings.json)
//
// notify·trayHintShown·history는 main만 쓰고, view는 렌더러가 쓴다(설정 창 → office:setView).
// 방 종류를 방 key(작업 디렉터리 이름)로 기억하므로 앱을 다시 켜도 고른 방이 그대로 남는다.
const defaults = {
  notify: sanitizeNotify(), // 종류별 on/off — 어휘와 하위 호환은 main/notify.mjs가 정한다
  history: true,
  trayHintShown: false,
  view: { names: 'show', roomThemes: {} },
};
const NAME_MODES = ['show', 'mask', 'hide'];
let settings = { ...defaults, view: { ...defaults.view } };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// 근태 기록. 설정과 같은 자리에 두어 통째로 지우기 쉽게 한다.
function historyPath() {
  return path.join(app.getPath('userData'), 'history.jsonl');
}

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) ?? {};
  } catch {
    saved = {};
  }
  settings = { ...defaults, ...saved, notify: sanitizeNotify(saved.notify), view: sanitizeView(saved.view) };
}

function notifyOn(kind) {
  return settings.notify?.[kind] === true;
}

function setNotify(kind, value) {
  settings.notify = { ...settings.notify, [kind]: value };
  saveSettings();
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

// 트레이 아이콘. 맥 메뉴바는 16pt 규격이라 32px을 그대로 주면 거대하게 낀다 —
// 16px을 1x, 32px을 2x(레티나) 표현으로 묶는다. Windows는 32px 하나로 알아서 줄인다.
function trayImage(base) {
  if (process.platform !== 'darwin') return icon(`${base}.png`);
  const img = nativeImage.createEmpty();
  try {
    img.addRepresentation({ scaleFactor: 1, buffer: fs.readFileSync(path.join(ROOT, 'build', `${base}-16.png`)) });
    img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(ROOT, 'build', `${base}.png`)) });
  } catch {
    /* 파일이 없으면 빈 이미지 — 트레이는 뜨되 아이콘만 비는 게 앱이 안 뜨는 것보다 낫다 */
  }
  return img;
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

// 판정은 main/notify.mjs가 한다 — 여기서는 종류별 on/off로 걸러 띄우기만 한다.
// 꺼둔 종류도 판정은 돌아야 한다(notify.mjs 머리말) — 그래야 켜는 순간 밀린 알림이 안 터진다.
function maybeNotify(snapshot) {
  for (const item of decideNotifications(notifyState, snapshot)) {
    if (!notifyOn(item.kind)) continue;
    // 세션에 딸린 알림은 그 자리를 펼쳐주고, 계정 사용량처럼 주인이 없는 건 창만 띄운다
    notify(item.title, item.body, item.key ? () => selectInWindow(item.key) : showWindow);
  }
}

// ── 트레이
function trayIconFor(stats) {
  if (stats?.waiting > 0) return 'tray-wait';
  if (stats?.failed > 0) return 'tray-fail';
  return 'tray';
}

// 아이콘을 정하는 곳은 여기 하나다 — 깜빡임 타이머와 폴링이 서로 덮어쓰지 않게.
function paintTrayIcon() {
  if (!tray) return;
  // 꺼진 위상에서는 평상 아이콘 — 노란 점이 붙었다 떨어지는 것처럼 보인다
  const next = blinkPhase ? 'tray' : trayIconFor(lastSnapshot?.stats);
  if (next === trayState) return;
  tray.setImage(trayImage(next));
  trayState = next;
}

// 방치된 대기는 아이콘을 깜빡여 눈에 걸리게 한다. 실패는 깜빡이지 않는다 — 실패는 이미
// 끝난 일이고, 깜빡임은 "지금 나를 부르고 있다"는 뜻으로 아껴 쓴다.
function updateBlink(snapshot) {
  const want = snapshot.stats?.waiting > 0 && longestWait(snapshot) >= BLINK_AFTER_MS;
  if (want && !blinkTimer) {
    blinkTimer = setInterval(() => {
      blinkPhase = !blinkPhase;
      paintTrayIcon();
    }, BLINK_MS);
  } else if (!want && blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
    blinkPhase = false;
    paintTrayIcon();
  }
}

function updateTray(snapshot) {
  if (!tray) return;
  const stats = snapshot.stats ?? {};
  paintTrayIcon();
  updateBlink(snapshot);
  const parts = [`${stats.total ?? 0}명 출근`];
  if (stats.typing) parts.push(`${stats.typing} 작업 중`);
  // 몇 분째 방치됐는지가 트레이에서 바로 보여야 한다 — 창을 열지 않고 판단하는 자리다
  if (stats.waiting) {
    const worst = longestWait(snapshot);
    parts.push(worst >= 60_000 ? `${stats.waiting} 입력 대기 (최장 ${fmtDur(worst)})` : `${stats.waiting} 입력 대기`);
  }
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

// 기록은 되돌릴 수 없으니 한 번 묻는다
function confirmClearHistory() {
  dialog
    .showMessageBox({
      type: 'warning',
      title: '근태 기록 지우기',
      message: '지금까지 쌓인 근태 기록을 지울까요?',
      detail: `${historyPath()}\n\n출근부의 오늘·최근 7일 집계가 빈 상태로 돌아갑니다. 되돌릴 수 없습니다.`,
      buttons: ['취소', '지우기'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then(({ response }) => {
      if (response !== 1) return;
      const ok = clearFile(historyPath());
      notify('근태 기록', ok ? '기록을 지웠습니다.' : '기록을 지우지 못했습니다.');
    })
    .catch(() => {
      /* 대화상자를 못 띄우는 상황이면 아무것도 지우지 않는다 */
    });
}

// ── 무엇을 기다리는지 알아내기. Notification 훅이 그 순간의 문구를 떨어뜨려 준다
// (main/notify-tap.mjs). 훅이 실행할 스크립트는 userData에 둔다 — asar 안의 파일은
// 밖에서 node로 실행할 수 없다.
function notifyScriptPath() {
  return path.join(app.getPath('userData'), 'notify-tap.mjs');
}

function toggleNotifyTap(want) {
  const script = notifyScriptPath();
  const res = want ? installNotifyTap(script) : removeNotifyTap(script);

  // 실패하면 체크가 원래대로 돌아가 있어야 한다
  if (tray) tray.setContextMenu(buildTrayMenu());

  if (res.ok) {
    if (res.already) {
      notify('무엇을 기다리는지', want ? '이미 연동돼 있습니다.' : '연동된 것이 없습니다.');
    } else if (want) {
      // 훅은 세션을 띄울 때 읽힌다 — 이미 돌고 있는 세션에는 적용되지 않는다
      notify(
        '무엇을 기다리는지 알려줍니다',
        '지금 돌고 있는 세션에는 적용되지 않습니다 — 새로 띄운 세션부터 권한 확인·선택지 문구가 그대로 보입니다.',
      );
    } else {
      notify('연동을 껐습니다', 'settings.json에서 훅을 뺐습니다. 대기 자체는 그대로 알려줍니다.');
    }
    return;
  }

  const guide = notifyManualGuide(script);
  dialog
    .showMessageBox({
      type: 'warning',
      title: '무엇을 기다리는지 알아내기',
      message: NOTIFY_REASONS[res.reason] ?? '연동에 실패했습니다.',
      detail: guide,
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

// 예전 버전이 심어둔 사용량 tap에는 stdin 인코딩 머리말이 없다 — 세션 이름에 한글이 있으면
// statusline이 payload를 cp949로 읽어 JSON이 부서지고 사용량이 조용히 멈춘다(#17).
// 심어져 있으면 앱을 켤 때 머리말만 조용히 보탠다(.bak은 남는다).
function upgradeUsageTap() {
  const st = tapStatus();
  if (!st.installed || st.hasEncoding) return;
  const res = installTap();
  if (res.ok && res.upgraded) {
    notify(
      '사용량 연동을 고쳤습니다',
      '한글이 든 payload가 깨지지 않게 statusline의 stdin 인코딩을 맞췄습니다.',
    );
  }
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
      label: '알림',
      submenu: [
        {
          label: '입력 대기',
          type: 'checkbox',
          checked: notifyOn('waiting'),
          click: (item) => setNotify('waiting', item.checked),
        },
        {
          label: '대기가 길어지면 다시 (5 · 15 · 30 · 60분)',
          type: 'checkbox',
          checked: notifyOn('escalate'),
          click: (item) => setNotify('escalate', item.checked),
        },
        {
          label: '컨텍스트 임박 (85 · 95%)',
          type: 'checkbox',
          checked: notifyOn('context'),
          click: (item) => setNotify('context', item.checked),
        },
        {
          label: '계정 사용량 임박 (80 · 95%)',
          type: 'checkbox',
          checked: notifyOn('usage'),
          click: (item) => setNotify('usage', item.checked),
        },
      ],
    },
    {
      label: '사용량 연동 (statusline)',
      type: 'checkbox',
      checked: tapStatus().installed,
      click: (item) => toggleTap(item.checked),
    },
    {
      label: '무엇을 기다리는지 알아내기 (Notification 훅)',
      type: 'checkbox',
      checked: notifyTapStatus(notifyScriptPath()).installed,
      click: (item) => toggleNotifyTap(item.checked),
    },
    {
      label: '근태 기록 (출근부)',
      type: 'checkbox',
      checked: settings.history,
      click: (item) => {
        settings.history = item.checked;
        saveSettings();
      },
    },
    { label: '근태 기록 지우기…', click: confirmClearHistory },
    {
      label: '로그인 시 자동 시작',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        // args는 Windows 전용 — 맥의 로그인 실행은 wasOpenedAtLogin으로 구분한다(아래 hidden)
        const opts = { openAtLogin: item.checked };
        if (process.platform === 'win32') opts.args = ['--hidden'];
        app.setLoginItemSettings(opts);
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
  tray = new Tray(trayImage('tray'));
  trayState = 'tray';
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
  // 전이만 남긴다 — lastSnapshot을 갈아 끼우기 전에 비교해야 한다
  if (settings.history) appendEvents(historyPath(), diffEvents(lastSnapshot, snapshot));
  lastSnapshot = snapshot;
  updateTray(snapshot);
  maybeNotify(snapshot);
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

    // 오래된 기록을 덜어내고 "여기서 앱이 켜졌다"를 남긴다 — 앱이 꺼져 있던 동안을 근태로
    // 세지 않기 위한 표시다(main/history.mjs의 재생 규칙).
    pruneFile(historyPath());
    if (settings.history) appendEvents(historyPath(), [bootEvent()]);

    ipcMain.handle('office:getState', () => lastSnapshot);
    ipcMain.handle('office:meta', () => ({
      claudeDir: CLAUDE_DIR,
      usageFile: USAGE_FILE,
      version: app.getVersion(),
    }));
    ipcMain.on('office:open-external', (_e, url) => openExternal(url));
    ipcMain.on('office:copy', (_e, text) => clipboard.writeText(String(text ?? '')));

    // 발견한 세션의 터미널을 열어 준다. 렌더러가 만든 명령 문자열은 받지 않는다 —
    // id만 받아 main/terminal.mjs가 조립한다(그러지 않으면 임의 명령 실행 통로가 된다).
    ipcMain.handle('office:openTerminal', async (_e, target) => {
      const res = await openTerminal({
        cwd: target?.cwd,
        jobId: target?.jobId,
        sessionId: target?.sessionId,
      });
      return { ...res, message: res.ok ? null : (TERMINAL_REASONS[res.reason] ?? '터미널을 열지 못했습니다.') };
    });

    // 출근부. 오늘과 최근 7일을 한 번에 넘긴다 — 창을 열 때 한 번만 읽으면 되고,
    // 파일이 커도 보존 기간(14일)만큼이라 한 번에 읽어 집계해도 부담이 없다.
    ipcMain.handle('office:history', () => {
      const events = readEvents(historyPath());
      const now = Date.now();
      return {
        on: settings.history,
        retainDays: Math.round(RETAIN_MS / 86_400_000),
        today: summarize(events, { from: dayStart(now), to: now }),
        week: summarize(events, { from: dayStart(now, 6), to: now }),
      };
    });

    // 설정 창(렌더러)이 쓰는 표시 설정. 저장된 값을 되돌려주므로 렌더러는 반영만 하면 된다.
    ipcMain.handle('office:getView', () => settings.view);
    ipcMain.handle('office:setView', (_e, patch) => {
      settings.view = sanitizeView({ ...settings.view, ...(patch ?? {}) });
      saveSettings();
      return settings.view;
    });

    upgradeUsageTap();

    createTray();
    // 맥은 로그인 시작에 인자를 못 넘긴다 — 로그인으로 뜬 실행인지(wasOpenedAtLogin)로 대신한다
    const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;
    createWindow(!hidden);

    // 새 버전은 받아만 두고 강제 재시작하지 않는다 — 재시작은 트레이 메뉴에서,
    // 아니면 다음 종료 때 조용히 설치된다. 맥(서명 없음)은 알림만 띄운다(main/updater.mjs).
    initUpdater({
      onReady: (version) => {
        updateReady = version;
        if (tray) tray.setContextMenu(buildTrayMenu());
        notify(
          `Claude Office ${version} 준비됨`,
          '트레이 메뉴에서 재시작하면 적용됩니다. 그냥 두면 다음 종료 때 설치됩니다.',
        );
      },
      onManual: (version) => {
        notify(`Claude Office ${version} 나왔습니다`, '눌러서 Releases에서 새 버전을 받아주세요.', () =>
          openExternal('https://github.com/when630/claude-office/releases/latest'),
        );
      },
    });

    await tick();
    timer = setInterval(tick, POLL_MS);
  });

  // 트레이 상주 앱 — 창을 다 닫아도 살아있어야 한다
  app.on('window-all-closed', () => {});

  // 맥에서 독 아이콘을 눌렀을 때 (Windows에서는 발생하지 않는 이벤트)
  app.on('activate', showWindow);

  app.on('before-quit', () => {
    quitting = true;
    if (timer) clearInterval(timer);
    if (blinkTimer) clearInterval(blinkTimer);
  });
}
