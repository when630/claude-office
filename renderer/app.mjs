import { layout, render, pickAt, clearTextCache, OFFICE_FONT_PX, OFFICE_FONT_FAMILY } from './render.mjs';
import { THEMES } from './themes.mjs';
import {
  t,
  setLang,
  getLang,
  LANGS,
  LANG_NAMES,
  fmtAge,
  fmtAgo,
  fmtLeft,
  fmtWaitedDur,
  fmtDur,
  fmtTime,
  fmtClock,
  fmtDay,
  fmtWhen,
  fmtTokens,
  fmtLimit,
} from '../shared/i18n.mjs';

const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const panel = document.getElementById('panel');
const statsEl = document.getElementById('stats');
const clockEl = document.getElementById('clock');
const waitChip = document.getElementById('wait-chip');
const railList = document.getElementById('rail-list');
const railToggle = document.getElementById('rail-toggle');
const panelToggle = document.getElementById('panel-toggle');
const usageMini = document.getElementById('usage-mini');
const miniStatsEl = document.getElementById('mini-stats');
const filterEl = document.getElementById('room-filter');
const shownBtn = document.getElementById('room-shown');
const stageEmpty = document.getElementById('stage-empty');
const panelTabsEl = document.getElementById('panel-tabs');
const paneSession = document.getElementById('pane-session');
const paneCfg = document.getElementById('pane-cfg');
const cfgBody = document.getElementById('cfg-body');
const cfgTabsEl = document.getElementById('cfg-tabs');
const paneAtt = document.getElementById('pane-att');
const attBody = document.getElementById('att-body');
const attTabsEl = document.getElementById('att-tabs');
const captionEl = document.querySelector('body > .caption');

// 미니 모드는 **같은 페이지를 다른 창에서** 여는 것이다(main/index.mjs의 createMini).
// 프레임 유무는 창을 만들 때 정해지고 나중에 못 바꾸므로 창을 갈아 끼우는 쪽을 골랐고,
// 여기서는 그 창인지만 보고 상단바·패널을 접는다.
const MINI = new URLSearchParams(location.search).get('mini') === '1';
// 미니에 다 들어가지 않으니 방을 추린다. 기다리는 방·헤매는 방이 먼저다.
const MINI_ROOMS = 3;

let state = { rooms: [], recent: [], stats: {}, usage: null, ts: 0 };
let meta = null;
// 표시 설정 — main의 settings.json(view)에 저장된다. 상태(state)와 달리 스냅샷마다 오지 않는다.
let cfg = { names: 'show', roomThemes: {}, pinned: [], collapsed: [], roomGroups: [], roomAlias: {} };
// 이름으로 거르기. **저장하지 않는다** — 다시 켰을 때 걸러진 채로 뜨면 그건 "방이 안 보인다"가 된다.
let roomFilter = '';
let view = { boxes: [], seats: [], width: 100, height: 100 };
let scale = 3;
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let hover = null;
let selected = null;

// 이름 모드는 값이 설정에 저장되므로 목록은 코드에 두고 라벨만 사전에서 가져온다 —
// 언어를 바꿨다고 저장된 값이 달라지면 안 된다.
const NAME_MODES = ['show', 'mask', 'hide'];

// 알림 설정 — main이 들고 있고(settings.json) 트레이 메뉴도 같은 값을 만진다.
// 설정 창을 열 때마다 새로 받아 온다. IPC가 없으면(브라우저로 직접 연 경우) null로 남고
// 알림 섹션은 그려지지 않는다.
let notifyCfg = null;

// 종류 이름은 트레이 메뉴와 같은 문구를 쓴다 — 같은 것을 두 이름으로 부르지 않는다.
const KIND_LABEL = {
  waiting: 'tray.notifyWaiting',
  escalate: 'tray.notifyEscalate',
  context: 'tray.notifyContext',
  usage: 'tray.notifyUsage',
  done: 'tray.notifyDone',
};

// ── 이름 가리기. 세션 이름은 작업 디렉터리·첫 지시에서 나오므로 화면을 남에게 보일 때
// 가릴 수 있어야 한다. 대체 이름은 스냅샷 순서대로 붙인 번호다 — 같은 스냅샷 안에서는
// 캔버스와 패널이 같은 이름을 부른다.
let aliases = new Map();

function buildAliases() {
  aliases = new Map();
  let n = 0;
  for (const room of state.rooms ?? []) {
    for (const w of room.workers) aliases.set(w.key, t('names.alias', { n: ++n }));
  }
  // 퇴근한 작업도 이름이 있고 목록·패널 양쪽에 적힌다. 번호를 안 주면 이름을 가려 둔 채로
  // 화면을 보여줄 때 여기만 실제 이름이 남는다.
  for (const r of state.recent ?? []) aliases.set(r.key, t('names.alias', { n: ++n }));
}

function aliasOf(w) {
  return aliases.get(w.key) ?? t('names.aliasBare');
}

// 캔버스 이름표. 'hide'는 빈 문자열 — render.mjs가 이름표를 아예 달지 않는다.
function canvasName(w) {
  if (cfg.names === 'hide') return '';
  if (cfg.names === 'mask') return aliasOf(w);
  return w.name;
}

// 패널 제목. 이름표를 없앤 경우에도 제목은 있어야 하니 대체 이름으로 돈다 —
// 캔버스에서 부르던 이름과 패널 제목이 어긋나면 누구를 눌렀는지 알 수 없다.
// 퇴근한 작업(`state.recent`의 항목)도 `{ key, name }`이라 그대로 넘길 수 있다.
function panelName(w) {
  return cfg.names === 'show' ? w.name : aliasOf(w);
}

// ── 포맷. 기간·시각을 세는 일은 shared/i18n.mjs에 있다 — main의 알림 문구와 같은 셈법을
// 써야 하고, 언어마다 붙이는 꼬리가 다르다.

