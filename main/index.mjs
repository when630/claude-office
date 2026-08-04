// Claude Office — 트레이에 상주하며 로컬 Claude Code 세션을 픽셀 사무실로 보여준다.
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeImage,
  ipcMain,
  shell,
  clipboard,
  dialog,
  globalShortcut,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, STUCK_ERRORS, STUCK_QUIET_MS } from './collect.mjs';
import { CLAUDE_DIR, USAGE_FILE } from './paths.mjs';
import { installTap, removeTap, tapStatus, manualGuide, reasonText as tapReason } from './usage-tap.mjs';
import {
  installNotifyTap,
  removeNotifyTap,
  notifyTapStatus,
  manualGuide as notifyManualGuide,
  reasonText as notifyTapReason,
} from './notify-tap.mjs';
import { initUpdater, installNow } from './updater.mjs';
import {
  createNotifyState,
  decideNotifications,
  longestWait,
  sanitizeNotify,
  sanitizeQuiet,
  sanitizeRoomNotify,
  isQuiet,
  midnightAfter,
  BLINK_AFTER_MS,
  DONE_MIN_BUSY_MS,
  NOTIFY_KINDS,
  ROOM_LEVELS,
  soundFor,
  nameOf,
} from './notify.mjs';
import { openTerminal, reasonText as terminalReason } from './terminal.mjs';
import { t, fmtDur, fmtWhen, setLang, resolveLang, LANGS, LANG_NAMES } from '../shared/i18n.mjs';
import {
  diffEvents,
  bootEvent,
  appendEvents,
  readEvents,
  pruneFile,
  clearFile,
  summarize,
  dailyTrend,
  dayStart,
  RETAIN_MS,
} from './history.mjs';
import { readPromptLog, summarizePrompts } from './prompts.mjs';
import { readCodeStats, staleDays } from './stats.mjs';
import { sanitizeGroups, sanitizeAlias } from './rooms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const POLL_MS = 1500;
const APP_ID = 'com.when630.claude-office';
const BLINK_MS = 700;

let win = null;
let mini = null; // 미니 모드 창 — 프레임을 나중에 못 바꾸므로 별도 창으로 둔다
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
let quietNow = false; // 지금 무음인가 — 시간대에 들고 나면 트레이 메뉴를 다시 짠다

// ── 설정 (userData/settings.json)
//
// notify·trayHintShown·history는 main만 쓰고, view는 렌더러가 쓴다(설정 창 → office:setView).
// 방 종류를 방 key(작업 디렉터리 이름)로 기억하므로 앱을 다시 켜도 고른 방이 그대로 남는다.
//
// lang은 양쪽이 쓴다 — 트레이·알림은 main이, 화면은 렌더러가 그리기 때문이다. 저장값은
// 'auto' | 'en' | 'ko'이고 실제로 쓸 언어는 OS 로케일과 함께 정한다(shared/i18n.mjs).
const defaults = {
  lang: 'auto',
  notify: sanitizeNotify(), // 종류별 on/off — 어휘와 하위 호환은 main/notify.mjs가 정한다
  // 알림 소리. **기본은 꺼짐** — 소리는 토스트보다 방해가 크므로 사람이 켜서 쓴다.
  // 이 값이 없던 시절에는 Windows 토스트가 OS 기본 소리를 그대로 냈다(Electron의 silent
  // 기본값이 "소리 냄"이다) — 이제 그 소리도 이 설정을 따른다.
  sound: false,
  quiet: sanitizeQuiet(), // 방해금지 — 조용한 시간대와 임시 무음(until)
  roomNotify: {}, // 방 이름 → 알림 세기('off' | 'keen'). 보통인 방은 적지 않는다
  // 전역 단축키. 빈 문자열이면 그 자리는 안 잡는다 — 끄는 방법이 곧 비우는 것이다.
  hotkeys: {
    toggle: 'CommandOrControl+Alt+O',
    jump: 'CommandOrControl+Alt+W',
    mini: 'CommandOrControl+Alt+M',
  },
  // 미니 모드와 두 모습의 창 자리. 다시 켜면 있던 모습으로 그 자리에 뜬다.
  mini: false,
  bounds: { normal: null, mini: null },
  history: true,
  trayHintShown: false,
  view: { names: 'show', roomThemes: {}, pinned: [], collapsed: [], roomGroups: [], roomAlias: {} },
};
const NAME_MODES = ['show', 'mask', 'hide'];
const LANG_PREFS = ['auto', ...LANGS];
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
  settings = {
    ...defaults,
    ...saved,
    lang: LANG_PREFS.includes(saved.lang) ? saved.lang : defaults.lang,
    notify: sanitizeNotify(saved.notify),
    sound: saved.sound === true,
    quiet: sanitizeQuiet(saved.quiet),
    roomNotify: sanitizeRoomNotify(saved.roomNotify),
    hotkeys: sanitizeHotkeys(saved.hotkeys),
    mini: saved.mini === true,
    bounds: { normal: sanitizeBounds(saved.bounds?.normal), mini: sanitizeBounds(saved.bounds?.mini) },
    view: sanitizeView(saved.view),
  };
  applyLang();
}

