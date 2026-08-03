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
  fmtDateLine,
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
const miniStatsEl = document.getElementById('mini-stats');
const filterEl = document.getElementById('room-filter');
const shownBtn = document.getElementById('room-shown');
const stageEmpty = document.getElementById('stage-empty');
const cfgDialog = document.getElementById('cfg');
const cfgBody = document.getElementById('cfg-body');
const cfgTabsEl = document.getElementById('cfg-tabs');
const attDialog = document.getElementById('att');
const attBody = document.getElementById('att-body');

// 미니 모드는 **같은 페이지를 다른 창에서** 여는 것이다(main/index.mjs의 createMini).
// 프레임 유무는 창을 만들 때 정해지고 나중에 못 바꾸므로 창을 갈아 끼우는 쪽을 골랐고,
// 여기서는 그 창인지만 보고 상단바·패널을 접는다.
const MINI = new URLSearchParams(location.search).get('mini') === '1';
// 미니에 다 들어가지 않으니 방을 추린다. 기다리는 방·헤매는 방이 먼저다.
const MINI_ROOMS = 3;

let state = { rooms: [], recent: [], stats: {}, usage: null, ts: 0 };
let meta = null;
// 표시 설정 — main의 settings.json(view)에 저장된다. 상태(state)와 달리 스냅샷마다 오지 않는다.
let cfg = { names: 'show', roomThemes: {}, pinned: [], collapsed: [] };
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
  for (const el of panel.querySelectorAll('.bar i[data-pct]')) {
    el.style.width = `${el.dataset.pct}%`;
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

function relayout() {
  // clientWidth는 padding을 포함한다 — 빼지 않으면 가로 스크롤바가 생기고
  // 그게 세로 공간을 잠식해 세로 스크롤바까지 딸려 나온다
  const avail = Math.max(120, (stage.clientWidth || 800) - STAGE_PAD);
  scale = pickScale(avail);
  const logicalW = Math.max(120, Math.floor(avail / scale));
  const rooms = roomsToDraw();
  view = layout(rooms, logicalW, { themes: cfg.roomThemes, nameOf: canvasName });

  // 방이 적어도 바닥은 화면을 채운다 — 빈 캔버스가 잘려 보이지 않게
  const minH = Math.floor(((stage.clientHeight || 400) - STAGE_PAD) / scale);
  view.height = Math.max(view.height, minH);

  const cssW = view.width * scale;
  const cssH = Math.max(view.height * scale, 120);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

function frame(t) {
  render(ctx, view, { scale, dpr, t, hover, selected });
  requestAnimationFrame(frame);
}

// ── 히트 테스트. 게가 돌아다니므로 자리 사각형보다 지금 서 있는 위치가 먼저다.
function seatAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return pickAt(view, (clientX - r.left) / scale, (clientY - r.top) / scale);
}

canvas.addEventListener('mousemove', (e) => {
  const seat = seatAt(e.clientX, e.clientY);
  hover = seat?.worker.key ?? null;
  canvas.style.cursor = seat ? 'pointer' : 'default';
});
canvas.addEventListener('mouseleave', () => {
  hover = null;
});
canvas.addEventListener('click', (e) => {
  const seat = seatAt(e.clientX, e.clientY);
  // 미니에는 패널이 없다 — 자리를 누르면 큰 창으로 올라가며 그 자리가 펼쳐진다
  if (MINI) {
    if (seat) window.office?.miniSelect?.(seat.worker.key);
    return;
  }
  selected = seat?.worker.key ?? null;
  drawPanel();
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
              <b>${esc(r.name)}</b>
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

  // 버전을 패널 바닥에 붙이려면 패널이 flex 열이어야 한다. 그런데 내용을 flex item으로
  // 흩어 놓으면 블록 사이 margin 병합이 사라져 간격이 벌어진다 — 그래서 내용은 한 덩어리로
  // 싸 두고(`idle-body`) 버전만 형제로 둔다. 미는 일은 CSS의 `margin-top: auto`가 한다.
  return `
    <div class="idle-body">
    <div class="now">
      <div class="now-time" id="p-clock">--:--:--</div>
      <div class="now-date" id="p-date"></div>
    </div>

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

function workerPanel(w) {
  const cmd = attachCmd(w);
  const c = w.context;
  const u = usageOfSession(w);
  return `
    <header class="who">
      <span class="mood ${esc(w.mood)}">${esc(t(`mood.${w.mood}`))}</span>
      <h2>${esc(panelName(w))}</h2>
      ${w.title ? `<p class="subtitle">${esc(w.title)}</p>` : ''}
      <p class="cwd">${esc(w.cwd)}</p>
    </header>

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
      <div><dt>${t('panel.pid')}</dt><dd>${w.pid}</dd></div>
      ${w.mode ? `<div><dt>${t('panel.mode')}</dt><dd>${esc(t(`mode.${w.mode}`))}</dd></div>` : ''}
      <div><dt>${t('panel.updated')}</dt><dd>${fmtAgo(w.updatedAt ? Date.now() - w.updatedAt : null)}</dd></div>
    </dl>

    ${
      w.aides?.length
        ? `<section class="block"><h3>${t('panel.aides', { n: w.aides.length })}</h3><ul class="aides">${w.aides
            .map((a) => `<li><b>${esc(a.kind)}</b>${a.label ? `<span>${esc(a.label)}</span>` : ''}</li>`)
            .join('')}</ul></section>`
        : ''
    }

    ${
      // 백그라운드 잡은 무엇을 기다리는지(needs)까지 남기지만 터미널 세션은 그게 없다 —
      // 선택지가 떠 있는 동안 대화 파일에 아무것도 안 쓰이기 때문이다. 그래도 기다린다는
      // 사실만은 알려야 하므로 mood만 보고 이 블록을 띄운다.
      w.mood === 'waiting'
        ? `<section class="block need"><h3>${t('panel.needTitle')}</h3>
            <p class="waited" id="w-waited"></p>
            <p>${esc(w.needs) || t('panel.needFallback')}</p>${
              w.suggestedReply
                ? `<p class="reply">${t('panel.suggested', { reply: esc(w.suggestedReply) })}</p>`
                : ''
            }</section>`
        : ''
    }
    ${w.detail ? `<section class="block"><h3>${t('panel.detail')}</h3><p>${esc(w.detail)}</p></section>` : ''}
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

    ${
      cmd
        ? `<div class="jump">
            <button class="go" type="button">${t('panel.open')}</button>
            <button class="copy" data-cmd="${esc(cmd)}"><code>${esc(cmd)}</code><span>${t('panel.copy')}</span></button>
          </div>
          <p class="hint jump-msg" id="jump-msg"></p>`
        : ''
    }
  `;
}

// 터미널을 띄우는 일은 main이 한다(main/terminal.mjs). 여기서는 누구인지만 넘긴다 —
// 명령 문자열을 넘기면 그게 임의 명령 실행 통로가 되므로 id만 보낸다.
function wireJump() {
  const btn = panel.querySelector('.go');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const w = selected ? findWorker(selected) : null;
    const msg = panel.querySelector('#jump-msg');
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

function drawPanel() {
  const w = selected ? findWorker(selected) : null;
  // 기본 화면에서만 패널을 flex 열로 둔다 — 버전을 바닥으로 밀기 위해서다(style.css의 .version)
  panel.classList.toggle('idle', !w);
  panel.innerHTML = w ? workerPanel(w) : idlePanel();

  panel.querySelector('.copy')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
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
  wireJump();
  paintBars();
  tickPanel();
}

// 1초마다 시계와 "초기화까지" 숫자만 갈아 끼운다 — 패널을 통째로 다시 그리면
// 스크롤 위치가 튀고 텍스트 선택이 풀린다.
function tickPanel() {
  const now = Date.now();
  const clock = panel.querySelector('#p-clock');
  if (clock) clock.textContent = fmtClock(now);
  const date = panel.querySelector('#p-date');
  if (date) date.textContent = fmtDateLine(now);
  // 기다린 시간도 여기서만 갈아 끼운다 — statusAt이 절대 시각이라 스냅샷을 기다리지 않는다
  const waited = panel.querySelector('#w-waited');
  if (waited) {
    const w = selected ? findWorker(selected) : null;
    waited.textContent = w?.statusAt ? fmtWaited(Date.now() - w.statusAt) : '';
  }
  const u = state.usage;
  const s = panel.querySelector('#u-session-left');
  if (s) s.textContent = u?.session?.resetsAt ? t('usage.left', { d: fmtLeft(u.session.resetsAt - now) }) : '';
  const wk = panel.querySelector('#u-week-left');
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
function drawMiniStats() {
  const s = state.stats ?? {};
  miniStatsEl.innerHTML = [
    `<b>${s.total ?? 0}</b>`,
    s.waiting ? `<span class="w">${s.waiting}</span> ${t('topbar.waiting')}` : '',
    s.stuck ? `<span class="s">${s.stuck}</span> ${t('topbar.stuck')}` : '',
    s.failed ? `<span class="f">${s.failed}</span> ${t('topbar.failed')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
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
  // 전부 걸러졌으면 빈 캔버스 대신 이유를 적는다
  const empty = total > 0 && hidden === total;
  stageEmpty.hidden = !empty;
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
  statsEl.innerHTML = [
    `<b>${s.total ?? 0}</b> ${t('topbar.in')}`,
    s.typing ? `<span class="t">${s.typing}</span> ${t('topbar.typing')}` : '',
    s.waiting ? `<span class="w">${s.waiting}</span> ${t('topbar.waiting')}` : '',
    s.waiting && waitMin >= 1
      ? `<span class="dim">${t('topbar.longest', { d: fmtDur(waitMin * 60_000) })}</span>`
      : '',
    s.stuck ? `<span class="s">${s.stuck}</span> ${t('topbar.stuck')}` : '',
    s.failed ? `<span class="f">${s.failed}</span> ${t('topbar.failed')}` : '',
    `<span class="dim">${t('topbar.tokens', { n: fmtTokens(s.tokens) })}</span>`,
    u?.session ? `<span class="dim">5h ${u.session.pct}%</span>` : '',
    u?.week ? `<span class="dim">wk ${u.week.pct}%</span>` : '',
  ]
    .filter(Boolean)
    .join('<i>·</i>');
  document.title = s.waiting ? `(${s.waiting}) Claude Office` : 'Claude Office';
}

// ── 설정 창
//
// 방 목록은 지금 떠 있는 방에서 나오므로 열 때마다 다시 짠다. 열려 있는 동안 스냅샷이 와도
// 방 구성이 그대로면 건드리지 않는다 — 다시 그리면 펼쳐둔 목록이 닫히고 초점이 튄다.
let cfgRooms = null;

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
const openHints = new Set();

function hint(key) {
  const on = openHints.has(key);
  return `<p class="hint-line">
      <button type="button" class="hint-btn${on ? ' on' : ''}" data-hint="${esc(key)}"
        aria-expanded="${on}" title="${t('cfg.hintTitle')}">?</button>
    </p>
    <p class="hint" ${on ? '' : 'hidden'}>${t(key)}</p>`;
}

function hotkeyBlock() {
  if (!hotkeyCfg) return noIpc();
  const row = (action) => {
    const accel = hotkeyCfg.hotkeys[action] ?? '';
    const bad = accel && hotkeyCfg.failed?.includes(accel);
    const text = capturing === action ? t('cfg.hotkeyPress') : accel ? accelLabel(accel) : t('cfg.hotkeyNone');
    return `<div class="cfg-row">
      <label><b>${t(HOTKEY_LABEL[action])}</b>${bad ? `<small class="warn">${t('cfg.hotkeyTaken')}</small>` : ''}</label>
      <button type="button" class="cfg-key${capturing === action ? ' on' : ''}${bad ? ' bad' : ''}"
        data-hotkey="${esc(action)}">${esc(text)}</button>
    </div>`;
  };
  return `
    <section class="block">
      ${Object.keys(hotkeyCfg.hotkeys)
        .filter((a) => HOTKEY_LABEL[a])
        .map(row)
        .join('')}
      ${hint('cfg.hotkeyHint')}
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
      <h3>${t('cfg.quietSection')}</h3>
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
      ${hint('cfg.quietHint')}
    </section>
  `;
}

// 언어와 이름표 — 화면에 무엇이 어떤 말로 적히는지.
function generalPane() {
  return `
    <section class="block">
      <h3>${t('cfg.langSection')}</h3>
      <div class="cfg-row">
        <label for="cfg-lang"><b>${t('cfg.lang')}</b></label>
        <select id="cfg-lang">${options(
          // 언어 이름은 그 언어로 적는다 — 읽을 수 없는 언어로 적힌 항목은 고를 수가 없다
          [['auto', t('common.langAuto')], ...LANGS.map((l) => [l, LANG_NAMES[l]])],
          langPref,
        )}</select>
      </div>
      ${hint('cfg.langHint')}
    </section>

    <section class="block">
      <h3>${t('cfg.namesSection')}</h3>
      <div class="cfg-row">
        <label for="cfg-names"><b>${t('cfg.names')}</b></label>
        <select id="cfg-names">${options(
          NAME_MODES.map((m) => [m, t(`names.${m}`)]),
          cfg.names,
        )}</select>
      </div>
      ${hint('cfg.namesHint')}
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
                      <button type="button" class="cfg-mark${cfg.pinned.includes(r.key) ? ' on' : ''}"
                        data-pin="${esc(r.key)}" title="${t('cfg.roomPin')}">${cfg.pinned.includes(r.key) ? '★' : '☆'}</button>
                      <button type="button" class="cfg-mark${cfg.collapsed.includes(r.key) ? ' on' : ''}"
                        data-collapse="${esc(r.key)}" title="${t('cfg.roomCollapse')}">${
                          cfg.collapsed.includes(r.key) ? '▤' : '▥'
                        }</button>
                    </span>
                  </label>
                  <select id="cfg-room-${i}" data-room="${esc(r.key)}" aria-label="${t('cfg.roomTheme')}">${options(
                    [['', t('common.auto')], ...THEMES.map((theme) => [theme.key, theme.label])],
                    cfg.roomThemes[r.key] ?? '',
                  )}</select>
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
      <button class="cfg-reset" type="button"${picked ? '' : ' disabled'}>${t('cfg.roomsReset')}</button>
      ${hint('cfg.roomsHint')}
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
  cfgRooms = roomSig();
  const pane = CFG_TABS.find(([k]) => k === cfgTab) ?? CFG_TABS[0];

  cfgTabsEl.innerHTML = CFG_TABS.map(
    ([k]) => `<button type="button" role="tab" aria-selected="${k === pane[0]}"
      class="${k === pane[0] ? 'on' : ''}" data-cfg-tab="${k}">${t(`cfg.tab.${k}`)}</button>`,
  ).join('');
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

document.getElementById('cfg-open').addEventListener('click', async () => {
  notifyCfg = (await window.office?.getNotify?.().catch(() => null)) ?? notifyCfg;
  hotkeyCfg = (await window.office?.getHotkeys?.().catch(() => null)) ?? hotkeyCfg;
  capturing = null;
  drawCfg();
  cfgDialog.showModal();
});
document.getElementById('cfg-close').addEventListener('click', () => cfgDialog.close());

cfgTabsEl.addEventListener('click', (e) => {
  const tab = e.target?.dataset?.cfgTab;
  if (!tab || tab === cfgTab) return;
  cfgTab = tab;
  capturing = null; // 탭을 옮기면 받던 조합은 없던 일이 된다
  drawCfg();
});

// 조합을 받는 동안은 창의 다른 단축키(닫기 등)보다 먼저 가로챈다.
cfgDialog.addEventListener('keydown', (e) => {
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

cfgBody.addEventListener('click', (e) => {
  const hintKey = e.target?.dataset?.hint;
  if (hintKey) {
    // 다시 그리지 않고 그 자리에서 여닫는다 — 값은 하나도 안 바뀌었으므로
    if (openHints.has(hintKey)) openHints.delete(hintKey);
    else openHints.add(hintKey);
    const on = openHints.has(hintKey);
    e.target.classList.toggle('on', on);
    e.target.setAttribute('aria-expanded', String(on));
    const body = e.target.closest('.hint-line')?.nextElementSibling;
    if (body?.classList.contains('hint')) body.hidden = !on;
    return;
  }
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
  return `<section class="block">
    <h3>${t('att.mine')}</h3>
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
    <p class="hint">${t('att.mineHint')}</p>
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

function drawAtt() {
  if (!attData) {
    attBody.innerHTML = `<p class="dim">${t('att.loadFailed')}</p>`;
    return;
  }
  const s = attRange === 'week' ? attData.week : attData.today;
  attBody.innerHTML = `
    <div class="att-tabs">
      <button type="button" data-range="today"${attRange === 'today' ? ' class="on"' : ''}>${t('att.today')}</button>
      <button type="button" data-range="week"${attRange === 'week' ? ' class="on"' : ''}>${t('att.week')}</button>
    </div>
    <p class="att-range">${t('att.range', {
      from: fmtDay(s.from),
      to: fmtDay(s.to),
      time: fmtTime(s.to),
    })}</p>

    ${attSummary(s)}

    <section class="block">
      <h3>${t('att.byRoom')}</h3>
      ${attRooms(s)}
    </section>

    ${attWaits(s)}
    ${attMine(attRange === 'week' ? attData.mine?.week : attData.mine?.today)}

    ${
      attData.on
        ? `<p class="hint">${t('att.onHint', { days: attData.retainDays })}</p>`
        : `<p class="hint warn">${t('att.offHint')}</p>`
    }
    <p class="hint">${t('att.offlineHint')}</p>
  `;
}

async function openAtt() {
  attBody.innerHTML = `<p class="dim">${t('att.loading')}</p>`;
  attDialog.showModal();
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

document.getElementById('att-open').addEventListener('click', openAtt);
document.getElementById('att-close').addEventListener('click', () => attDialog.close());
attBody.addEventListener('click', (e) => {
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
function applyStaticText() {
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
  if (cfgDialog.open) drawCfg();
  if (attDialog.open) drawAtt();
}

// ── main 프로세스에서 오는 스냅샷
function refresh() {
  buildAliases();
  relayout();
  drawStats();
  drawPanel();
  if (cfgDialog.open && cfgRooms !== roomSig()) drawCfg();
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
  window.office.onSelect((key) => {
    selected = key;
    drawPanel();
  });
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
  push(next) {
    state = next;
    refresh();
  },
  select(key) {
    selected = key;
    drawPanel();
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
};

// 미니 창인지에 따라 상단바·패널이 접힌다 — 첫 그림 전에 세워야 레이아웃이 한 번에 잡힌다
document.body.classList.toggle('mini', MINI);

// 첫 그림은 기본 언어(en)로 나가고, meta가 오면 설정된 언어로 다시 짠다 —
// IPC를 기다리는 동안 빈 화면을 보여주지 않기 위해서다.
applyStaticText();
buildAliases();
relayout();
drawPanel();
connect();
requestAnimationFrame(frame);