// 기다린 시간. 패널은 1초마다 갱신되므로 초까지 보여준다 — 방금 뜬 프롬프트인지
// 20분째 방치된 것인지가 여기서 갈린다.
function fmtWaited(ms) {
  if (ms == null || ms < 0) return '';
  return t('panel.waited', { d: fmtWaitedDur(ms) });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function level(pct) {
  if (pct >= 85) return 'hi';
  if (pct >= 60) return 'mid';
  return 'ok';
}

// 프로그레스 바 하나. pct가 null이면 회색 빈 바.
//
// 폭을 style 속성으로 박으면 안 된다 — index.html의 CSP가 `style-src 'self'`라
// 인라인 style 속성이 차단되고, 그러면 width 선언만 사라져 바가 항상 꽉 찬 것처럼 보인다.
// (실제로 그렇게 보이던 버그였다.) data-pct만 심어두고 paintBars()가 CSSOM으로 채운다.
function bar(pct) {
  const cls = pct == null ? '' : ` class="lv-${level(pct)}"`;
  return `<div class="bar"><i${cls} data-pct="${pct == null ? 0 : Math.min(100, Math.max(0, pct))}"></i></div>`;
}

// CSSOM 직접 조작은 CSP 대상이 아니다
function paintBars() {
  for (const el of paneSession.querySelectorAll('.bar i[data-pct]')) {
    el.style.width = `${el.dataset.pct}%`;
  }
}

// 출근부의 막대 그래프. CSSOM 직접 조작은 CSP 대상이 아니다(인라인 style 속성은 막혀 있다).
// 가로 막대인 패널과 달리 세로로 자라므로 height를 쓴다.
function paintSparks() {
  for (const el of attBody.querySelectorAll('.spark i[data-pct]')) {
    el.style.height = `${Math.max(2, Number(el.dataset.pct))}%`;
  }
}

function gauge({ label, pct, right, note, id }) {
  return `<div class="gauge">
    <div class="gauge-head"><span>${esc(label)}</span><b class="lv-${pct == null ? 'na' : level(pct)}">${
      pct == null ? '—' : `${pct}%`
    }</b></div>
    ${bar(pct)}
    <div class="gauge-foot">
      <small>${right ?? ''}</small>
      <small${id ? ` id="${id}"` : ''}>${note ?? ''}</small>
    </div>
  </div>`;
}

// ── 캔버스
function pickScale(width) {
  if (width >= 1500) return 4;
  if (width >= 880) return 3;
  return 2;
}

const STAGE_PAD = MINI ? 12 : 24; // style.css의 #stage padding 상하좌우 (미니는 6px)

// ── 손으로 정하는 배율. 창 폭에 맡기는 것(pickScale)만으로는 방이 늘어난 뒤가 답답하다 —
// 한눈에 보려면 줄여야 하고 한 자리를 들여다보려면 늘려야 한다.
//
// 반 칸씩 세분한다. 한 칸이 정수배뿐이면 2→3배가 한 번에 50% 뛰어 "조금만 더"가 안 된다.
// 반 칸에서도 픽셀은 또렷하다 — 축을 맞춘 `fillRect`는 기기 픽셀로 스냅되므로 경계에 중간색이
// 끼지 않는다(배율별로 캔버스 픽셀의 색 수를 세어 확인했다. 아트 픽셀 폭만 2·3px로 갈린다).
//
// 아래 끝이 2배인 이유: 글자는 확대 밖에서 12px 고정으로 그린다(render.mjs 머리말).
// 1배까지 줄이면 방보다 글자가 커져 이름표·방 이름·말풍선이 서로 덮어 아무것도 읽히지 않는다 —
// 굽어서 확인했다. 사무실 전체를 한 장에 보는 것은 **글자를 끄는 축소판**이 따로 있어야 한다.
const SCALES = [2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8];
// null이면 창 폭에 맡긴다. **저장하지 않는다** — 다시 켰을 때 8배로 확대된 채 뜨면
// 그건 "방이 안 보인다"가 된다(이름 거르기와 같은 판단이다).
let zoomScale = null;
// 창 폭이 정한 배율. 확대해도 **방 줄 나누기는 이걸로** 재므로 따로 들고 있는다.
let baseScale = scale;

// 미니에 그릴 방을 고른다. 좁은 창에 방을 다 밀어 넣으면 아무것도 안 읽히므로,
// **지금 봐야 하는 방**부터 남긴다 — 나를 기다리는 방, 헤매는 방, 일하는 방 순.
function roomScore(room) {
  let best = 0;
  for (const w of room.workers ?? []) {
    const rank = { waiting: 3, stuck: 2, typing: 1 }[w.mood] ?? 0;
    if (rank > best) best = rank;
  }
  return best;
}

// 방이 열 개를 넘어가면 사무실이 그냥 벽지가 된다. 이름으로 거르고, 자주 보는 방을 앞에 고정하고,
// 관심 없는 방은 접는다. 세 가지가 다 **보기만** 건드린다 — 알림도 근태도 그대로 돈다.
function roomsToDraw() {
  let rooms = state.rooms ?? [];

  const q = roomFilter.trim().toLowerCase();
  if (q) rooms = rooms.filter((r) => `${r.key} ${r.cwd ?? ''}`.toLowerCase().includes(q));
  if (cfg.collapsed.length) rooms = rooms.filter((r) => !cfg.collapsed.includes(r.key));
  // sort는 안정적이라 고정하지 않은 방들끼리는 원래 순서(인원수 순)가 그대로 남는다
  if (cfg.pinned.length) {
    const pin = (r) => (cfg.pinned.includes(r.key) ? 0 : 1);
    rooms = [...rooms].sort((a, b) => pin(a) - pin(b));
  }

  if (!MINI) return rooms;
  // 미니는 첫 방밖에 안 보이는 크기일 수 있다 — 급한 방을 **맨 앞으로** 올린다.
  // 같은 급끼리는 원래 순서(인원수 순)를 지킨다: 매 스냅샷 자리가 뒤집히면 곁눈질이 안 된다.
  return [...rooms]
    .map((r, i) => ({ r, i, s: roomScore(r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, MINI_ROOMS)
    .map((x) => x.r);
}

// ── 입주. 방을 **처음 본 시각**을 기억해 이삿짐 박스를 잠깐 놓아 준다.
//
// 앱을 켠 직후의 첫 스냅샷은 채우지 않는다 — 안 그러면 켤 때마다 온 사무실이 이사판이 된다
// (자리 전환의 앵커가 비어 있을 때 전환 없이 나타나는 것과 같은 판단이다).
//
// 방 이름은 사라졌다 다시 뜰 수 있으므로(그 폴더에서 세션을 다시 띄우면) 오래된 것은 잊는다 —
// 다시 뜨면 그때가 새 입주다.
const MOVEIN_KEEP_MS = 60_000;
// 방 이름 → { at: 처음 본 시각, announce: 입주 연출을 할 방인가 }
//
// `announce`를 따로 들고 있어야 한다. 처음 본 시각만 기억하면 **첫 스냅샷에 있던 방도**
// 다음 레이아웃에서 그 시각을 받아 입주 연출이 붙는다 — 창 크기가 바뀌거나 다시 그릴 때마다
// relayout이 도는데, 그때 "첫 스냅샷이었는지"는 이미 알 수 없다.
const seenRooms = new Map();
let seenAnyState = false;

function markMoveIn(rooms) {
  const now = Date.now();
  const live = new Set(rooms.map((r) => r.key));
  for (const [key, seen] of seenRooms) {
    if (!live.has(key) && now - seen.at > MOVEIN_KEEP_MS) seenRooms.delete(key);
  }
  for (const room of rooms) {
    // 첫 스냅샷에 있던 방은 "새로 뜬 방"이 아니다 — 켤 때마다 온 사무실이 이사판이 된다
    if (!seenRooms.has(room.key)) seenRooms.set(room.key, { at: now, announce: seenAnyState });
    const seen = seenRooms.get(room.key);
    if (seen.announce) room.movedInAt = seen.at;
  }
  // **방이 하나라도 있는 화면을 본 뒤부터** 입주로 센다. relayout은 스냅샷이 오기 전에도
  // (로드 직후·창 크기 변경) 도는데, 그 빈 화면을 "본 것"으로 세면 첫 스냅샷의 방들이 전부
  // 새로 뜬 방이 되어 켤 때마다 온 사무실이 이사판이 된다.
  if (rooms.length) seenAnyState = true;
  return rooms;
}

function relayout() {
  // clientWidth는 padding을 포함한다 — 빼지 않으면 사무실이 여백만큼 넘쳐 가장자리가 잘린다
  const avail = Math.max(120, (stage.clientWidth || 800) - STAGE_PAD);
  baseScale = pickScale(avail);
  scale = zoomScale ?? baseScale;
  // 줄 나누기는 **자동 배율로** 잰다 — 배율마다 방이 다시 접히면 확대할 때 보고 있던 방이
  // 다른 줄로 튄다. 늘린 만큼 캔버스가 무대보다 커지고, 그 캔버스를 끌어 옮기는 것이 화면 이동이다.
  const logicalW = Math.max(120, Math.floor(avail / baseScale));
  const rooms = markMoveIn(roomsToDraw());
  view = layout(rooms, logicalW, { themes: cfg.roomThemes, nameOf: canvasName });

  // 캔버스는 **보이는 창만큼**이다(사무실만큼이 아니다). 사무실은 그 안에서 움직이고 바닥은
  // 보이는 범위를 늘 채운다 — 사무실 크기로 잡으면 끌었을 때 바닥이 끝나 종이처럼 잘려 보이고,
  // 8배에서는 수천만 픽셀짜리 비트맵을 매 프레임 다시 그리게 된다.
  const { w: cssW, h: cssH } = stageInner();
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  // 사무실 크기가 바뀌면 끌 수 있는 범위도 바뀐다 — 놓인 자리를 그 안으로 다시 당긴다
  applyPan();
}

function frame(t) {
  render(ctx, view, { scale, dpr, t, hover, selected, pan: { x: panX, y: panY } });
  requestAnimationFrame(frame);
}

// ── 확대·이동. Figma의 손버릇을 그대로 쓴다 — Ctrl+휠(트랙패드 핀치 포함)로 확대,
// 스페이스나 가운데 버튼으로 끌어 옮기기, 스페이스를 톡 누르면 가운데로 복귀.
//
// 옮기는 것은 **사무실을 놓는 자리**(`panX`·`panY`)다. 스크롤로 하면 0보다 작아질 수 없어
// 왼쪽 위 꼭짓점에 갇히는데, 확대해 놓고 나면 정작 그 모서리의 방을 화면 가운데로 데려올 수 없다.
//
// 캔버스는 **보이는 창**에 고정이고 그 안에서 세계를 옮겨 그린다(render.mjs가 pan을 받는다) —
// 캔버스 자체를 밀면 바닥이 캔버스에서 끝나 사무실이 종이처럼 잘려 보인다.
// 좌표는 캔버스 왼쪽 위를 0점으로 하는 CSS px이고, 세계 좌표는 `(화면 - pan) / scale`이다.
let panX = 0;
let panY = 0;

// 무대의 여백 안쪽 — 사무실을 놓는 판의 크기다
function stageInner() {
  return {
    w: Math.max(1, (stage.clientWidth || 800) - STAGE_PAD),
    h: Math.max(1, (stage.clientHeight || 400) - STAGE_PAD),
  };
}

// **어디까지 끌 수 있나.** 사무실의 어느 점이든 화면 가운데로 데려올 수 있고 그 이상은 안 나간다 —
// 모서리 방을 가운데 놓고 보려면 이만큼이 필요하고, 이보다 풀면 사무실을 화면 밖으로 잃는다.
function clampPan() {
  const cw = view.width * scale;
  const ch = view.height * scale;
  // 아직 그릴 사무실이 없다(첫 스냅샷 전) — 자리를 건드리지 않는다.
  // 여기서 빈 사무실을 가운데로 몰면 첫 스냅샷이 화면 중앙에서 시작한다.
  if (!cw || !ch) return;
  const { w, h } = stageInner();
  panX = Math.min(w / 2, Math.max(w / 2 - cw, panX));
  panY = Math.min(h / 2, Math.max(h / 2 - ch, panY));
}

function applyPan() {
  clampPan();
  // 기기 픽셀에 맞춰 놓는다 — 반 픽셀 어긋난 자리에서는 픽셀 아트 경계가 흐려진다
  panX = Math.round(panX * dpr) / dpr;
  panY = Math.round(panY * dpr) / dpr;
}

function panBy(dx, dy) {
  panX += dx;
  panY += dy;
  applyPan();
}

// 가운데로 데려온다. 확대해 헤매다가 돌아올 곳이 있어야 한다 —
// 스타크래프트에서 스페이스를 톡 누르는 것과 같은 자리다.
function centerOffice() {
  const { w, h } = stageInner();
  panX = (w - view.width * scale) / 2;
  panY = (h - view.height * scale) / 2;
  applyPan();
}

// 한 단계 위·아래 배율. 끝이면 그대로 둔다.
function stepScale(from, dir) {
  return dir > 0
    ? (SCALES.find((s) => s > from) ?? from)
    : ([...SCALES].reverse().find((s) => s < from) ?? from);
}

// at(화면 좌표)에 있던 지점이 배율을 바꾼 뒤에도 그 자리에 남는다 — 커서 밑을 붙잡지 않으면
// 확대할 때마다 화면이 어디론가 튀고, 보고 있던 방을 다시 찾아야 한다.
function zoomTo(next, at) {
  const to = Math.min(SCALES.at(-1), Math.max(SCALES[0], next));
  // 이미 그 배율이다(사다리 끝에 닿았다) — 놓인 자리도, 자동에 맡긴 상태도 건드리지 않는다.
  // 여기서 zoomScale을 박으면 끝에서 한 번 더 굴린 것만으로 창 폭 추종이 풀린다.
  if (to === scale) return;
  const r = canvas.getBoundingClientRect();
  // 커서 밑의 세계 좌표. 캔버스는 안 움직이므로 배율만 갈아 끼우고 그 점을 제자리에 다시 놓는다
  const wx = (at.x - r.left - panX) / scale;
  const wy = (at.y - r.top - panY) / scale;
  zoomScale = to;
  relayout();
  panX = at.x - r.left - wx * scale;
  panY = at.y - r.top - wy * scale;
  applyPan();
}

// 키로 확대할 때 붙잡을 지점 — 무대 가운데다
function stageCenter() {
  const r = stage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// 트랙패드 핀치는 한 손짓에 작은 값이 잔뜩 온다 — 이벤트마다 한 단계씩 올리면 순간이동한다.
// 마우스 휠 한 칸(100~120)만큼 모이면 한 단계 움직인다.
const ZOOM_NOTCH = 100;
let wheelAcc = 0;

// 창에서 받는다 — Chromium은 Ctrl+휠을 페이지 확대로 쓰므로 사무실 밖에서 굴린 것까지
// 막아야 껍데기(목록·패널 글자)가 같이 커지지 않는다. 확대는 사무실 위에서만 한다.
window.addEventListener(
  'wheel',
  (e) => {
    const zooming = e.ctrlKey || e.metaKey;
    if (zooming) e.preventDefault();
    if (!stage.contains(e.target)) return;
    if (!zooming) {
      // 사무실은 스크롤 상자가 아니므로(overflow: hidden) 그냥 굴린 것도 우리가 옮긴다.
      // 세로는 휠, 가로는 Shift+휠 — 트랙패드의 가로 성분(deltaX)도 그대로 받는다.
      e.preventDefault();
      panBy(-(e.shiftKey ? e.deltaY : e.deltaX), e.shiftKey ? 0 : -e.deltaY);
      return;
    }
    if (Math.sign(e.deltaY) !== Math.sign(wheelAcc)) wheelAcc = 0;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < ZOOM_NOTCH) return;
    const dir = wheelAcc < 0 ? 1 : -1; // 밀어 올리면 확대
    wheelAcc = 0;
    zoomTo(stepScale(scale, dir), { x: e.clientX, y: e.clientY });
  },
  { passive: false },
);

let spaceHeld = false;
// 스페이스를 누른 뒤 아직 끌지 않았는가 — 그대로 놓으면 가운데로 데려간다
let spaceTap = false;
let pan = null;
// 끌어 옮긴 뒤에 오는 click은 자리 선택이 아니다 — 한 번 삼킨다
let swallowClick = false;

function setCursor() {
  const c = pan ? 'grabbing' : spaceHeld ? 'grab' : hover ? 'pointer' : 'default';
  // 인라인 style 속성은 CSP에 막혀 있지만 CSSOM은 대상이 아니다(막대 채우기와 같은 이유)
  stage.style.cursor = c;
  canvas.style.cursor = c;
}

function endPan() {
  if (!pan) return;
  swallowClick = pan.moved;
  pan = null;
  setCursor();
}

stage.addEventListener('pointerdown', (e) => {
  swallowClick = false;
  // 스페이스를 누른 채로, 또는 가운데 버튼으로 끈다 (둘 다 Figma와 같다)
  if (!(e.button === 1 || (e.button === 0 && spaceHeld))) return;
  e.preventDefault(); // 가운데 버튼의 자동 스크롤을 막는다
  // 끌기 시작했으면 스페이스는 "옮기려고" 누른 것이다 — 놓을 때 가운데로 데려가지 않는다
  spaceTap = false;
  pan = { x: e.clientX, y: e.clientY, moved: false };
  // 무대 밖으로 나가도 계속 끌린다 — 놓을 때까지 이 요소가 포인터를 잡고 있는다
  stage.setPointerCapture(e.pointerId);
  setCursor();
});
stage.addEventListener('pointermove', (e) => {
  if (!pan) return;
  const dx = e.clientX - pan.x;
  const dy = e.clientY - pan.y;
  // 손떨림은 클릭으로 남긴다 — 2px까지는 끈 것으로 보지 않는다
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
  // 직전 지점에서의 차이만큼 옮긴다 — 끝에 닿아 잘린 뒤에도 손을 따라온다
  // (출발점 기준으로 계산하면 벽에 한 번 닿은 순간부터 손과 화면이 어긋난 채로 남는다)
  pan.x = e.clientX;
  pan.y = e.clientY;
  panBy(dx, dy);
});
stage.addEventListener('pointerup', endPan);
stage.addEventListener('pointercancel', endPan);

window.addEventListener('keydown', (e) => {
  // 글자를 치는 중이면 손대지 않는다 — 거르기 칸에 공백이 안 들어가는 것으로 드러난다
  const typing = Boolean(e.target?.closest?.('input, select, textarea'));
  if (e.code === 'Space') {
    // 버튼에 초점이 있을 때의 스페이스는 그 버튼을 누르는 것이다 (Ctrl 조합은 버튼과 안 겹친다)
    if (typing || e.target?.closest?.('button')) return;
    // **누르고 있는 동안 오는 자동 반복까지 막는다.** 첫 keydown만 막으면 반복분이 브라우저의
    // "스페이스=한 페이지 아래로"로 새어, 위로 끌 때마다 화면이 아래로 튄다(실제로 그랬다).
    e.preventDefault();
    if (spaceHeld) return;
    spaceHeld = true;
    spaceTap = true; // 끌지 않고 놓으면 가운데로 데려간다
    setCursor();
    return;
  }
  if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  // Chromium의 페이지 확대와 같은 조합을 쓴다 — 여기서 막지 않으면 껍데기가 같이 커진다
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    zoomTo(stepScale(scale, 1), stageCenter());
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    zoomTo(stepScale(scale, -1), stageCenter());
  } else if (e.key === '0') {
    e.preventDefault();
    zoomScale = null; // 창 폭에 다시 맡긴다
    relayout();
    centerOffice();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  spaceHeld = false;
  // 톡 누르고 놓았다(끌지 않았다) — 스타크래프트의 스페이스처럼 사무실을 가운데로 데려온다
  if (spaceTap) centerOffice();
  spaceTap = false;
  setCursor();
});
// 창을 벗어난 사이의 keyup은 오지 않는다 — 눌린 채로 남으면 돌아와서 클릭이 안 먹는다
window.addEventListener('blur', () => {
  spaceHeld = false;
  spaceTap = false;
  endPan();
  setCursor();
});

// ── 히트 테스트. 게가 돌아다니므로 자리 사각형보다 지금 서 있는 위치가 먼저다.
// 화면 → 세계는 놓인 자리를 뺀 뒤 배율로 나눈다 (그리는 쪽과 같은 셈이다)
function seatAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return pickAt(view, (clientX - r.left - panX) / scale, (clientY - r.top - panY) / scale);
}

canvas.addEventListener('mousemove', (e) => {
  // 끌어 옮기는 중에는 히트 테스트를 하지 않는다 — 지나간 자리마다 이름표가 켜진다
  if (pan) return;
  const seat = seatAt(e.clientX, e.clientY);
  hover = seat?.worker.key ?? null;
  setCursor();
});
canvas.addEventListener('mouseleave', () => {
  hover = null;
  setCursor();
});
// 자리를 고르는 **단 하나의 문**. 캔버스·목록·대기 칩·알림 클릭이 다 여기를 지나야
// 목록의 표시와 패널이 어긋나지 않는다 (전에는 각자 selected를 만지고 drawPanel만 불렀다).
function selectKey(key) {
  selected = key ?? null;
  // 설정·출근부를 열어 둔 채 자리를 눌렀을 때 아무 반응이 없으면 고장으로 읽힌다.
  // 자리를 고르는 것은 "이걸 보여 달라"는 뜻이므로 세션 판으로 돌아온다.
  if (key && panelTab !== 'session') setPanelTab('session');
  drawPanel();
  drawRail();
}

canvas.addEventListener('click', (e) => {
  // 화면을 끌어 옮긴 손짓이었다 — 놓은 자리의 게를 고르는 것이 아니다
  if (swallowClick || spaceHeld) {
    swallowClick = false;
    return;
  }
  const seat = seatAt(e.clientX, e.clientY);
  // 미니에는 패널이 없다 — 자리를 누르면 큰 창으로 올라가며 그 자리가 펼쳐진다
  if (MINI) {
    if (seat) window.office?.miniSelect?.(seat.worker.key);
    return;
  }
  selectKey(seat?.worker.key ?? null);
});

// ── 패널
function findWorker(key) {
  for (const room of state.rooms ?? []) {
    const w = room.workers.find((x) => x.key === key);
    if (w) return w;
  }
  return null;
}

function attachCmd(w) {
  if (w.jobId) return `claude attach ${w.jobId}`;
  if (w.sessionId) return `claude --resume ${w.sessionId}`;
  return null;
}

function recentBlock() {
  const recent = state.recent ?? [];
  if (!recent.length) return '';
  return `<section class="block">
    <h3>${t('idle.recent')}</h3>
    <ul class="recent">
      ${recent
        .map(
          (r) => `<li>
            <span class="dot ${esc(r.state)}"></span>
            <div>
              <b>${esc(panelName(r))}</b>
              <small>${fmtTime(r.at)} · ${fmtTokens(r.tokens)}</small>
              <p>${esc(r.detail)}</p>
            </div>
          </li>`,
        )
        .join('')}
    </ul>
  </section>`;
}

// 아무것도 선택하지 않았을 때 — 시계 + Claude 계정 사용량이 기본 화면이다.
function idlePanel() {
  const u = state.usage;
  const s = state.stats ?? {};

  const usageBlock = u
    ? `
      ${gauge({
        label: t('usage.session'),
        pct: u.session?.pct ?? null,
        right: u.session?.resetsAt ? t('usage.resets', { when: fmtWhen(u.session.resetsAt) }) : '',
        note: '',
        id: 'u-session-left',
      })}
      ${gauge({
        label: t('usage.week'),
        pct: u.week?.pct ?? null,
        right: u.week?.resetsAt ? t('usage.resets', { when: fmtWhen(u.week.resetsAt) }) : '',
        note: '',
        id: 'u-week-left',
      })}
      ${
        // 파일이 깨져 있으면 화면의 숫자는 마지막으로 성공한 값이다 — 그걸 숨기지 않는다
        u.broken
          ? `<p class="hint warn">${t('usage.broken')}</p>`
          : `<p class="hint${u.stale ? ' warn' : ''}">${t('usage.age', {
              ago: fmtAgo(Date.now() - u.at),
            })}${u.stale ? t('usage.staleSuffix') : ''}</p>`
      }`
    : `<p class="dim">${t('usage.none')}</p>
       <p class="hint">${t('usage.noneHint')}</p>`;

  // 버전을 패널 바닥에 붙이려면 스크롤 영역이 flex 열이어야 한다. 그런데 내용을 flex item으로
  // 흩어 놓으면 블록 사이 margin 병합이 사라져 간격이 벌어진다 — 그래서 내용은 한 덩어리로
  // 싸 두고(`idle-body`) 버전만 형제로 둔다. 미는 일은 CSS의 `margin-top: auto`가 한다.
  //
  // **큰 시계는 없다.** 30px 시계가 화면에서 가장 큰 글자였는데, OS 시계가 이미 있고
  // 상단바에도 있다. 그 자리는 사무실 요약이 받는다 — 이 패널에서 유일하게 "지금 사무실이
  // 어떤가"를 답하는 것이다.
  return `
    <div class="panel-body idle">
    <div class="idle-body">
    <section class="block">
      <h3>${t('idle.office')}</h3>
      <dl class="facts">
        <div><dt>${t('idle.in')}</dt><dd>${t('idle.inValue', { n: s.total ?? 0 })}</dd></div>
        <div><dt>${t('idle.typing')}</dt><dd>${s.typing ?? 0}</dd></div>
        <div><dt>${t('idle.waiting')}</dt><dd>${s.waiting ?? 0}</dd></div>
        ${s.stuck ? `<div><dt>${t('idle.stuck')}</dt><dd>${s.stuck}</dd></div>` : ''}
        <div><dt>${t('idle.ctxMax')}</dt><dd>${s.contextMax == null ? '—' : `${s.contextMax}%`}</dd></div>
        <div><dt>${t('idle.aides')}</dt><dd>${s.aides ?? 0}</dd></div>
        ${s.spare ? `<div><dt>${t('idle.spare')}</dt><dd>${s.spare}</dd></div>` : ''}
      </dl>
      ${s.spare ? `<p class="hint">${t('idle.spareHint', { n: s.spare })}</p>` : ''}
    </section>

    <section class="block">
      <h3>${t('idle.account')}</h3>
      ${usageBlock}
    </section>

    ${recentBlock()}

    ${
      // 경로만 덩그러니 두면 그게 무엇인지 알 수 없다 — 앱이 읽고 있는 자리라고 적어 준다
      meta
        ? `<section class="block">
            <h3>${t('idle.reading')}</h3>
            <p><code>${esc(meta.claudeDir)}</code></p>
          </section>`
        : ''
    }

    </div>

    ${
      // 버전은 패널 바닥에. Electron 버전은 쓰는 사람에게 아무 뜻이 없어 적지 않는다.
      meta ? `<p class="version">Claude Office ${esc(meta.version)}</p>` : ''
    }
    </div>
  `;
}

// 모델·추론 강도·Fast는 계정 값이 아니라 **statusline을 그린 그 세션**의 값이다
// (office-usage.json은 그 세션의 payload다). 그래서 sessionId가 맞는 자리에만 적는다 —
// 다른 세션에 적으면 그게 곧 오해가 된다.
function usageOfSession(w) {
  const u = state.usage;
  if (!u?.sessionId || !w.sessionId || u.sessionId !== w.sessionId) return null;
  return u;
}

// 세션이 세운 할 일 목록(main/tasks.mjs). 안 쓰는 세션이 대부분이라 없으면 아무것도 안 그린다 —
// 빈 제목만 남는 자리를 만들지 않는다.
//
// 다 끝난 항목까지 늘어놓으면 열여덟 줄이 그대로 쌓여 아래 블록을 밀어낸다. 그래서 목록에는
// **아직 안 끝난 것만** 적고 끝낸 것은 머릿수로 접는다 — 지금 무엇을 하는지가 보여야 하는 자리다.
const TODO_SHOW = 12;

function todoBlock(tasks) {
  if (!tasks?.total) return '';
  const left = tasks.items.filter((i) => i.status !== 'completed');
  const shown = left.slice(0, TODO_SHOW);
  const rest = left.length - shown.length;
  return `<section class="block">
    <h3>${t('panel.todos')}<span class="todo-count">${tasks.done}/${tasks.total}</span></h3>
    ${
      // 진행 막대는 `bar()`를 안 쓴다. 그쪽은 컨텍스트용이라 60·85%에서 노랑·빨강으로 물드는데,
      // 여기서는 많이 찬 것이 **좋은 것**이다 — 다 끝나가는 목록이 빨갛게 보이면 안 된다.
      `<div class="bar todo"><i data-pct="${Math.round((tasks.done / tasks.total) * 100)}"></i></div>`
    }
    <ul class="todos">${shown
      .map(
        (i) =>
          `<li class="${esc(i.status)}${i.blockedBy.length ? ' blocked' : ''}"><span class="mark"></span><p>${esc(
            i.subject,
          )}${
            i.blockedBy.length
              ? `<em>${t('panel.todoBlocked', { ids: i.blockedBy.map((id) => `#${id}`).join(' ') })}</em>`
              : ''
          }</p></li>`,
      )
      .join('')}</ul>
    ${rest > 0 ? `<p class="dim">${t('panel.todoMore', { n: rest })}</p>` : ''}
    ${left.length === 0 ? `<p class="dim">${t('panel.todoAllDone')}</p>` : ''}
  </section>`;
}

// 자리 하나의 패널. **순서가 곧 위계다.**
//
// 전에는 섹션 제목 일곱아홉 개가 전부 같은 크기·같은 색이어서, 스크롤하는 동안
// "나를 기다린다"와 "처음 지시"가 동등하게 지나갔다. 이제는 이 순서로만 읽힌다 —
//   나를 기다림 → 컨텍스트 → 지금 상황 → 서브에이전트 → 요약(접힘) → 계획·할 일 → 지시 → 타임라인
// 그리고 대기만 **카드**이고 나머지는 라벨이다. 위계를 색이 아니라 형태로 낸다.
function workerPanel(w) {
  const cmd = attachCmd(w);
  const c = w.context;
  const u = usageOfSession(w);
  return `
    <div class="panel-body">
    <header class="who">
      <span class="mood ${esc(w.mood)}">${esc(t(`mood.${w.mood}`))}</span>
      <h2>${esc(panelName(w))}</h2>
      ${w.title ? `<p class="subtitle">${esc(w.title)}</p>` : ''}
      <p class="cwd">${esc(w.cwd)}</p>
    </header>

    ${
      // 백그라운드 잡은 무엇을 기다리는지(needs)까지 남기지만 터미널 세션은 그게 없다 —
      // 선택지가 떠 있는 동안 대화 파일에 아무것도 안 쓰이기 때문이다. 그래도 기다린다는
      // 사실만은 알려야 하므로 mood만 보고 이 블록을 띄운다.
      //
      // **이름 바로 아래다.** 전에는 기본 정보 표와 서브에이전트 뒤였는데, 패널을 여는 이유가
      // 대부분 이 한 블록이라 스크롤해서 찾게 두면 안 된다.
      w.mood === 'waiting'
        ? `<section class="block need"><h3>${t('panel.needTitle')}</h3>
            <p class="waited" id="w-waited"></p>
            <p>${esc(w.needs) || t('panel.needFallback')}</p>${
              w.suggestedReply
                ? // 읽을 수만 있고 쓸 수는 없어 손으로 다시 타야 했다. 클립보드까지가 끝이고
                  // 붙여넣기는 사람이 한다 — 세션에 답을 써 넣지는 않는다.
                  `<p class="reply">${t('panel.suggested', { reply: esc(w.suggestedReply) })}</p>
                   <button class="btn btn-wide copy reply-copy" data-cmd="${esc(w.suggestedReply)}">
                     <span>${t('panel.copyReply')}</span>
                   </button>`
                : ''
            }</section>`
        : ''
    }

    ${
      c
        ? gauge({
            label: t('panel.context'),
            pct: c.pct,
            right: `${fmtTokens(c.tokens)} / ${fmtLimit(c.limit)}`,
            note: esc(w.model ?? ''),
          })
        : ''
    }

    ${w.detail ? `<section class="block"><h3>${t('panel.detail')}</h3><p>${esc(w.detail)}</p></section>` : ''}

    ${
      w.aides?.length
        ? `<section class="block"><h3>${t('panel.aides', { n: w.aides.length })}</h3><ul class="aides">${w.aides
            .map((a) => `<li><b>${esc(a.kind)}</b>${a.label ? `<span>${esc(a.label)}</span>` : ''}</li>`)
            .join('')}</ul></section>`
        : ''
    }

    <!-- 값 열두 개가 2열 표로 여덟 줄을 차지했지만 늘 보는 것은 셋이다 —
         터미널인가 · 얼마나 돌았나 · 살아 있나. 나머지는 접는다(없애지 않는다).
         <details>라 JS 없이 열리고, 열어 둔 상태는 다시 그릴 때 초기화된다. -->
    <details class="sum">
      <summary>
        <span>${t(w.kind === 'bg' ? 'kind.bg' : 'kind.terminal')}</span>
        <span>${t('panel.uptime')} <b>${fmtAge(w.startedAt ? Date.now() - w.startedAt : null)}</b></span>
        <span>${t('panel.updated')} <b>${fmtAgo(w.updatedAt ? Date.now() - w.updatedAt : null)}</b></span>
        <em>${t('panel.factsMore')}</em>
      </summary>
    <dl class="facts">
      <div><dt>${t('panel.kind')}</dt><dd>${t(w.kind === 'bg' ? 'kind.bg' : 'kind.terminal')}</dd></div>
      <div><dt>${t('panel.uptime')}</dt><dd>${fmtAge(w.startedAt ? Date.now() - w.startedAt : null)}</dd></div>
      ${
        // 대화 파일에서 읽은 모델이 우선이다. 그게 없어도(첫 턴 전이면 없다) 같은 세션의
        // statusline payload가 있으면 그걸 쓴다 — 어느 쪽이든 이 세션의 값이다.
        w.model || u?.model
          ? `<div class="wide"><dt>${t('panel.model')}</dt><dd>${esc(w.model || u.model)}</dd></div>`
          : ''
      }
      ${
        c?.limit || u?.contextWindow
          ? `<div><dt>${t('panel.context')}</dt><dd>${fmtLimit(c?.limit || u.contextWindow)}</dd></div>`
          : ''
      }
      ${u ? `<div><dt>${t('panel.effort')}</dt><dd>${esc(u.effort ?? '—')}</dd></div>` : ''}
      ${u ? `<div><dt>${t('panel.fast')}</dt><dd>${t(u.fastMode ? 'common.on' : 'common.off')}</dd></div>` : ''}
      <div><dt>${t('panel.tokens')}</dt><dd>${fmtTokens(w.tokens)}</dd></div>
      ${
        // 만진 파일 수·편집 횟수. 파일 **이름**은 얻을 수 없다 — 엔트리 이름이 경로의 해시다
        // (main/files.mjs). 아무것도 안 고친 세션에는 칸을 만들지 않는다.
        w.files
          ? `<div><dt>${t('panel.touched')}</dt><dd>${t('panel.touchedValue', { n: w.files.files })}</dd></div>
             <div><dt>${t('panel.edits')}</dt><dd>${t('panel.editsValue', { n: w.files.edits })}</dd></div>`
          : ''
      }
      <div><dt>${t('panel.pid')}</dt><dd>${w.pid}</dd></div>
      ${w.mode ? `<div><dt>${t('panel.mode')}</dt><dd>${esc(t(`mode.${w.mode}`))}</dd></div>` : ''}
      <div><dt>${t('panel.updated')}</dt><dd>${fmtAgo(w.updatedAt ? Date.now() - w.updatedAt : null)}</dd></div>
    </dl>
    </details>

    ${
      // 승인받은 계획. 제목은 트랜스크립트에 실려 온 plan 본문에서 뽑은 것이라 파일이 지워졌어도
      // 남는다. 그래서 파일이 있을 때만 버튼을 붙이고, 제목만 있으면 제목만 적는다.
      w.plan?.title || w.plan?.file
        ? `<section class="block plan">
            <h3>${t('panel.plan')}</h3>
            <p>${esc(w.plan.title) || t('panel.planUntitled')}</p>
            ${
              w.plan.file
                ? `<button class="btn plan-open" type="button" data-plan="${esc(w.plan.file)}">${t('panel.planOpen')}</button>
                   <p class="hint plan-msg"></p>`
                : ''
            }
          </section>`
        : ''
    }
    ${todoBlock(w.tasks)}
    ${
      w.lastPrompt
        ? `<section class="block"><h3>${t('panel.lastPrompt')}</h3><p class="dim">${esc(w.lastPrompt)}</p></section>`
        : ''
    }
    ${
      w.intent
        ? `<section class="block"><h3>${t('panel.intent')}</h3><p class="dim">${esc(w.intent)}</p></section>`
        : ''
    }
    ${
      !w.detail && !w.lastPrompt && !w.intent
        ? `<section class="block"><p class="dim">${t('panel.empty')}</p></section>`
        : ''
    }

    ${
      w.links?.length
        ? `<section class="block"><h3>${t('panel.links')}</h3><ul class="links">${w.links
            .map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noreferrer">!${esc(l.id)}</a></li>`)
            .join('')}</ul></section>`
        : ''
    }

    ${
      w.timeline?.length
        ? `<section class="block"><h3>${t('panel.timeline')}</h3><ol class="timeline">${w.timeline
            .slice(-6)
            .reverse()
            .map(
              (t) =>
                `<li><span class="dot ${esc(t.state)}"></span><time>${fmtTime(t.at)}</time><p>${esc(t.detail || t.state)}</p></li>`,
            )
            .join('')}</ol></section>`
        : ''
    }

    </div>

    ${
      // 주 동작은 **스크롤 밖**이다. 전에는 내용 맨 끝이라 타임라인이 길면 묻혔고,
      // 정작 이 자리에서 하고 싶은 일(터미널로 건너가기)이 안 보였다.
      cmd
        ? `<footer class="jump">
            <button class="btn btn-go go" type="button">${t('panel.open')}</button>
            <button class="btn btn-wide copy" data-cmd="${esc(cmd)}"><code>${esc(cmd)}</code><span>${t('panel.copy')}</span></button>
            <p class="hint jump-msg" id="jump-msg"></p>
          </footer>`
        : ''
    }
  `;
}

// 계획서 열기. 파일이 사라졌을 수 있으므로(계획은 사람이 지운다) 실패를 화면에 적는다 —
// 눌렀는데 아무 일도 안 일어나는 것이 가장 나쁘다.
function wirePlan() {
  const btn = paneSession.querySelector('.plan-open');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const msg = paneSession.querySelector('.plan-msg');
    btn.disabled = true;
    const res = await window.office?.openPlan?.(btn.dataset.plan).catch(() => null);
    btn.disabled = false;
    if (msg) msg.textContent = res?.ok ? '' : t(res?.reason === 'outside' ? 'panel.planBad' : 'panel.planGone');
  });
}

// 터미널을 띄우는 일은 main이 한다(main/terminal.mjs). 여기서는 누구인지만 넘긴다 —
// 명령 문자열을 넘기면 그게 임의 명령 실행 통로가 되므로 id만 보낸다.
function wireJump() {
  const btn = paneSession.querySelector('.go');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const w = selected ? findWorker(selected) : null;
    const msg = paneSession.querySelector('#jump-msg');
    if (!w) return;
    btn.disabled = true;
    const res = await window.office?.openTerminal?.({ cwd: w.cwd, jobId: w.jobId, sessionId: w.sessionId }).catch(
      () => null,
    );
    btn.disabled = false;
    if (res?.ok) {
      btn.textContent = t('panel.opened');
      if (msg) msg.textContent = '';
      setTimeout(() => {
        btn.textContent = t('panel.open');
      }, 1500);
      return;
    }
    // 못 띄웠으면 명령을 클립보드에 넣어준다 — 손으로 붙여넣을 수 있어야 한다
    if (res?.cmd) window.office?.copy(res.cmd);
    if (msg) {
      msg.textContent = [res?.message, res?.cmd && t('panel.copiedCmd')].filter(Boolean).join(' ');
    }
  });
}