// ── 언어. 설정값과 OS 로케일에서 실제로 쓸 언어를 정해 이 프로세스에 세운다.
// 렌더러는 제 프로세스에서 따로 세운다(office:meta로 받아 간다).
function applyLang() {
  return setLang(resolveLang(settings.lang, app.getLocale()));
}

// 언어를 바꾸면 이미 그려 둔 것들을 다시 짠다 — 재시작을 요구할 이유가 없다.
// 트레이 메뉴는 라벨이 박힌 채로 만들어져 있어 통째로 다시 만들어야 하고,
// 툴팁은 다음 폴링을 기다리지 않고 지금 스냅샷으로 다시 쓴다.
function setLangPref(pref) {
  if (!LANG_PREFS.includes(pref) || pref === settings.lang) return;
  settings.lang = pref;
  saveSettings();
  applyLang();
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
    if (lastSnapshot) updateTray(lastSnapshot);
  }
  sendAll('office:lang', langPayload());
}

function langPayload() {
  return { lang: applyLang(), pref: settings.lang };
}

function notifyOn(kind) {
  return settings.notify?.[kind] === true;
}

function setNotify(kind, value) {
  settings.notify = { ...settings.notify, [kind]: value };
  saveSettings();
}

// 트레이 메뉴는 라벨이 박힌 채로 만들어져 있어 값이 바뀌면 통째로 다시 짜야 한다.
function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// 방해금지. 시간대와 임시 무음(until)이 같은 문을 지난다 — 어느 쪽이 바뀌든 메뉴를 다시 짠다.
function setQuiet(patch) {
  settings.quiet = sanitizeQuiet({ ...settings.quiet, ...patch });
  saveSettings();
  quietNow = isQuiet(settings.quiet);
  refreshTrayMenu();
  return notifySettings();
}

// 설정 창이 알림을 다루는 데 필요한 것 한 벌. 종류 목록과 문턱까지 넘겨
// 렌더러가 어휘를 따로 들고 있지 않게 한다.
function notifySettings() {
  return {
    kinds: NOTIFY_KINDS,
    notify: settings.notify,
    quiet: settings.quiet,
    doneAfterMs: DONE_MIN_BUSY_MS,
    levels: ROOM_LEVELS,
    roomNotify: settings.roomNotify,
  };
}

// ── 전역 단축키
//
// 창을 열지 않고도 처리하려는 것이다. 지금은 토스트를 놓치면 창을 열고 → 책상을 찾고 →
// 클릭하고 → 터미널에서 열기까지 네 걸음인데, terminal.mjs는 id만 있으면 되는 자리다.
const HOTKEY_ACTIONS = ['toggle', 'jump', 'mini'];
// Accelerator 문법(수식키+키) 중 우리가 받아들이는 모양. 손으로 고친 settings.json이
// 앱을 못 뜨게 하지 않도록 좁게 받는다 — register()는 이상한 문자열에 예외를 던진다.
const ACCEL_OK = /^(?:(?:CommandOrControl|Command|Control|Ctrl|Alt|Option|Shift|Super)\+){1,3}[A-Za-z0-9]{1,12}$/;

function sanitizeHotkeys(v) {
  const out = { ...defaults.hotkeys };
  if (v && typeof v === 'object') {
    for (const k of HOTKEY_ACTIONS) {
      if (typeof v[k] !== 'string') continue;
      // 빈 문자열은 "이 자리는 안 쓴다"는 뜻이라 그대로 받는다
      out[k] = v[k] === '' || ACCEL_OK.test(v[k]) ? v[k] : out[k];
    }
  }
  return out;
}

// 잡아 둔 단축키를 다 놓고 지금 설정대로 다시 잡는다. 실패한 것은 그대로 돌려준다 —
// globalShortcut.register()는 이미 남이 쓰는 조합이면 조용히 false를 낼 뿐이라,
// 알려주지 않으면 사용자는 눌러 보고 아무 일도 안 일어나는 것만 겪는다.
let hotkeyFailed = [];