// ── 패널 탭 (세션 · 출근부 · 설정)
//
// 설정·출근부가 창에서 여기로 들어왔다. 창은 배경 차단과 Esc 닫기를 공짜로 줬지만, 420px에
// 갇혀 방 목록·표가 좁았고 사무실을 보면서 만질 수 없었다.
//
// **세션을 고르면 세션 탭으로 돌아온다.** 설정을 열어 둔 채 자리를 눌렀을 때 아무 반응이
// 없으면 고장으로 읽힌다.
const PANEL_TABS = [
  ['session', 'panel.tab.session'],
  ['att', 'att.title'],
  ['cfg', 'cfg.title'],
];
let panelTab = 'session';

function drawPanelTabs() {
  panelTabsEl.innerHTML = PANEL_TABS.map(
    ([k, label]) => `<button type="button" role="tab" aria-selected="${k === panelTab}"
      class="panel-tab${k === panelTab ? ' on' : ''}" data-panel-tab="${k}">${t(label)}</button>`,
  ).join('');
}

// **보이기와 내용 다시 그리기를 갈라 둔다.** 앞은 스냅샷마다 불러도 싸고 아무것도 잃지 않지만,
// 뒤는 설정·출근부 판을 다시 짜므로 스크롤 자리와 펼쳐 둔 것이 초기화된다.
function applyPanelTab() {
  paneSession.hidden = panelTab !== 'session';
  paneAtt.hidden = panelTab !== 'att';
  paneCfg.hidden = panelTab !== 'cfg';
  drawPanelTabs();
}

function drawPanelView() {
  if (panelTab === 'cfg') drawCfg();
  else if (panelTab === 'att') drawAtt();
}

// 탭을 옮기면 캡션은 허공에 남는다 — 같이 닫는다.
// 패널이 접혀 있으면 먼저 펴 준다: 상단바의 설정·출근부 버튼을 눌렀는데 아무 일도 없으면 안 된다.
function setPanelTab(next) {
  panelTab = next;
  closeCaption();
  if (!cfg.panelOpen) saveView({ panelOpen: true });
  applyPanelTab();
  drawPanelView();
}

panelTabsEl.addEventListener('click', (e) => {
  const tab = e.target?.dataset?.panelTab;
  if (tab && tab !== panelTab) setPanelTab(tab);
});

function drawPanel() {
  const w = selected ? findWorker(selected) : null;
  // 패널은 늘 두 층이다 — 굴러가는 몸통(.panel-body)과 바닥에 붙는 주 동작(.jump).
  // 몸통을 flex 열로 만드는 것은 기본 화면뿐이고(버전을 바닥으로 밀기 위해서다),
  // 그 클래스는 idlePanel이 스스로 달고 온다.
  paneSession.innerHTML = w ? workerPanel(w) : idlePanel();

  // **querySelectorAll이어야 한다.** 복사 버튼이 둘(재접속 명령 · 추천 답)이 되면서
  // querySelector 하나만 잡던 코드는 둘째 버튼을 죽은 버튼으로 만들었다.
  for (const btn of paneSession.querySelectorAll('.copy')) {
    btn.addEventListener('click', () => {
      window.office.copy(btn.dataset.cmd);
      const tag = btn.querySelector('span');
      btn.classList.add('done');
      // 글자를 갈아 끼운다 — CSS로 "됨"을 덧붙이는 방식은 한국어에서만 문장이 된다
      if (tag) tag.textContent = t('panel.copied');
      setTimeout(() => {
        btn.classList.remove('done');
        if (tag) tag.textContent = t('panel.copy');
      }, 1200);
    });
  }
  wirePlan();
  wireJump();
  paintBars();
  tickPanel();
}

// 1초마다 시계와 "초기화까지" 숫자만 갈아 끼운다 — 패널을 통째로 다시 그리면
// 스크롤 위치가 튀고 텍스트 선택이 풀린다.
function tickPanel() {
  const now = Date.now();
  // 기다린 시간은 여기서만 갈아 끼운다 — statusAt이 절대 시각이라 스냅샷을 기다리지 않는다
  const waited = paneSession.querySelector('#w-waited');
  if (waited) {
    const w = selected ? findWorker(selected) : null;
    waited.textContent = w?.statusAt ? fmtWaited(Date.now() - w.statusAt) : '';
  }
  const u = state.usage;
  const s = paneSession.querySelector('#u-session-left');
  if (s) s.textContent = u?.session?.resetsAt ? t('usage.left', { d: fmtLeft(u.session.resetsAt - now) }) : '';
  const wk = paneSession.querySelector('#u-week-left');
  if (wk) wk.textContent = u?.week?.resetsAt ? t('usage.left', { d: fmtLeft(u.week.resetsAt - now) }) : '';
}

// 가장 오래 기다린 놈이 몇 분째인지. 상단바는 늘 보이는 자리라 여기에 적어두면
// 자리를 클릭하지 않고도 방치된 대기를 알아챈다. 1분 안쪽은 적지 않는다.
function longestWaitMin() {
  let worst = 0;
  for (const room of state.rooms ?? []) {
    for (const w of room.workers) {
      if (w.mood !== 'waiting' || !w.statusAt) continue;
      worst = Math.max(worst, Date.now() - w.statusAt);
    }
  }
  return Math.floor(worst / 60000);
}

// 상단바에 지금 적어 둔 방치 시간(분). 스냅샷은 statusAt이 고정이면 다시 오지 않으므로
// (main의 중복 전송 차단) 1초 타이머가 이 값을 보고 상단바만 다시 그린다 —
// 그러지 않으면 30분째 방치된 대기가 "최장 3분"에서 멈춘 채로 남는다.
let shownWaitMin = -1;

// 미니의 한 줄. 곁눈질용이라 숫자만 남긴다 — 여기서 길어지면 창을 줄인 뜻이 없다.
// 미니 모드의 한 줄. 큰 창과 **같은 위계**를 쓴다 — 대기가 먼저 서고 총원은 가라앉는다.
// 전에는 총원이 맨 앞에 굵게 있었고 대기가 그 뒤에 섞여 있었다.
function drawMiniStats() {
  const s = state.stats ?? {};
  miniStatsEl.innerHTML = [
    s.waiting ? `<span class="w">${icon('bang')}${s.waiting} ${t('topbar.waiting')}</span>` : '',
    s.stuck ? `<span class="s">${s.stuck}</span>` : '',
    s.failed ? `<span class="f">${s.failed}</span>` : '',
    `<span class="n">${s.total ?? 0}</span>`,
  ]
    .filter(Boolean)
    .join('<i>·</i>');
}

// 안 보이는 방이 몇인지, 그리고 거기서 빠져나오는 길. 걸러 놓은 것을 잊고 "방이 사라졌다"고
// 여기는 일이 없어야 한다.
function drawRoomBadge() {
  const total = (state.rooms ?? []).length;
  const hidden = total - roomsToDraw().length;
  shownBtn.hidden = hidden <= 0;
  if (hidden > 0) {
    shownBtn.textContent = t('topbar.hidden', { n: hidden });
    shownBtn.title = t('topbar.hiddenTitle');
  }
  // 전부 걸러졌으면 빈 캔버스 대신 이유를 적는다.
  // 캔버스는 절대 배치라 안내를 덮으므로(끌어 옮기느라 그렇게 띄웠다) 아예 감춘다.
  const empty = total > 0 && hidden === total;
  stageEmpty.hidden = !empty;
  canvas.hidden = empty;
  if (empty) stageEmpty.textContent = t('topbar.allHidden');
}