function applyHotkeys({ announce = false } = {}) {
  globalShortcut.unregisterAll();
  // 미니는 지금 상태를 뒤집는다 — 곁눈질하려고 내리는 일이 잦은데 그때마다 창을 앞으로
  // 꺼내 버튼을 찾아야 한다면 곁눈질용이라는 목적과 어긋난다
  const run = { toggle: toggleWindow, jump: jumpToLongestWait, mini: () => setMini(!settings.mini) };
  const failed = [];
  for (const action of HOTKEY_ACTIONS) {
    const accel = settings.hotkeys[action];
    if (!accel) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accel, run[action]);
    } catch {
      ok = false; // Accelerator로 못 읽는 문자열
    }
    if (!ok) failed.push(accel);
  }
  hotkeyFailed = failed;
  if (announce && failed.length) {
    notify(t('notify.hotkeyFailTitle'), t('notify.hotkeyFailBody', { keys: failed.join(' · ') }));
  }
  return failed;
}

// 창 토글. 보이고 초점까지 있으면 내리고, 아니면 올려서 초점을 준다 —
// 다른 창에 가려 있을 때 눌렀는데 사라지면 그건 고장으로 읽힌다.
function toggleWindow() {
  // 미니로 쓰는 중이면 미니를 여닫는다 — 여기서 큰 창으로 바꿔 버리면 모드를 뺏는 셈이다
  const w = settings.mini ? mini : win;
  if (w && !w.isDestroyed() && w.isVisible() && w.isFocused()) {
    w.hide();
    return;
  }
  if (settings.mini) {
    setMini(true); // 창이 없으면 다시 만들고, 있으면 올린다
    mini?.focus();
    return;
  }
  showWindow();
}

// 가장 오래 기다린 세션의 터미널로. 기다리는 게 없으면 창만 띄운다 — 아무 일도 안 일어나면
// 단축키가 안 먹은 것인지 기다리는 게 없는 것인지 알 수 없다.
function jumpToLongestWait() {
  const [first] = waitingWorkers();
  if (!first) {
    showWindow();
    return;
  }
  openTerminalFor(first.w);
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
    pinned: keyList(v?.pinned),
    collapsed: keyList(v?.collapsed),
    // 방 묶기·별칭 (main/rooms.mjs). 묶기는 부모 경로 목록이고 별칭은 방 이름 → 부를 이름이다.
    roomGroups: sanitizeGroups(v?.roomGroups),
    roomAlias: sanitizeAlias(v?.roomAlias),
  };
}

// 방 이름 목록(고정·접기). 중복을 걷어내고 길이를 막는다 — 사라진 방의 이름도 그대로
// 들고 있어야 다시 떴을 때 고정·접기가 살아난다(방 종류와 같은 규칙).
function keyList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((k) => typeof k === 'string' && k))].slice(0, 200);
}

// 창 자리는 다음에 켤 때 그대로 되살릴 값이라 모양을 확인하고 받는다 —
// 깨진 값이 들어오면 창이 화면 밖에 뜨거나 아예 안 뜬다.
function sanitizeBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const out = { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) };
  return out.width > 0 && out.height > 0 ? out : null;
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
    ...(lastBounds ?? settings.bounds.normal ?? {}),
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
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    lastBounds = win.getBounds();
    settings.bounds = { ...settings.bounds, normal: lastBounds };
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
      notify(t('notify.trayHintTitle'), t('notify.trayHintBody'));
    }
  });
}