function drawStats() {
  const s = state.stats ?? {};
  const u = state.usage;
  const waitMin = longestWaitMin();
  shownWaitMin = waitMin;
  if (MINI) {
    drawMiniStats();
    return;
  }
  drawRoomBadge();

  // 대기 — 유일하게 채워진 칩이다. 없으면 자리째 사라져 평소 상단바가 더 조용해진다.
  const waiting = s.waiting ?? 0;
  waitChip.hidden = waiting === 0;
  if (waiting > 0) {
    waitChip.innerHTML =
      `${icon('bang')} <b>${waiting}</b> ${t('topbar.waiting')}` +
      (waitMin >= 1 ? ` <span class="t">${t('topbar.longest', { d: fmtDur(waitMin * 60_000) })}</span>` : '');
    waitChip.title = t('topbar.waitChipTitle');
  }

  // 가운데는 **상태만**. 수치는 오른쪽에서 가라앉는다.
  statsEl.innerHTML = [
    `<b>${s.total ?? 0}</b> ${t('topbar.in')}`,
    s.typing ? `<span class="t">${s.typing}</span> ${t('topbar.typing')}` : '',
    s.stuck ? `<span class="s">${s.stuck}</span> ${t('topbar.stuck')}` : '',
    s.failed ? `<span class="f">${s.failed}</span> ${t('topbar.failed')}` : '',
  ]
    .filter(Boolean)
    .join('<i>·</i>');

  usageMini.innerHTML = [
    `<span>${t('topbar.tokens', { n: fmtTokens(s.tokens) })}</span>`,
    u?.session ? `<span>5h ${u.session.pct}%</span>` : '',
    u?.week ? `<span>wk ${u.week.pct}%</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  document.title = waiting ? `(${waiting}) Claude Office` : 'Claude Office';
}

// 대기 칩을 누르면 가장 오래 기다리는 자리를 연다. 방이 많으면 캔버스에서 그 자리를 찾는 것이
// 곧 일이 되는데, 이 앱을 여는 이유가 바로 그 자리 하나다.
function selectLongestWait() {
  let worst = null;
  for (const room of state.rooms ?? []) {
    for (const w of room.workers) {
      if (w.mood !== 'waiting') continue;
      // statusAt이 없으면 언제부터인지 모르지만 대기이긴 하다 — 후보로는 남긴다
      if (!worst || (w.statusAt ?? Infinity) < (worst.statusAt ?? Infinity)) worst = w;
    }
  }
  if (worst) selectKey(worst.key);
}

waitChip.addEventListener('click', selectLongestWait);

// ── 왼쪽 세션 목록
//
// 캔버스와 **같은 것을 본다** — 거르기·접기를 지난 방만 담는다(roomsToDraw). 목록에만 보이는
// 세션이 있으면 눌렀는데 캔버스에서 자리를 못 찾는 일이 생기고, 그때 어느 쪽이 맞는지 알 수 없다.
//
// 급한 순서로 묶는다. **헤매는 중을 작업 중에 섞지 않는다** — 섞으면 "작업 중 5"가 되고
// 구분해 둔 뜻이 사라진다(main/collect.mjs의 같은 판단).
const RAIL_GROUPS = [
  ['waiting', 'topbar.waiting', (w) => w.mood === 'waiting'],
  ['stuck', 'topbar.stuck', (w) => w.mood === 'stuck'],
  ['failed', 'topbar.failed', (w) => w.mood === 'failed'],
  ['typing', 'topbar.typing', (w) => w.mood === 'typing'],
  ['rest', 'rail.rest', (w) => ['idle', 'done', 'stopped'].includes(w.mood)],
];

// 행 오른쪽에 적을 것. 묶음마다 알고 싶은 시간이 다르다 —
// 대기는 **얼마나 기다렸나**, 도는 것은 **얼마나 돌았나**, 퇴근은 **언제 끝났나**.
function railMeta(w) {
  if (w.mood === 'waiting') {
    // 1초마다 갈아 끼운다(tickRail). statusAt이 절대 시각이라 스냅샷을 기다리지 않는다.
    return w.statusAt ? `<time class="t" data-since="${w.statusAt}">${fmtDur(Date.now() - w.statusAt)}</time>` : '';
  }
  if (w.mood === 'typing' || w.mood === 'stuck') {
    return w.startedAt ? `<time>${fmtAge(Date.now() - w.startedAt)}</time>` : '';
  }
  return '';
}

function railRow(key, mood, name, meta) {
  return `<button type="button" class="rail-row${key === selected ? ' on' : ''}" data-key="${esc(key)}"
    title="${esc(name)}"><span class="dot ${esc(mood)}"></span><span class="nm">${esc(name)}</span>${meta}</button>`;
}

function drawRail() {
  if (MINI) return;
  const rooms = roomsToDraw();
  const workers = rooms.flatMap((r) => r.workers ?? []);
  const recent = state.recent ?? [];

  const parts = [];
  for (const [key, label, pick] of RAIL_GROUPS) {
    const list = workers.filter(pick);
    if (!list.length) continue;
    parts.push(`<div class="rail-group ${esc(key)}">${t(label)}<span class="c">${list.length}</span></div>`);
    parts.push(list.map((w) => railRow(w.key, w.mood, panelName(w), railMeta(w))).join(''));
  }
  // 퇴근한 작업은 캔버스에 없다(자리를 안 차지한다) — 목록에서만 만난다.
  if (recent.length) {
    parts.push(`<div class="rail-group">${t('idle.recent')}<span class="c">${recent.length}</span></div>`);
    parts.push(
      recent
        .map((r) => railRow(r.key, r.state, panelName(r), `<time>${fmtTime(r.at)}</time>`))
        .join(''),
    );
  }

  railList.innerHTML = parts.length
    ? parts.join('')
    : `<p class="rail-empty">${t('rail.empty')}<br /><small>${t('rail.emptyHint')}</small></p>`;
}

// 대기 시간만 1초마다 갈아 끼운다 — 목록을 통째로 다시 그리면 스크롤 자리가 튄다.
function tickRail() {
  for (const el of railList.querySelectorAll('time[data-since]')) {
    el.textContent = fmtDur(Date.now() - Number(el.dataset.since));
  }
}

railList.addEventListener('click', (e) => {
  const row = e.target.closest?.('.rail-row');
  if (row) selectKey(row.dataset.key);
});

// ── 양쪽 열 접기
//
// 3열이 되면서 사무실이 좁아진 것을 **그때그때 되돌릴 수 있게** 한다. 둘 다 접으면 창 전체가
// 사무실이다. 접힌 상태는 설정에 저장되므로 껐다 켜도 그대로다.
//
// **왼쪽을 접어도 대기 신호는 남는다** — 상단바의 대기 칩이 그 역할을 한다(#113).
function applyPanes() {
  document.body.classList.toggle('rail-off', !cfg.railOpen);
  document.body.classList.toggle('panel-off', !cfg.panelOpen);
  railToggle.classList.toggle('on', cfg.railOpen);
  panelToggle.classList.toggle('on', cfg.panelOpen);
  railToggle.setAttribute('aria-pressed', String(cfg.railOpen));
  panelToggle.setAttribute('aria-pressed', String(cfg.panelOpen));
}

// 접고 펴면 사무실 폭이 바뀐다 — 리사이즈와 **같은 경로**를 타야 방 줄 나누기가 다시 잡힌다.
function togglePane(which) {
  saveView(which === 'rail' ? { railOpen: !cfg.railOpen } : { panelOpen: !cfg.panelOpen });
}

railToggle.addEventListener('click', () => togglePane('rail'));
panelToggle.addEventListener('click', () => togglePane('panel'));

// 창이 떠 있을 때만 뜻이 있는 동작이라 **전역 단축키로 잡지 않는다** — 트레이에 들어가 있는
// 동안에도 조합을 먹는 것은 이 일에 과하다. 편집기의 사이드바 토글과 같은 자리를 쓴다.
window.addEventListener('keydown', (e) => {
  if (MINI || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  // 글자를 치는 중이거나 단축키를 받는 중이면 손대지 않는다
  if (e.target?.closest?.('input, select, textarea')) return;
  if (e.key === '[') {
    e.preventDefault();
    togglePane('rail');
  } else if (e.key === ']') {
    e.preventDefault();
    togglePane('panel');
  }
});

// ── 설정 창
//
// 방 목록은 지금 떠 있는 방에서 나오므로 열 때마다 다시 짠다. 열려 있는 동안 스냅샷이 와도
// 방 구성이 그대로면 건드리지 않는다 — 다시 그리면 펼쳐둔 목록이 닫히고 초점이 튄다.
let cfgRooms = null;

// 방 묶기용 경로 다루기. main/rooms.mjs와 같은 셈법이어야 하지만 렌더러는 node:path를 못
// 쓰므로 문자열로 처리한다 — 구분자를 하나로 펴고 대소문자를 무시한다(Windows).
const SEP = /[\\/]+/g;

function flatPath(p) {
  return String(p ?? '')
    .replace(SEP, '/')
    .replace(/\/+$/, '');
}

function samePath(a, b) {
  const x = flatPath(a).toLowerCase();
  return x !== '' && x === flatPath(b).toLowerCase();
}

// 이 방을 묶을 때 등록할 부모 경로. 드라이브 루트까지 올라가면 온 사무실이 한 방이 되므로
// 빈 문자열을 돌려 버튼을 만들지 않는다.
function parentPath(cwd) {
  const flat = flatPath(cwd);
  const cut = flat.lastIndexOf('/');
  if (cut <= 0) return '';
  const parent = flat.slice(0, cut);
  return /^[a-zA-Z]:$/.test(parent) ? '' : parent;
}

function roomSig() {
  return (state.rooms ?? []).map((r) => r.key).join('|');
}

// main도 같은 값을 걸러내지만(sanitizeView), 렌더러는 IPC 없이도 돌아야 하므로 여기서도 본다.
function normalizeView(v) {
  const list = (x) => (Array.isArray(x) ? x.filter((k) => typeof k === 'string' && k) : []);
  return {
    names: NAME_MODES.includes(v?.names) ? v.names : 'show',
    roomThemes: v?.roomThemes && typeof v.roomThemes === 'object' ? { ...v.roomThemes } : {},
    pinned: list(v?.pinned),
    collapsed: list(v?.collapsed),
    roomGroups: list(v?.roomGroups),
    roomAlias: v?.roomAlias && typeof v.roomAlias === 'object' ? { ...v.roomAlias } : {},
    // 양쪽 열이 열려 있는지. 기본이 열림이라 옛 설정에도 값이 없어도 된다.
    railOpen: v?.railOpen !== false,
    panelOpen: v?.panelOpen !== false,
  };
}

function options(entries, picked) {
  return entries
    .map(([value, label]) => `<option value="${esc(value)}"${value === picked ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

// ── 전역 단축키
//
// 조합을 손으로 타이핑하게 하면 Accelerator 문법을 사람이 외워야 한다. 그래서 칸을 누르고
// **원하는 조합을 실제로 누르는** 방식으로 받는다. 여기서 만드는 문자열은 main이 다시 검사한다.
let hotkeyCfg = null;
let capturing = null; // 지금 조합을 받고 있는 자리 (toggle | jump)

// 자리 목록은 main이 들고 있다(`hotkeys`의 키) — 여기서는 라벨만 붙인다.
// 목록을 양쪽에 두면 하나를 늘릴 때마다 두 군데를 고쳐야 한다.
const HOTKEY_LABEL = { toggle: 'cfg.hotkeyToggle', jump: 'cfg.hotkeyJump', mini: 'cfg.hotkeyMini' };

// 눌린 키를 Electron Accelerator로. 수식키만 눌린 동안에는 아직 조합이 아니다.
function accelOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!parts.length) return null; // 수식키 없는 한 글자를 전역으로 잡으면 타이핑을 통째로 먹는다

  const k = e.key;
  if (!k || /^(Control|Meta|Alt|Shift|OS)$/.test(k)) return null;
  // 표시용 이름으로 눌러 편다 — Alt를 끼면 e.key가 기호로 오므로 code에서 글자를 뽑는다
  const fromCode = /^(Key|Digit)([A-Z0-9])$/.exec(e.code);
  const key = fromCode ? fromCode[2] : k.length === 1 ? k.toUpperCase() : k;
  if (!/^[A-Za-z0-9]{1,12}$/.test(key)) return null;
  parts.push(key);
  return parts.join('+');
}

// 저장은 Accelerator 문법 그대로 두고 보여줄 때만 눌러 편다 — `CommandOrControl+Alt+O`는
// 칸을 다 잡아먹고, 사람이 실제로 누르는 키의 이름도 아니다.
function accelLabel(accel) {
  return accel.replace('CommandOrControl', /Mac/i.test(navigator.userAgent) ? 'Cmd' : 'Ctrl');
}

// main이 없으면(브라우저로 직접 연 경우) 이 탭들은 채울 값이 없다 — 빈 화면 대신 이유를 적는다
function noIpc() {
  return `<p class="dim">${t('idle.notElectron')}</p>`;
}

// 설명은 대부분 **한 번 읽으면 되는 것**인데 늘 자리를 차지하고, 정작 고치러 온 값이
// 그 사이에 묻힌다. 그래서 `?` 뒤로 접는다 — 우측 하단 물음표와 같은 몸짓이다.
//
// 펼친 것은 기억해 둔다. 설정 창은 값이 바뀔 때마다 통째로 다시 그리는데, 그때마다
// 접혀 버리면 읽던 문장이 손가락 밑에서 사라진다.

// ── `?` 캡션.
//
// **설명은 자기가 설명하는 것 옆에 붙는다** — 제목이 있으면 그 제목 안에, 판 전체를 설명하는
// 것이면 탭 바 끝에. 처음에는 `?`를 제 줄에 두고 아래로 펼쳤는데(아코디언) 두 가지가 걸렸다:
// 무엇에 대한 설명인지 알기 어렵고, 펼칠 때 아래 내용이 밀려 방금 보던 자리가 움직인다.
//
// 그래서 **떠오르는 캡션**으로 바꿨다(기본 화면 우측 하단 물음표와 같은 방식).
// 창마다 캡션 하나를 두고 눌린 버튼 자리에서 띄운다 — 내용이 밀리지 않는다.
//
// 문구는 그릴 때 미리 만들어 둔다. `{days}` 같은 값을 채운 결과를 눌렀을 때 다시 만들려면
// 그 값을 어딘가 실어 보내야 하는데, HTML이 섞인 문구를 속성에 담는 것보다 이쪽이 안전하다.
const hintText = new Map();

function hintBtn(key, params) {
  hintText.set(key, t(key, params));
  return `<button type="button" class="btn btn-round sm hint-btn" data-hint="${esc(key)}"
    aria-label="${t('common.hintTitle')}" title="${t('common.hintTitle')}">?</button>`;
}

// 지금 떠 있는 캡션과 그것을 띄운 버튼. 같은 버튼을 다시 누르면 닫는다.
let captionOn = null;

function closeCaption() {
  if (!captionOn) return;
  captionOn.btn.classList.remove('on');
  captionOn.el.hidden = true;
  captionOn = null;
}

// 캡션은 body의 자식이고 `position: fixed`다. 전에는 창마다 하나씩 두고 dialog가 top layer라는
// 것에 기대고 있었는데, 창이 없어졌으니 하나로 족하고 **패널을 기준으로** 자리를 잡는다.
function openCaption(btn) {
  const key = btn.dataset.hint;
  const el = captionEl;
  if (!key || !el) return;
  if (captionOn?.btn === btn) return closeCaption();
  closeCaption();

  el.innerHTML = hintText.get(key) ?? '';
  el.hidden = false;
  btn.classList.add('on');
  captionOn = { btn, el };

  // 버튼 아래에 붙이고, 패널 밖으로 넘치면 안으로 당긴다.
  const b = btn.getBoundingClientRect();
  const d = panel.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = Math.min(Math.max(d.left + 8, b.left - 8), d.right - w - 8);
  const below = b.bottom + 6;
  // 아래로 넘치면 위로 뒤집는다
  const flip = below + el.offsetHeight > window.innerHeight - 8;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(flip ? b.top - el.offsetHeight - 6 : below)}px`;
}

function hotkeyBlock() {
  if (!hotkeyCfg) return noIpc();
  const row = (action) => {
    const accel = hotkeyCfg.hotkeys[action] ?? '';
    const bad = accel && hotkeyCfg.failed?.includes(accel);
    const text = capturing === action ? t('cfg.hotkeyPress') : accel ? accelLabel(accel) : t('cfg.hotkeyNone');
    return `<div class="cfg-row">
      <label><b>${t(HOTKEY_LABEL[action])}</b>${bad ? `<small class="warn">${t('cfg.hotkeyTaken')}</small>` : ''}</label>
      <button type="button" class="btn cfg-key${capturing === action ? ' on' : ''}${bad ? ' bad' : ''}"
        data-hotkey="${esc(action)}">${esc(text)}</button>
    </div>`;
  };
  return `
    <section class="block">
      ${Object.keys(hotkeyCfg.hotkeys)
        .filter((a) => HOTKEY_LABEL[a])
        .map(row)
        .join('')}
    </section>
  `;
}

async function saveHotkeys(patch) {
  const next = await window.office?.setHotkeys?.(patch).catch(() => null);
  if (next) hotkeyCfg = next;
  capturing = null;
  drawCfg();
}

// 알림 섹션. 트레이 메뉴에도 같은 항목이 있지만 시각을 고르는 일은 메뉴로 못 하고,
// 종류가 다섯이라 한자리에 펼쳐 보이는 편이 켜고 끄기 쉽다.
function notifyBlock() {
  if (!notifyCfg) return noIpc();
  const q = notifyCfg.quiet;
  const label = (k) => (k === 'done' ? t(KIND_LABEL[k], { d: fmtDur(notifyCfg.doneAfterMs) }) : t(KIND_LABEL[k]));
  return `
    <section class="block">
      ${notifyCfg.kinds
        .filter((k) => KIND_LABEL[k])
        .map(
          (k) => `<label class="cfg-check">
            <input type="checkbox" data-notify="${esc(k)}"${notifyCfg.notify[k] ? ' checked' : ''}>
            <span>${esc(label(k))}</span>
          </label>`,
        )
        .join('')}
    </section>

    <section class="block">
      <h3>${t('cfg.quietSection')}${hintBtn('cfg.quietHint')}</h3>
      <label class="cfg-check">
        <input type="checkbox" id="cfg-quiet-on"${q.hours ? ' checked' : ''}>
        <span>${t('cfg.quiet')}</span>
      </label>
      <div class="cfg-row">
        <label for="cfg-quiet-from"><b>${t('cfg.quietRange')}</b></label>
        <input type="time" id="cfg-quiet-from" value="${esc(q.from)}">
        <span class="cfg-sep">~</span>
        <input type="time" id="cfg-quiet-to" value="${esc(q.to)}">
      </div>
    </section>
  `;
}

// 언어와 이름표 — 화면에 무엇이 어떤 말로 적히는지.
function generalPane() {
  return `
    <section class="block">
      <h3>${t('cfg.langSection')}${hintBtn('cfg.langHint')}</h3>
      <div class="cfg-row">
        <label for="cfg-lang"><b>${t('cfg.lang')}</b></label>
        <select id="cfg-lang">${options(
          // 언어 이름은 그 언어로 적는다 — 읽을 수 없는 언어로 적힌 항목은 고를 수가 없다
          [['auto', t('common.langAuto')], ...LANGS.map((l) => [l, LANG_NAMES[l]])],
          langPref,
        )}</select>
      </div>
    </section>

    <section class="block">
      <h3>${t('cfg.namesSection')}${hintBtn('cfg.namesHint')}</h3>
      <div class="cfg-row">
        <label for="cfg-names"><b>${t('cfg.names')}</b></label>
        <select id="cfg-names">${options(
          NAME_MODES.map((m) => [m, t(`names.${m}`)]),
          cfg.names,
        )}</select>
      </div>
    </section>
  `;
}

// 방마다 한 줄 — 종류 · 알림 세기 · 고정 · 접기. 탭 하나를 통째로 쓰므로 제목은 없다.
function roomsPane() {
  const rooms = state.rooms ?? [];
  const picked = Object.keys(cfg.roomThemes).length;
  return `
    <section class="block">
      ${
        rooms.length
          ? rooms
              .map(
                (r, i) => `<div class="cfg-row cfg-room">
                  <label for="cfg-room-${i}">
                    <b>${esc(r.label)}</b><small>${esc(r.cwd ?? '')}</small>
                    <span class="cfg-marks">
                      <button type="button" class="btn btn-toggle cfg-mark${cfg.pinned.includes(r.key) ? ' on' : ''}"
                        data-pin="${esc(r.key)}" title="${t('cfg.roomPin')}">${icon(
                          cfg.pinned.includes(r.key) ? 'pinOn' : 'pin',
                        )}</button>
                      <button type="button" class="btn btn-toggle cfg-mark${cfg.collapsed.includes(r.key) ? ' on' : ''}"
                        data-collapse="${esc(r.key)}" title="${t('cfg.roomCollapse')}">${icon(
                          cfg.collapsed.includes(r.key) ? 'foldOn' : 'fold',
                        )}</button>
                      ${
                        // 부모 경로를 손으로 적지 않게 한다 — 이 방의 부모를 한 번에 등록한다.
                        // 부모가 드라이브 루트면 온 사무실이 한 방이 되므로 버튼을 안 만든다.
                        parentPath(r.cwd)
                          ? `<button type="button" class="btn btn-toggle cfg-mark${
                              cfg.roomGroups.some((g) => samePath(g, parentPath(r.cwd))) ? ' on' : ''
                            }" data-group="${esc(parentPath(r.cwd))}" title="${t('cfg.roomGroup', {
                              parent: esc(parentPath(r.cwd)),
                            })}">${icon('group')}</button>`
                          : ''
                      }
                    </span>
                  </label>
                  <select id="cfg-room-${i}" data-room="${esc(r.key)}" aria-label="${t('cfg.roomTheme')}">${options(
                    [['', t('common.auto')], ...THEMES.map((theme) => [theme.key, theme.label])],
                    cfg.roomThemes[r.key] ?? '',
                  )}</select>
                  <input type="text" class="cfg-alias" data-alias="${esc(r.key)}"
                    aria-label="${t('cfg.roomAlias')}" placeholder="${t('cfg.roomAliasPlaceholder')}"
                    maxlength="40" value="${esc(cfg.roomAlias[r.key] ?? '')}">
                  ${
                    notifyCfg
                      ? `<select data-room-notify="${esc(r.key)}" aria-label="${t('cfg.roomNotify')}">${options(
                          notifyCfg.levels.map((l) => [l, t(`roomLevel.${l}`)]),
                          notifyCfg.roomNotify[r.key] ?? 'normal',
                        )}</select>`
                      : ''
                  }
                </div>`,
              )
              .join('')
          : `<p class="dim">${t('cfg.roomsEmpty')}</p>`
      }
      <button class="btn cfg-reset" type="button"${picked ? '' : ' disabled'}>${t('cfg.roomsReset')}</button>
    </section>
  `;
}

// 탭. 설정이 다섯 갈래로 늘어 한 두루마리에 다 세우면 찾는 데 스크롤이 필요하다.
// 탭 하나에 한 주제만 담아 이름과 내용이 어긋나지 않게 한다.
const CFG_TABS = [
  ['general', generalPane],
  ['notify', notifyBlock],
  ['rooms', roomsPane],
  ['keys', hotkeyBlock],
];
// 창을 닫았다 다시 열면 보던 탭이 그대로다. 앱을 껐다 켜면 처음으로 — 저장까지 할 값은 아니다.
let cfgTab = 'general';

function drawCfg() {
  // 판을 다시 그리면 캡션을 띄운 버튼이 사라진다 — 허공에 떠 있지 않게 같이 닫는다
  closeCaption();
  cfgRooms = roomSig();
  const pane = CFG_TABS.find(([k]) => k === cfgTab) ?? CFG_TABS[0];

  // 판 전체를 설명하는 것은 제목에 붙일 자리가 없다 — 탭 바 끝에 둔다.
  // "이 탭에 관한 설명"으로 읽히고, 제목이 있는 절은 그 제목 안에 따로 붙는다.
  const TAB_HINT = { keys: 'cfg.hotkeyHint', rooms: 'cfg.roomsHint' };
  cfgTabsEl.innerHTML =
    CFG_TABS.map(
      ([k]) => `<button type="button" role="tab" aria-selected="${k === pane[0]}"
      class="btn btn-toggle${k === pane[0] ? ' on' : ''}" data-cfg-tab="${k}">${t(`cfg.tab.${k}`)}</button>`,
    ).join('') + (TAB_HINT[pane[0]] ? hintBtn(TAB_HINT[pane[0]]) : '');
  cfgBody.innerHTML = pane[1]();
}

// 화면을 먼저 바꾸고 저장은 뒤따른다 — IPC 응답을 기다리면 select만 움직이고 사무실은 멈춰 있다.
async function saveView(patch) {
  cfg = normalizeView({ ...cfg, ...patch });
  refresh();
  const saved = await window.office?.setView?.(patch).catch(() => null);
  if (saved) cfg = normalizeView(saved);
}

// 알림 설정은 트레이 메뉴에서도 바뀐다 — 열 때마다 새로 받아 와야 화면이 실제와 맞는다.
async function saveNotify(patch) {
  const next = await window.office?.setNotify?.(patch).catch(() => null);
  if (next) notifyCfg = next;
}

// 알림·단축키는 트레이 메뉴에서도 바뀐다 — 판을 열 때 다시 받아 와야 화면이 실제와 맞는다.
async function openCfgTab() {
  notifyCfg = (await window.office?.getNotify?.().catch(() => null)) ?? notifyCfg;
  hotkeyCfg = (await window.office?.getHotkeys?.().catch(() => null)) ?? hotkeyCfg;
  capturing = null;
  setPanelTab('cfg');
}
document.getElementById('cfg-open').addEventListener('click', openCfgTab);

cfgTabsEl.addEventListener('click', (e) => {
  if (handleHintClick(e.target)) return;
  const tab = e.target?.dataset?.cfgTab;
  if (!tab || tab === cfgTab) return;
  cfgTab = tab;
  capturing = null; // 탭을 옮기면 받던 조합은 없던 일이 된다
  drawCfg();
});

// 조합을 받는 동안은 창의 다른 단축키(패널 접기 등)보다 먼저 가로챈다.
// 전에는 <dialog>가 받았다 — 창이 없어졌으니 문서에서 받고 **캡처 단계**에서 가로챈다.
document.addEventListener('keydown', (e) => {
  if (!capturing) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    capturing = null;
    drawCfg();
    return;
  }
  // 비우는 것이 곧 끄는 것이다
  if (e.key === 'Backspace' || e.key === 'Delete') {
    saveHotkeys({ [capturing]: '' });
    return;
  }
  const accel = accelOf(e);
  if (accel) saveHotkeys({ [capturing]: accel });
});

cfgBody.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'cfg-lang') {
    // 콕 집은 언어는 화면부터 바꾼다 — main의 응답을 기다리면 select만 움직이고 화면은
    // 잠깐 예전 언어로 남는다. '자동'은 OS 로케일을 main만 알므로(app.getLocale) 기다린다.
    if (LANGS.includes(el.value)) applyLang({ lang: el.value, pref: el.value });
    else langPref = el.value;
    window.office
      ?.setLang?.(el.value)
      .then(applyLang)
      .catch(() => {
        /* IPC가 없으면(브라우저로 직접 연 경우) 이 창에서만 바뀐 채로 둔다 */
      });
    return;
  }
  if (el.id === 'cfg-names') {
    saveView({ names: el.value });
    return;
  }
  if (el.dataset?.notify) {
    saveNotify({ notify: { [el.dataset.notify]: el.checked } });
    return;
  }
  if (el.id === 'cfg-quiet-on') {
    saveNotify({ quiet: { hours: el.checked } });
    return;
  }
  if (el.id === 'cfg-quiet-from' || el.id === 'cfg-quiet-to') {
    const which = el.id.endsWith('from') ? 'from' : 'to';
    // 시각 칸을 비운 채로 두면 main이 기본값으로 되돌린다 — 화면도 그 값으로 맞춰 준다
    saveNotify({ quiet: { [which]: el.value } }).then(() => {
      if (notifyCfg) el.value = notifyCfg.quiet[which];
    });
    return;
  }
  const room = el.dataset?.roomNotify;
  if (room) {
    saveNotify({ roomNotify: { [room]: el.value } });
    return;
  }
  const key = el.dataset?.room;
  if (!key) return;
  const roomThemes = { ...cfg.roomThemes };
  if (el.value) roomThemes[key] = el.value;
  else delete roomThemes[key];
  saveView({ roomThemes });
  // 목록을 통째로 다시 짜면 방금 고른 select에서 초점이 튄다 — 되돌리기 버튼만 열어준다
  const reset = cfgBody.querySelector('.cfg-reset');
  if (reset) reset.disabled = !Object.keys(roomThemes).length;
});

// 별칭은 **다 치고 나서** 저장한다. input마다 저장하면 글자 하나에 스냅샷이 한 번씩 다시 와
// 입력 칸이 다시 그려지고 커서가 튄다.
cfgBody.addEventListener('change', (e) => {
  const key = e.target?.dataset?.alias;
  if (key == null) return;
  const name = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 40);
  const next = { ...cfg.roomAlias };
  if (name) next[key] = name;
  else delete next[key]; // 비우면 별칭을 뗀다 — 지우는 방법이 곧 비우는 것이다
  saveView({ roomAlias: next });
});