function showWindow() {
  // 미니로 내려가 있었다면 큰 창을 부르는 순간 미니는 접는다 — 둘이 같이 떠 있을 이유가 없다
  if (settings.mini) {
    setMini(false);
    return;
  }
  if (!win || win.isDestroyed()) createWindow(true);
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// ── 미니 모드
//
// 곁눈질하라고 만든 앱인데 창은 전부 아니면 전무였다. 작업하면서 모니터 구석에 띄워 둘
// 크기가 필요하다.
//
// **창을 따로 만든다.** 프레임 유무는 BrowserWindow를 만들 때 정해지고 나중에 못 바꾸는데,
// 미니의 값어치 절반은 테두리 없이 작게 뜨는 데 있다. 같은 index.html을 `?mini=1`로 열어
// 렌더러가 상단바·패널을 접고 사무실만 그린다.
function createMini() {
  mini = new BrowserWindow({
    width: 420,
    height: 300,
    ...(settings.bounds.mini ?? {}),
    minWidth: 220,
    minHeight: 150,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b0d12',
    icon: icon('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  mini.loadFile(path.join(ROOT, 'renderer', 'index.html'), { query: { mini: '1' } });
  mini.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  const remember = () => {
    if (mini && !mini.isDestroyed()) settings.bounds = { ...settings.bounds, mini: mini.getBounds() };
  };
  mini.on('resize', remember);
  mini.on('move', remember);
  mini.on('closed', () => {
    mini = null;
  });
}

function setMini(on) {
  if (on) {
    if (win && !win.isDestroyed()) win.hide();
    if (!mini || mini.isDestroyed()) createMini();
    else mini.show();
  } else {
    if (mini && !mini.isDestroyed()) {
      settings.bounds = { ...settings.bounds, mini: mini.getBounds() };
      mini.destroy();
      mini = null;
    }
    if (!win || win.isDestroyed()) createWindow(true);
    else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
  settings.mini = on;
  saveSettings();
  refreshTrayMenu();
}

// 지금 화면에 있는 창. 스냅샷·언어를 밀어 보낼 곳이다.
function liveWindows() {
  return [win, mini].filter((w) => w && !w.isDestroyed());
}

function sendAll(channel, payload) {
  for (const w of liveWindows()) w.webContents.send(channel, payload);
}

// 알림을 눌러 창이 새로 뜨는 경우엔 렌더러가 아직 로드 전이라 곧장 보내면 유실된다
function selectInWindow(key) {
  // 이미 있던 창이면 곧장 보내고, 새로 만들어진 창이면 로드가 끝나기를 기다린다.
  // (미니에서 올라오는 길도 여기를 지난다 — showWindow가 미니를 접어 준다)
  const existed = win && !win.isDestroyed();
  showWindow();
  if (existed) win.webContents.send('office:select', key);
  else win.webContents.once('did-finish-load', () => win.webContents.send('office:select', key));
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// 승인받은 계획서(.md)를 기본 편집기로 연다.
//
// 경로는 우리가 트랜스크립트에서 읽어 렌더러로 보낸 값이지만, **IPC 표면은 아무 문자열이나
// 받을 수 있으므로 여기서 다시 가둔다** — `~/.claude/plans` 아래의 `.md`만. 그러지 않으면
// 렌더러가 임의 파일을 열게 하는 통로가 된다(openExternal이 https만 받는 것과 같은 이유다).
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

async function openPlan(file) {
  const full = path.resolve(String(file ?? ''));
  const inside = path.relative(PLANS_DIR, full);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return { ok: false, reason: 'outside' };
  if (path.extname(full).toLowerCase() !== '.md') return { ok: false, reason: 'outside' };
  const err = await shell.openPath(full);
  return err ? { ok: false, reason: 'missing' } : { ok: true };
}

// ── 알림
function notify(title, body, onClick, sound = false) {
  if (!Notification.isSupported()) return;
  // `silent`는 **끄는** 쪽 스위치다(OS 알림음을 억제한다). 소리를 내고 싶으면 false여야 한다.
  const n = new Notification({
    title,
    body,
    icon: icon('icon.png'),
    timeoutType: 'default',
    silent: !sound,
  });
  if (onClick) n.on('click', onClick);
  n.show();
}

// 판정은 main/notify.mjs가 한다 — 여기서는 종류별 on/off로 걸러 띄우기만 한다.
// 꺼둔 종류도 판정은 돌아야 한다(notify.mjs 머리말) — 그래야 켜는 순간 밀린 알림이 안 터진다.
//
// 방해금지도 같은 규칙이다. 문턱은 조용한 동안에도 그대로 전진하고 여기서 **토스트만** 참는다 —
// 밀린 것을 쌓아 뒀다 해제하는 순간 몰아 띄우지 않는다. 해제 시점에도 여전히 기다리고 있으면
// 다음 문턱에서 자연히 다시 부른다. 트레이 점·깜빡임은 조용한 동안에도 그대로다.
function maybeNotify(snapshot) {
  const quiet = isQuiet(settings.quiet);
  for (const item of decideNotifications(notifyState, snapshot, Date.now(), settings.roomNotify)) {
    if (!notifyOn(item.kind) || quiet) continue;
    // 세션에 딸린 알림은 그 자리를 펼쳐주고, 계정 사용량처럼 주인이 없는 건 창만 띄운다
    notify(
      item.title,
      item.body,
      item.key ? () => selectInWindow(item.key) : showWindow,
      soundFor(item.kind, settings.sound),
    );
  }
}

// ── 트레이
function trayIconFor(stats) {
  if (stats?.waiting > 0) return 'tray-wait';
  // 헤매는 자리도 붉은 점을 쓴다 — 실패와 같은 뜻("뭔가 잘못됐다")이고, 아이콘을 한 벌 더
  // 굽는 값어치가 있을 만큼 다른 상태는 아니다
  if (stats?.failed > 0 || stats?.stuck > 0) return 'tray-fail';
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
  const parts = [t('tray.total', { n: stats.total ?? 0 })];
  if (stats.typing) parts.push(t('tray.typing', { n: stats.typing }));
  // 몇 분째 방치됐는지가 트레이에서 바로 보여야 한다 — 창을 열지 않고 판단하는 자리다
  if (stats.waiting) {
    const worst = longestWait(snapshot);
    parts.push(
      worst >= 60_000
        ? t('tray.waitingLong', { n: stats.waiting, d: fmtDur(worst) })
        : t('tray.waiting', { n: stats.waiting }),
    );
  }
  if (stats.stuck) parts.push(t('tray.stuck', { n: stats.stuck }));
  if (stats.failed) parts.push(t('tray.failed', { n: stats.failed }));
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
      notify(t('tap.title'), t(want ? 'tap.already' : 'tap.nothing'));
    } else if (want) {
      notify(t('tap.onTitle'), t('tap.onBody'));
    } else {
      notify(t('tap.offTitle'), t('tap.offBody'));
    }
    return;
  }

  // 자동으로 못 붙였으면 손으로 넣을 수 있게 안내를 띄운다 (statusline이 bash인 경우 등)
  const guide = manualGuide();
  dialog
    .showMessageBox({
      type: 'warning',
      title: t('tap.title'),
      message: tapReason(res.reason),
      detail: [res.command && t('tap.command', { cmd: res.command }), res.error, '', guide]
        .filter(Boolean)
        .join('\n'),
      buttons: [t('common.ok'), t('common.copyGuide')],
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
      title: t('hist.clearTitle'),
      message: t('hist.clearMessage'),
      detail: t('hist.clearDetail', { path: historyPath() }),
      buttons: [t('common.cancel'), t('hist.clearButton')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then(({ response }) => {
      if (response !== 1) return;
      const ok = clearFile(historyPath());
      notify(t('hist.title'), t(ok ? 'hist.cleared' : 'hist.clearFailed'));
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
      notify(t('ntap.title'), t(want ? 'ntap.already' : 'ntap.nothing'));
    } else if (want) {
      // 훅은 세션을 띄울 때 읽힌다 — 이미 돌고 있는 세션에는 적용되지 않는다
      notify(t('ntap.onTitle'), t('ntap.onBody'));
    } else {
      notify(t('ntap.offTitle'), t('ntap.offBody'));
    }
    return;
  }

  const guide = notifyManualGuide(script);
  dialog
    .showMessageBox({
      type: 'warning',
      title: t('ntap.setupTitle'),
      message: notifyTapReason(res.reason),
      detail: guide,
      buttons: [t('common.ok'), t('common.copyGuide')],
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
  if (res.ok && res.upgraded) notify(t('tap.fixedTitle'), t('tap.fixedBody'));
}

// 언어 항목. 언어 이름은 그 언어로 적는다(LANG_NAMES) — 읽을 수 없는 언어로 적힌 항목은
// 고를 수가 없다. '자동'만 지금 언어로 적는다.
function langMenu() {
  return [['auto', t('common.langAuto')], ...LANGS.map((l) => [l, LANG_NAMES[l]])].map(([pref, label]) => ({
    label,
    type: 'radio',
    checked: settings.lang === pref,
    click: () => setLangPref(pref),
  }));
}

// 지금 기다리고 있는 자리들 — 오래 기다린 순서. **방을 달고 나온다** — 트레이에 적을 이름이
// 방 별칭에 달려 있다(notify.mjs의 nameOf). 대기 목록과 토스트가 같은 이름을 불러야 한다.
function waitingWorkers() {
  const out = [];
  for (const room of lastSnapshot?.rooms ?? []) {
    for (const w of room.workers ?? []) if (w.mood === 'waiting') out.push({ w, room });
  }
  return out.sort((a, b) => (a.w.statusAt ?? Infinity) - (b.w.statusAt ?? Infinity));
}

// 트레이 메뉴에 적을 이름. 이름을 가리기로 해 뒀으면 세션 이름 대신 방 이름을 쓴다 —
// 화면을 공유하는 동안엔 트레이 메뉴도 같이 보인다(방 이름은 원래 가리지 않는 값이다).
//
// **가린 쪽에서는 nameOf를 쓰지 않는다.** nameOf는 별칭이 없는 방에서 세션 이름을 돌려주므로
// 그대로 쓰면 가린 것이 새어 나간다 — 별칭이 붙은 방만 안전한 것으로는 부족하다.
function trayNameOf(w, room) {
  const shown = settings.view.names === 'show' ? nameOf(w, room) : room?.label || w.room;
  return shown || w.room || '—';
}

async function openTerminalFor(w) {
  const res = await openTerminal({ cwd: w.cwd, jobId: w.jobId, sessionId: w.sessionId });
  // 성공은 터미널 창이 뜨는 것으로 충분하다. 실패만 알린다 — 왜 아무 일도 없었는지 알아야 한다
  if (!res.ok) notify(t('terminal.failed'), terminalReason(res.reason));
}

// 트레이에서 바로 기다리는 세션으로. 창을 열고 책상을 찾는 걸음을 없애는 자리다.
function waitingMenu() {
  const list = waitingWorkers().slice(0, 8);
  if (!list.length) return [{ label: t('tray.waitingNone'), enabled: false }];
  const now = Date.now();
  return list.map(({ w, room }) => ({
    label: `${trayNameOf(w, room)} · ${fmtDur(w.statusAt ? now - w.statusAt : 0)}`,
    click: () => openTerminalFor(w),
  }));
}

// "지금부터 조용히". 남은 시간이 아니라 **끝나는 시각**을 적는다 — 메뉴는 열 때마다 다시
// 짜이지 않으므로 "30분 남음"은 곧 거짓이 되지만 "14:35까지"는 언제 봐도 맞다.
function quietMenu() {
  const until = settings.quiet.until;
  const on = until > Date.now();
  return [
    ...[30, 60].map((min) => ({
      label: fmtDur(min * 60_000),
      click: () => setQuiet({ until: Date.now() + min * 60_000 }),
    })),
    { label: t('tray.quietToday'), click: () => setQuiet({ until: midnightAfter() }) },
    { type: 'separator' },
    {
      label: on ? t('tray.quietUntil', { when: fmtWhen(until) }) : t('tray.quietNone'),
      enabled: on,
      click: () => setQuiet({ until: 0 }),
    },
  ];
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    ...(updateReady
      ? [{ label: t('tray.update', { v: updateReady }), click: installNow }, { type: 'separator' }]
      : []),
    { label: t('tray.open'), click: showWindow },
    {
      label: t('tray.mini'),
      type: 'checkbox',
      checked: settings.mini,
      click: (item) => setMini(item.checked),
    },
    { label: t('tray.waitingList'), submenu: waitingMenu() },
    { type: 'separator' },
    {
      label: t('tray.notify'),
      submenu: [
        {
          label: t('tray.notifySound'),
          type: 'checkbox',
          checked: settings.sound,
          click: (item) => {
            settings.sound = item.checked;
            saveSettings();
          },
        },
        { type: 'separator' },
        {
          label: t('tray.notifyWaiting'),
          type: 'checkbox',
          checked: notifyOn('waiting'),
          click: (item) => setNotify('waiting', item.checked),
        },
        {
          label: t('tray.notifyEscalate'),
          type: 'checkbox',
          checked: notifyOn('escalate'),
          click: (item) => setNotify('escalate', item.checked),
        },
        {
          label: t('tray.notifyContext'),
          type: 'checkbox',
          checked: notifyOn('context'),
          click: (item) => setNotify('context', item.checked),
        },
        {
          label: t('tray.notifyUsage'),
          type: 'checkbox',
          checked: notifyOn('usage'),
          click: (item) => setNotify('usage', item.checked),
        },
        {
          // 문턱을 라벨에 적어 둔다 — 짧은 문답에는 안 뜬다는 걸 켜기 전에 알 수 있어야 한다
          label: t('tray.notifyDone', { d: fmtDur(DONE_MIN_BUSY_MS) }),
          type: 'checkbox',
          checked: notifyOn('done'),
          click: (item) => setNotify('done', item.checked),
        },
        {
          label: t('tray.notifyStuck', { d: fmtDur(STUCK_QUIET_MS), n: STUCK_ERRORS }),
          type: 'checkbox',
          checked: notifyOn('stuck'),
          click: (item) => setNotify('stuck', item.checked),
        },
        { type: 'separator' },
        {
          // 시간대는 설정 창에서 고른다 — 메뉴에서는 켜고 끄는 것과 지금 값만 보인다
          label: t('tray.quietHours', { from: settings.quiet.from, to: settings.quiet.to }),
          type: 'checkbox',
          checked: settings.quiet.hours,
          click: (item) => setQuiet({ hours: item.checked }),
        },
        { label: t('tray.quietNow'), submenu: quietMenu() },
      ],
    },
    { label: t('tray.language'), submenu: langMenu() },
    {
      label: t('tray.usageTap'),
      type: 'checkbox',
      checked: tapStatus().installed,
      click: (item) => toggleTap(item.checked),
    },
    {
      label: t('tray.notifyTap'),
      type: 'checkbox',
      checked: notifyTapStatus(notifyScriptPath()).installed,
      click: (item) => toggleNotifyTap(item.checked),
    },
    {
      label: t('tray.history'),
      type: 'checkbox',
      checked: settings.history,
      click: (item) => {
        settings.history = item.checked;
        saveSettings();
      },
    },
    { label: t('tray.historyClear'), click: confirmClearHistory },
    {
      label: t('tray.autostart'),
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
      label: t('tray.quit'),
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

let lastWaitSig = '';

function waitMenuSig() {
  const now = Date.now();
  return waitingWorkers()
    .slice(0, 8)
    .map(({ w }) => `${w.key}:${Math.floor((now - (w.statusAt ?? now)) / 60_000)}`)
    .join('|');
}

async function tick() {
  let snapshot;
  try {
    snapshot = await collect({ groups: settings.view.roomGroups, alias: settings.view.roomAlias });
  } catch (err) {
    console.error('[collect]', err.message);
    return;
  }
  // 트레이의 대기 목록은 이름과 분이 적힌 채로 굳어 있다 — 목록이나 분이 바뀔 때만 다시 짠다.
  // 대기가 있는 동안에도 1분에 한 번꼴이라, 스냅샷마다 메뉴를 새로 만드는 것과 값이 다르다.
  const waitSig = waitMenuSig();
  if (waitSig !== lastWaitSig) {
    lastWaitSig = waitSig;
    refreshTrayMenu();
  }

  // 시간대에 들고 나거나 임시 무음이 끝나면 트레이 메뉴의 표시가 실제와 어긋난다.
  // 만료된 until은 여기서 정리해 둔다 — 다음에 메뉴를 열었을 때 지난 시각이 남아 있지 않게.
  const quiet = isQuiet(settings.quiet);
  if (quiet !== quietNow) {
    quietNow = quiet;
    if (!quiet && settings.quiet.until && Date.now() >= settings.quiet.until) setQuiet({ until: 0 });
    else refreshTrayMenu();
  }

  const json = signature(snapshot);
  // 전이만 남긴다 — lastSnapshot을 갈아 끼우기 전에 비교해야 한다
  if (settings.history) appendEvents(historyPath(), diffEvents(lastSnapshot, snapshot));
  lastSnapshot = snapshot;
  updateTray(snapshot);
  maybeNotify(snapshot);
  if (json === lastJson) return;
  lastJson = json;
  sendAll('office:state', snapshot);
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
      // 렌더러는 제 프로세스에서 언어를 세워야 한다 — 여기로 실어 보낸다
      ...langPayload(),
    }));
    ipcMain.on('office:open-external', (_e, url) => openExternal(url));
    // 승인받은 계획서 열기. 경로 검증은 main에서 한다(openPlan) — 렌더러 값을 그대로 믿지 않는다.
    ipcMain.handle('office:openPlan', (_e, file) => openPlan(file));
    ipcMain.on('office:copy', (_e, text) => clipboard.writeText(String(text ?? '')));

    // 발견한 세션의 터미널을 열어 준다. 렌더러가 만든 명령 문자열은 받지 않는다 —
    // id만 받아 main/terminal.mjs가 조립한다(그러지 않으면 임의 명령 실행 통로가 된다).
    ipcMain.handle('office:openTerminal', async (_e, target) => {
      const res = await openTerminal({
        cwd: target?.cwd,
        jobId: target?.jobId,
        sessionId: target?.sessionId,
      });
      return { ...res, message: res.ok ? null : terminalReason(res.reason) };
    });

    // 출근부. 오늘과 최근 7일을 한 번에 넘긴다 — 창을 열 때 한 번만 읽으면 되고,
    // 파일이 커도 보존 기간(14일)만큼이라 한 번에 읽어 집계해도 부담이 없다.
    ipcMain.handle('office:history', async () => {
      const events = readEvents(historyPath());
      const now = Date.now();
      // 내가 시킨 횟수는 우리 기록이 아니라 Claude Code의 프롬프트 이력에서 그때그때 센다
      // (main/prompts.mjs). 그래서 **근태 기록을 꺼 뒀거나 앱이 꺼져 있던 날도 셈이 맞는다.**
      const prompts = await readPromptLog().catch(() => []);
      // Claude Code 자신의 집계(main/stats.mjs). 읽기만 한다 — 그쪽이 잠금까지 걸고 쓰는 파일이다.
      const code = await readCodeStats().catch(() => null);
      return {
        on: settings.history,
        retainDays: Math.round(RETAIN_MS / 86_400_000),
        today: summarize(events, { from: dayStart(now), to: now }),
        week: summarize(events, { from: dayStart(now, 6), to: now }),
        // 7일 추이. 기록 형식을 바꾸지 않고 같은 집계를 날짜별로 한 번씩 돌린 것이다.
        trend: dailyTrend(events, { days: 7, now }),
        mine: {
          today: summarizePrompts(prompts, { from: dayStart(now), to: now }),
          week: summarizePrompts(prompts, { from: dayStart(now, 6), to: now }),
        },
        // 출처가 또 다른 값이라 따로 실어 보낸다. staleDays는 시각을 인자로 받는 순수 함수라
        // 여기서 한 번 계산해 넘긴다 — 렌더러가 날짜 셈법을 또 갖지 않게.
        code: code ? { ...code, staleDays: staleDays(code, now) } : null,
      };
    });

    // 설정 창의 알림 설정. 트레이 메뉴와 같은 값을 만지므로 창을 열 때마다 새로 받아 간다.
    ipcMain.handle('office:getNotify', () => notifySettings());
    ipcMain.handle('office:setNotify', (_e, patch) => {
      if (patch?.notify) settings.notify = sanitizeNotify({ ...settings.notify, ...patch.notify });
      if (patch?.roomNotify) settings.roomNotify = sanitizeRoomNotify({ ...settings.roomNotify, ...patch.roomNotify });
      if (patch?.quiet) return setQuiet(patch.quiet);
      saveSettings();
      refreshTrayMenu();
      return notifySettings();
    });

    // 미니 모드. 상단바 버튼과 미니 창의 확대 버튼이 같은 문을 지난다.
    ipcMain.handle('office:getMini', () => settings.mini);
    ipcMain.on('office:setMini', (_e, on) => setMini(on === true));
    // 미니에서 자리를 누르면 큰 창으로 올라오며 그 자리가 펼쳐진다
    ipcMain.on('office:mini-select', (_e, key) => selectInWindow(String(key ?? '')));

    // 전역 단축키. 등록 실패는 반환값으로만 알 수 있어(register가 false를 낼 뿐이다)
    // 실패한 조합을 함께 넘긴다 — 설정 창이 그 자리를 표시한다.
    ipcMain.handle('office:getHotkeys', () => ({ hotkeys: settings.hotkeys, failed: hotkeyFailed }));
    ipcMain.handle('office:setHotkeys', (_e, patch) => {
      settings.hotkeys = sanitizeHotkeys({ ...settings.hotkeys, ...(patch ?? {}) });
      saveSettings();
      return { hotkeys: settings.hotkeys, failed: applyHotkeys() };
    });

    // 설정 창(렌더러)이 쓰는 표시 설정. 저장된 값을 되돌려주므로 렌더러는 반영만 하면 된다.
    ipcMain.handle('office:getView', () => settings.view);
    ipcMain.handle('office:setView', (_e, patch) => {
      settings.view = sanitizeView({ ...settings.view, ...(patch ?? {}) });
      saveSettings();
      return settings.view;
    });

    // 설정 창의 언어 전환. 트레이 메뉴에서 바꾼 것과 같은 문을 지난다.
    ipcMain.handle('office:setLang', (_e, pref) => {
      setLangPref(pref);
      return langPayload();
    });

    upgradeUsageTap();

    quietNow = isQuiet(settings.quiet);
    createTray();
    // 못 잡은 조합은 알려 준다. 눌러 보고 아무 일도 안 일어나는 것으로 알게 하지 않는다.
    applyHotkeys({ announce: true });
    // 맥은 로그인 시작에 인자를 못 넘긴다 — 로그인으로 뜬 실행인지(wasOpenedAtLogin)로 대신한다
    const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;
    // 큰 창은 미니로 쓰던 사람에게도 만들어 둔다(숨긴 채로) — 자리를 눌러 올라올 때
    // 새로 만들면서 렌더러가 로드되기를 기다리지 않아도 된다.
    createWindow(!hidden && !settings.mini);
    if (settings.mini && !hidden) createMini();

    // 새 버전은 받아만 두고 강제 재시작하지 않는다 — 재시작은 트레이 메뉴에서,
    // 아니면 다음 종료 때 조용히 설치된다. 맥(서명 없음)은 알림만 띄운다(main/updater.mjs).
    initUpdater({
      onReady: (version) => {
        updateReady = version;
        if (tray) tray.setContextMenu(buildTrayMenu());
        notify(t('notify.updateReadyTitle', { v: version }), t('notify.updateReadyBody'));
      },
      onManual: (version) => {
        notify(t('notify.updateManualTitle', { v: version }), t('notify.updateManualBody'), () =>
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
    // 마지막 자리를 남긴다 — 다음에 켤 때 있던 모습으로 그 자리에 뜬다
    saveSettings();
    if (timer) clearInterval(timer);
    if (blinkTimer) clearInterval(blinkTimer);
    globalShortcut.unregisterAll();
  });
}