// 창 안의 클릭을 받는다. `?`면 캡션을 여닫고, 그 밖이면 떠 있던 캡션을 닫는다.
function handleHintClick(target) {
  const btn = target?.closest?.('.hint-btn');
  if (btn) {
    openCaption(btn);
    return true;
  }
  closeCaption();
  return false;
}

cfgBody.addEventListener('click', (e) => {
  if (handleHintClick(e.target)) return;
  if (e.target.classList?.contains('cfg-reset')) {
    saveView({ roomThemes: {} }).then(drawCfg);
    return;
  }
  // 고정·접기는 목록에 그대로 남아야 하므로(사라지면 되돌릴 자리가 없다) 표시만 갈아 끼운다
  const toggle = (list, key) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const pin = e.target.dataset?.pin;
  if (pin) {
    saveView({ pinned: toggle(cfg.pinned, pin) }).then(drawCfg);
    return;
  }
  const collapse = e.target.dataset?.collapse;
  if (collapse) {
    saveView({ collapsed: toggle(cfg.collapsed, collapse) }).then(drawCfg);
    return;
  }
  // 부모로 묶기. 방 이름이 아니라 **부모 경로**를 저장한다 — 그 아래 방이 나중에 새로 떠도
  // 같이 묶이고, 지금 없는 방까지 목록에 이름으로 남겨 두지 않아도 된다.
  const group = e.target.dataset?.group;
  if (group) {
    const on = cfg.roomGroups.some((g) => samePath(g, group));
    const next = on ? cfg.roomGroups.filter((g) => !samePath(g, group)) : [...cfg.roomGroups, group];
    saveView({ roomGroups: next }).then(drawCfg);
    return;
  }
  const action = e.target.dataset?.hotkey;
  if (action) {
    capturing = capturing === action ? null : action;
    drawCfg();
    // 다시 그리면 눌렀던 버튼이 사라진다 — 새로 그려진 같은 자리에 초점을 돌려준다
    cfgBody.querySelector(`[data-hotkey="${action}"]`)?.focus();
  }
});

// ── 출근부
//
// 근태 기록은 main이 파일로 들고 있다(main/history.mjs). 스냅샷처럼 밀려 오지 않으므로
// 창을 열 때 한 번 받아 오고, 범위 전환은 이미 받은 집계를 갈아 끼우기만 한다.
let attData = null;
let attRange = 'today';

// 근태는 분 단위로 읽는 게 자연스럽다 — 초까지 적으면 표가 시끄러워진다.
// fmtDur이 곧 그 셈법이다(분 아래를 접는다).
const fmtSpan = fmtDur;

// 0인 칸은 흐리게 — 숫자가 있는 칸만 눈에 들어오게
function cell(ms, cls = '') {
  return `<td class="${[cls, ms ? '' : 'z'].filter(Boolean).join(' ')}">${fmtSpan(ms)}</td>`;
}

function attSummary(s) {
  return `
    <dl class="facts">
      <div><dt>${t('att.sessions')}</dt><dd>${t('att.sessionsValue', { n: s.sessions })}</dd></div>
      <div><dt>${t('att.busy')}</dt><dd>${fmtSpan(s.busyMs)}</dd></div>
      <div><dt>${t('att.waitMine')}</dt><dd>${fmtSpan(s.waitMs)}</dd></div>
      <div><dt>${t('att.ctxMax')}</dt><dd>${s.maxCtx == null ? '—' : `${s.maxCtx}%`}</dd></div>
    </dl>`;
}

// 내가 시킨 것. 출근부의 다른 숫자는 다 "게가 뭘 했나"인데 이것만 내 쪽이다.
//
// 출처가 다르다는 것을 밝혀야 한다 — 이 값은 우리 근태 파일이 아니라 Claude Code가 남기는
// 프롬프트 이력에서 그때그때 센 것이라 **앱이 꺼져 있던 동안도 셈에 들어간다.** 같은 표에
// 섞으면 "앱이 돌던 동안만 기록된다"는 다른 숫자들의 단서와 어긋난다.
const MINE_ROOMS = 6;

function attMine(mine) {
  if (!mine) return '';
  const shown = mine.rooms.slice(0, MINE_ROOMS);
  // 제목을 안 붙인다 — 탭이 이미 "내가 시킨 것"이라고 말한다(#97).
  return `<section class="block">
    <dl class="facts">
      <div><dt>${t('att.minePrompts')}</dt><dd>${t('att.minePromptsValue', { n: mine.count })}</dd></div>
      <div><dt>${t('att.mineRooms')}</dt><dd>${t('att.mineRoomsValue', { n: mine.rooms.length })}</dd></div>
    </dl>
    ${
      shown.length
        ? `<ul class="att-mine">${shown
            .map((r) => `<li><span title="${esc(r.room)}">${esc(r.room)}</span><b>${r.count}</b></li>`)
            .join('')}</ul>`
        : `<p class="dim">${t('att.mineEmpty')}</p>`
    }
  </section>`;
}

// 7일 추이. 출근부의 숫자는 "오늘 21분"처럼 한 점이라, 나아지고 있는지는 일곱 개를 눈으로
// 비교해야 알 수 있었다.
//
// **앱을 안 켠 날과 0인 날을 다르게 그린다.** 안 켠 날을 0으로 그리면 "그날은 아무도 안
// 기다렸다"는 거짓말이 된다 — 빈 날은 막대 대신 점선 바닥만 남긴다.
function attTrend(trend) {
  if (!trend?.length) return '';
  const max = Math.max(...trend.map((d) => d.waitMs), 1);
  return `<section class="block">
    <h3>${t('att.trend')}${hintBtn('att.trendHint', { max: fmtSpan(max) })}</h3>
    <ul class="spark trend">${trend
      .map((d) =>
        d.observed
          ? `<li title="${fmtDay(d.at)} · ${fmtSpan(d.waitMs)}"><i data-pct="${Math.round(
              (d.waitMs / max) * 100,
            )}"></i></li>`
          : `<li class="unseen" title="${fmtDay(d.at)} · ${t('att.trendUnseen')}"><i data-pct="0"></i></li>`,
      )
      .join('')}</ul>
    <ul class="spark-axis">${trend.map((d) => `<li>${fmtDay(d.at)}</li>`).join('')}</ul>
  </section>`;
}

// Claude Code 자신의 집계(main/stats.mjs). 출근부의 다른 숫자와 **출처가 다르다** —
// 우리가 센 것이 아니라 Claude Code가 스스로 계산해 둔 것이고, 그래서 앱이 꺼져 있던 날도 들어 있다.
//
// 접어 둔다(`<details>`). 출근부의 본론은 "내가 얼마나 기다리게 했나"인데 이건 참고 자료라
// 펼쳐 두면 본론을 밀어낸다. 설정 창의 설명을 `?`로 접은 것과 같은 판단이다.
//
// 막대는 최대값 기준 상대 높이다. 절대 수치는 축이 없으면 못 읽으므로 숫자를 함께 적는다.
function attCodeStats(c) {
  if (!c?.days?.length) return '';
  const maxMsg = Math.max(...c.days.map((d) => d.messages), 1);
  const maxHour = Math.max(...c.hours, 1);
  const busiest = c.days.reduce((a, d) => (d.messages > a.messages ? d : a), c.days[0]);
  const peakHour = c.hours.indexOf(maxHour);
  // 보이는 자리에는 **무엇인가**를 적는다 — 어디까지의 기록인지. "왜 그런가"(통계 화면을 열 때만
  // 다시 계산된다)는 `?`로 접는다. 처음에는 그 설명이 첫 줄이었는데, 정작 알고 싶은 것이
  // 문장 속에 묻혀 있었다.
  return `<section class="att-code">
    <h3>${t('att.code')}${hintBtn('att.codeHint')}</h3>
    <dl class="facts">
      <div class="wide">
        <dt>${t('att.codeRange')}</dt>
        <dd>${esc(c.firstDate ?? '—')} ~ ${esc(c.computedTo ?? '—')}${
          c.staleDays ? ` <b class="lv-mid">${t('att.codeMissing', { n: c.staleDays })}</b>` : ''
        }</dd>
      </div>
    </dl>
    <dl class="facts">
      <div><dt>${t('att.codeSessions')}</dt><dd>${t('att.sessionsValue', { n: c.totalSessions })}</dd></div>
      <div><dt>${t('att.codeMessages')}</dt><dd>${c.totalMessages.toLocaleString()}</dd></div>
      <div><dt>${t('att.codeLongest')}</dt><dd>${c.longestSessionMs ? fmtSpan(c.longestSessionMs) : '—'}</dd></div>
      <div><dt>${t('att.codePeak')}</dt><dd>${t('att.codePeakValue', { h: peakHour })}</dd></div>
    </dl>
    <h4>${t('att.codeDays', { n: c.days.length })}</h4>
    <ul class="spark">${c.days
      .map(
        (d) =>
          `<li title="${esc(d.date)} · ${d.messages}"><i data-pct="${Math.round(
            (d.messages / maxMsg) * 100,
          )}"></i></li>`,
      )
      .join('')}</ul>
    <p class="hint">${t('att.codeBusiest', { date: busiest.date, n: busiest.messages })}</p>
    <h4>${t('att.codeHours')}</h4>
    <ul class="spark hours">${c.hours
      .map(
        (n, h) =>
          `<li title="${h}${t('att.codeHourSuffix')} · ${n}"><i data-pct="${Math.round((n / maxHour) * 100)}"></i></li>`,
      )
      .join('')}</ul>
    ${
      c.models.length
        ? `<h4>${t('att.codeModels')}</h4>
           <ul class="att-mine">${c.models
             .map((m) => `<li><span title="${esc(m.model)}">${esc(m.model)}</span><b>${fmtTokens(m.tokens)}</b></li>`)
             .join('')}</ul>`
        : ''
    }
  </section>`;
}

function attRooms(s) {
  if (!s.rooms.length) return `<p class="dim">${t('att.empty')}</p>`;
  return `<table class="att-rooms">
    <thead><tr><th>${t('att.room')}</th><th>${t('att.thSessions')}</th><th>${t('att.thBusy')}</th><th>${t(
      'att.thWait',
    )}</th><th>${t('att.thIdle')}</th></tr></thead>
    <tbody>
      ${s.rooms
        .map(
          (r) => `<tr>
            <td title="${esc(r.room)}">${esc(r.room)}</td>
            <td>${r.sessions}</td>
            ${cell(r.busyMs)}
            ${cell(r.waitMs, 'w')}
            ${cell(r.idleMs)}
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

function attWaits(s) {
  if (!s.waits.length) return '';
  return `<section class="block">
    <h3>${t('att.waits')}</h3>
    <ul class="att-waits">
      ${s.waits
        .map(
          (w) => `<li><b>${fmtSpan(w.ms)}</b><span>${esc(w.room)}</span><time>${fmtTime(w.at)}</time></li>`,
        )
        .join('')}
    </ul>
  </section>`;
}

// ── 구간 고르기. **탭이 아니다** — 탭은 "무엇을 보나"이고 이건 "언제"다.
//
// 처음에 탭과 같은 모양의 버튼 두 개를 탭 바 아래 줄에 뒀는데, 굽어 보니 **두 줄이 똑같이
// 생겨 무엇이 탭인지 알 수 없었다.** 그래서 둘을 갈랐다 —
//  - 이어붙인 토글(`.att-range-pick`)로 만들어 "한 컨트롤의 두 상태"로 보이게 하고
//  - 구간을 적는 문장과 **한 줄에** 놓아 그 줄이 "언제"에 관한 줄임을 스스로 밝히게 한다
//
// 쓰는 탭이 둘(근태·내가 시킨 것)이라 판마다 그리지만 상태는 하나다.
function rangeRow(s) {
  return `<div class="att-range-row">
    <div class="att-range-pick">
      <button type="button" data-range="today" class="btn btn-toggle${attRange === 'today' ? ' on' : ''}">${t('att.today')}</button>
      <button type="button" data-range="week" class="btn btn-toggle${attRange === 'week' ? ' on' : ''}">${t('att.week')}</button>
    </div>
    ${
      s
        ? `<span class="att-range">${t('att.range', {
            from: fmtDay(s.from),
            to: fmtDay(s.to),
            time: fmtTime(s.to),
          })}</span>`
        : ''
    }
  </div>`;
}

// 근태 — 이 화면의 본론. 요약·방별 표·오래 기다리게 한 순간.
// 기록 안내는 여기 있는 숫자에만 걸리는 단서라 이 판에 둔다.
function attPane() {
  const s = attRange === 'week' ? attData.week : attData.today;
  return `
    ${rangeRow(s)}
    ${attSummary(s)}
    <section class="block">
      <h3>${t('att.byRoom')}</h3>
      ${attRooms(s)}
    </section>
    ${attWaits(s)}
    ${
      // **기록이 꺼져 있다는 경고는 접지 않는다.** 설명이 아니라 "지금 아무것도 안 쌓이고 있다"는
      // 상태고, 접으면 모르고 지나간다.
      attData.on ? '' : `<p class="hint warn">${t('att.offHint')}</p>`
    }
  `;
}

// 추이는 7일 고정이라 구간 토글이 뜻이 없다 — 안 그린다.
function trendPane() {
  return attTrend(attData.trend) || `<p class="dim">${t('att.empty')}</p>`;
}

function minePane() {
  return `
    ${rangeRow(attRange === 'week' ? attData.week : attData.today)}
    ${attMine(attRange === 'week' ? attData.mine?.week : attData.mine?.today) || `<p class="dim">${t('att.empty')}</p>`}
  `;
}

// Claude Code 자체 집계는 기간이 제 것이라(28일) 구간 토글이 없다.
function codePane() {
  return attCodeStats(attData.code) || `<p class="dim">${t('att.empty')}</p>`;
}

const ATT_TABS = [
  ['att', attPane],
  ['trend', trendPane],
  ['mine', minePane],
  ['code', codePane],
];
// 창을 닫았다 열면 보던 탭이 그대로다. 앱을 껐다 켜면 처음으로 — 저장까지 할 값은 아니다.
let attTab = 'att';

function drawAtt() {
  closeCaption();
  if (!attData) {
    attTabsEl.innerHTML = '';
    attBody.innerHTML = `<p class="dim">${t('att.loadFailed')}</p>`;
    return;
  }
  const pane = ATT_TABS.find(([k]) => k === attTab) ?? ATT_TABS[0];
  const TAB_HINT = { att: 'att.attHint', mine: 'att.mineHint' };
  attTabsEl.innerHTML =
    ATT_TABS.map(
      ([k]) => `<button type="button" role="tab" aria-selected="${k === pane[0]}"
      class="btn btn-toggle${k === pane[0] ? ' on' : ''}" data-att-tab="${k}">${t(`att.tab.${k}`)}</button>`,
    ).join('') +
    (TAB_HINT[pane[0]] ? hintBtn(TAB_HINT[pane[0]], { days: attData.retainDays }) : '');
  attBody.innerHTML = pane[1]();
  // 막대 폭은 CSSOM으로 넣는다 — 판을 갈아 끼울 때마다 다시 불러야 한다
  paintSparks();
}

// 출근부는 열 때마다 main에서 집계를 받아 온다(스냅샷과 달리 밀려 오지 않는다).
async function openAttTab() {
  attBody.innerHTML = `<p class="dim">${t('att.loading')}</p>`;
  setPanelTab('att');
  attData = await window.office?.history?.().catch(() => null);
  drawAtt();
}

// ── 방 거르기
filterEl.addEventListener('input', () => {
  roomFilter = filterEl.value;
  refresh();
});

// 배지를 누르면 걸러 놓은 것과 접어 둔 것을 한꺼번에 푼다 — 빠져나오는 길은 한 번에 닿아야 한다
shownBtn.addEventListener('click', () => {
  roomFilter = '';
  filterEl.value = '';
  if (cfg.collapsed.length) saveView({ collapsed: [] }).then(drawCfg);
  else refresh();
});

// ── 미니 모드 여닫기. 창을 갈아 끼우는 일이라 main이 한다(별도 창이다).
document.getElementById('mini-open').addEventListener('click', () => window.office?.setMini?.(true));
document.getElementById('mini-grow').addEventListener('click', () => window.office?.setMini?.(false));

document.getElementById('att-open').addEventListener('click', openAttTab);

// 캡션은 눌린 버튼 자리에 고정돼 있으므로, 그 자리가 움직이면 닫는다 —
// 판이 스크롤될 때, 창 크기가 바뀔 때. (탭을 옮길 때는 setPanelTab이 닫는다.)
for (const el of [cfgBody, attBody]) el.addEventListener('scroll', closeCaption, { passive: true });
window.addEventListener('resize', closeCaption);
attTabsEl.addEventListener('click', (e) => {
  if (handleHintClick(e.target)) return;
  const tab = e.target?.dataset?.attTab;
  if (!tab || tab === attTab) return;
  attTab = tab;
  drawAtt();
});

attBody.addEventListener('click', (e) => {
  if (handleHintClick(e.target)) return;
  const range = e.target?.dataset?.range;
  if (!range || range === attRange) return;
  attRange = range;
  drawAtt();
});

// ── 도움말 (우측 하단 물음표)
//
// 말풍선 범례는 한 번 읽으면 되는 안내라 기본 화면 자리를 차지할 이유가 없다.
// 내용은 index.html에 고정으로 두고 여기서 여닫기만 한다.
const helpBtn = document.getElementById('help-open');
const helpBox = document.getElementById('help');

function setHelp(open) {
  helpBox.hidden = !open;
  helpBtn.setAttribute('aria-expanded', String(open));
  helpBtn.classList.toggle('on', open);
}

helpBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setHelp(helpBox.hidden);
});
// 바깥을 누르거나 Esc로 닫는다 — 캡션처럼 잠깐 보는 것이라 계속 떠 있을 이유가 없다
document.addEventListener('click', (e) => {
  if (!helpBox.hidden && !helpBox.contains(e.target)) setHelp(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !helpBox.hidden) setHelp(false);
});

// ── 언어
//
// 실제로 쓰는 언어는 main이 정한다(설정값 + OS 로케일). 여기는 받아서 이 프로세스의
// 사전을 세우고, 이미 그려 둔 것을 다시 짜기만 한다 — 재시작을 요구할 이유가 없다.
//
// langPref는 설정 창의 select가 보여줄 값(`auto` | `en` | `ko`)이고, 실제 언어는 i18n이 들고 있다.
let langPref = 'auto';

// index.html에 박아 둔 고정 문구를 채운다. data-i18n은 글자, data-i18n-title은 title 속성.
// 뼈대를 HTML에 두고 문구만 여기서 넣으면 언어를 바꿀 때 이 함수만 다시 부르면 된다.
// ── 아이콘. **글자가 아니라 도형이다.**
//
// 전에는 `▭ ▣ ▤ ▥ ⊞ ◧ ◨ ❗`를 글자로 찍었다. 그런데 Pretendard에는 그 글자들이 없어서
// 글자별로 대체 폰트를 찾아 내려갔고, 사람마다 다른 모양(가끔 색까지 다른 기호 폰트)이 나왔다.
// 사무실 픽셀 폰트를 뒤에 세워 막아 두었지만(#112) 그건 폰트 대체에 기대는 구조였다.
//
// 도형으로 그리면 폰트에 안 매이고, 크기·색을 토큰으로 다룰 수 있다(stroke가 currentColor라
// 버튼 색이 그대로 온다). 12×12 격자에 1px 선 — 픽셀 사무실과 같은 결이다.
const ICONS = {
  // 작은 창으로 / 큰 창으로
  win: '<rect x="1.5" y="2.5" width="9" height="7" rx="1"/>',
  winFull:
    '<rect x="1.5" y="2.5" width="9" height="7" rx="1"/><rect x="3.5" y="4.5" width="5" height="3" fill="currentColor" stroke="none"/>',
  // 왼쪽·오른쪽 열 접기. 채워진 띠가 그 열이다.
  paneL:
    '<rect x="1.5" y="1.5" width="9" height="9" rx="1"/><path d="M5 1.5v9" /><rect x="1.5" y="1.5" width="3.5" height="9" fill="currentColor" stroke="none"/>',
  paneR:
    '<rect x="1.5" y="1.5" width="9" height="9" rx="1"/><path d="M7 1.5v9" /><rect x="7" y="1.5" width="3.5" height="9" fill="currentColor" stroke="none"/>',
  // 방 고정
  pin: '<path d="M6 1.6 7.36 4.5 10.5 4.94 8.25 7.2 8.8 10.3 6 8.83 3.2 10.3 3.75 7.2 1.5 4.94 4.64 4.5Z"/>',
  pinOn:
    '<path d="M6 1.6 7.36 4.5 10.5 4.94 8.25 7.2 8.8 10.3 6 8.83 3.2 10.3 3.75 7.2 1.5 4.94 4.64 4.5Z" fill="currentColor"/>',
  // 방 접기 — 펼쳐진 것은 줄이 보이고, 접힌 것은 한 줄로 눌린다
  fold: '<rect x="1.5" y="1.5" width="9" height="9" rx="1"/><path d="M1.5 4.5h9M1.5 7.5h9"/>',
  foldOn: '<rect x="1.5" y="4.5" width="9" height="3" rx="1" fill="currentColor" stroke="none"/>',
  // 부모로 묶기
  group: '<rect x="1.5" y="1.5" width="9" height="9" rx="1"/><path d="M6 3.6v4.8M3.6 6h4.8"/>',
  // 나를 기다린다
  bang: '<circle cx="6" cy="6" r="4.5"/><path d="M6 3.7v2.9"/><circle cx="6" cy="8.6" r="0.7" fill="currentColor" stroke="none"/>',
};

function icon(name) {
  const d = ICONS[name];
  if (!d) return '';
  return `<svg class="ico" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round">${d}</svg>`;
}

function applyStaticText() {
  // 뼈대에 박혀 있는 아이콘(미니 모드·열 접기)을 채운다. 사전과 달리 언어를 안 타지만
  // 같은 자리에서 같이 도는 편이 잊히지 않는다.
  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
}

function applyLang(payload) {
  if (!payload) return;
  if (payload.pref) langPref = payload.pref;
  setLang(payload.lang);
  // 줄바꿈·글꼴 선택이 여기에 달려 있다
  document.documentElement.lang = getLang();
  applyStaticText();
  refresh();
  drawPanelTabs();
  if (panelTab === 'cfg') drawCfg();
  if (panelTab === 'att') drawAtt();
}

// ── main 프로세스에서 오는 스냅샷
function refresh() {
  buildAliases();
  // **applyPanes가 relayout보다 먼저다.** 접힘이 폭을 바꾸므로, 먼저 반영하지 않으면
  // 캔버스가 옛 폭으로 줄을 나눈다.
  applyPanes();
  applyPanelTab();
  relayout();
  drawStats();
  drawRail();
  drawPanel();
  if (panelTab === 'cfg' && cfgRooms !== roomSig()) drawCfg();
}

function applyState(next) {
  if (!next) return;
  state = next;
  if (selected && !findWorker(selected)) selected = null;
  refresh();
}

function connect() {
  if (!window.office) {
    // preload를 거치지 않고 열렸다는 뜻 — 브라우저로 직접 연 경우
    panel.innerHTML = `<div class="empty"><p>${t('idle.notElectron')}</p></div>`;
    return;
  }
  window.office.onState(applyState);
  // 알림을 눌러 들어온 경우 해당 자리를 펼쳐준다
  window.office.onSelect((key) => selectKey(key));
  // 트레이 메뉴에서 언어를 바꾼 경우 — 설정 창을 거치지 않고도 화면이 따라와야 한다
  window.office.onLang?.(applyLang);
  window.office.meta().then((m) => {
    meta = m;
    // 언어가 스냅샷보다 먼저 정해져야 첫 화면이 두 번 그려지지 않는다
    applyLang(m);
    if (!selected) drawPanel();
  });
  window.office
    .getView?.()
    .then((v) => {
      cfg = normalizeView(v);
      refresh();
    })
    .catch(() => {
      /* 설정을 못 읽으면 기본값(이름 그대로 · 자동 배정)으로 돈다 */
    });
  window.office.getState().then(applyState);
}

setInterval(() => {
  clockEl.textContent = fmtClock();
  tickPanel();
  tickRail();
  // 분이 넘어갈 때만 다시 그린다 — 매초 innerHTML을 갈면 상단바 텍스트 선택이 계속 풀린다
  if (longestWaitMin() !== shownWaitMin) drawStats();
}, 1000);

window.addEventListener('resize', () => {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  relayout();
});

// 캔버스는 DOM 텍스트가 아니라서 @font-face 선언만으로는 폰트가 로드되지 않는다.
// (그대로 두면 fillText가 조용히 대체 폰트로 그린다.) 직접 불러오고, 폭 캐시를 비운다.
document.fonts
  ?.load(`${OFFICE_FONT_PX}px ${OFFICE_FONT_FAMILY}`)
  .then(clearTextCache)
  .catch(() => {
    /* 폰트 파일이 없으면 대체 폰트로 그린다 */
  });

// 콘솔에서 상태를 밀어넣어 보는 용도 — 실제 세션에 없는 상태(입력 대기·실패)를 확인할 때 쓴다.
window.__office = {
  get state() {
    return state;
  },
  // 지금 그려진 배치 — 방 사각형(논리 좌표)과 배율. README 캡처를 방에 딱 맞게 자르려면
  // 방이 화면 어디에 있는지 알아야 하고, 그 답은 여기밖에 없다.
  // (`view`는 아래에 이미 있다 — 표시 설정을 바꾸는 쪽이라 이름을 겹치게 둘 수 없다.)
  get layout() {
    return {
      scale,
      baseScale,
      // 사무실을 놓은 자리 — 끌어 옮긴 결과를 헤드리스로 확인할 때 본다
      pan: { x: panX, y: panY },
      width: view.width,
      height: view.height,
      boxes: view.boxes.map((b) => ({ key: b.room.key, x: b.x, y: b.y, w: b.w, h: b.h })),
    };
  },
  push(next) {
    state = next;
    refresh();
  },
  select(key) {
    selectKey(key);
  },
  // 표시 설정을 저장 없이 바꿔 본다 — 헤드리스로 화면을 굽어 확인할 때 쓴다
  view(patch) {
    cfg = normalizeView({ ...cfg, ...patch });
    refresh();
  },
  // 언어도 저장 없이 바꿔 본다. main을 거치지 않으므로 'auto'는 여기서 뜻이 없다 —
  // 콕 집은 언어만 받는다.
  lang(next) {
    applyLang({ lang: next, pref: next });
  },
  // 배율을 콕 집는다(Ctrl+휠과 같은 길). null이면 창 폭에 맡기는 자동으로 돌아간다 —
  // 헤드리스로 확대·축소 화면을 굽어 볼 때 쓴다(휠 이벤트를 흉내 낼 필요가 없다).
  zoom(next) {
    zoomScale = next == null ? null : Math.min(SCALES.at(-1), Math.max(SCALES[0], next));
    relayout();
  },
};

// 미니 창인지에 따라 상단바·패널이 접힌다 — 첫 그림 전에 세워야 레이아웃이 한 번에 잡힌다
document.body.classList.toggle('mini', MINI);
// 패널 탭도 첫 그림 전에 세운다 — 비어 있는 탭 바가 한 프레임이라도 보이지 않게
applyPanelTab();

// 첫 그림은 기본 언어(en)로 나가고, meta가 오면 설정된 언어로 다시 짠다 —
// IPC를 기다리는 동안 빈 화면을 보여주지 않기 위해서다.
applyStaticText();
buildAliases();
relayout();
drawPanel();
connect();
requestAnimationFrame(frame);
