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
const cfgDialog = document.getElementById('cfg');
const cfgBody = document.getElementById('cfg-body');
const attDialog = document.getElementById('att');
const attBody = document.getElementById('att-body');

let state = { rooms: [], recent: [], stats: {}, usage: null, ts: 0 };
let meta = null;
// 표시 설정 — main의 settings.json(view)에 저장된다. 상태(state)와 달리 스냅샷마다 오지 않는다.
let cfg = { names: 'show', roomThemes: {} };
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

const STAGE_PAD = 24; // style.css의 #stage padding 12px 상하좌우

function relayout() {
  // clientWidth는 padding을 포함한다 — 빼지 않으면 가로 스크롤바가 생기고
  // 그게 세로 공간을 잠식해 세로 스크롤바까지 딸려 나온다
  const avail = Math.max(120, (stage.clientWidth || 800) - STAGE_PAD);
  scale = pickScale(avail);
  const logicalW = Math.max(120, Math.floor(avail / scale));
  const rooms = state.rooms ?? [];
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

function drawStats() {
  const s = state.stats ?? {};
  const u = state.usage;
  const waitMin = longestWaitMin();
  shownWaitMin = waitMin;
  statsEl.innerHTML = [
    `<b>${s.total ?? 0}</b> ${t('topbar.in')}`,
    s.typing ? `<span class="t">${s.typing}</span> ${t('topbar.typing')}` : '',
    s.waiting ? `<span class="w">${s.waiting}</span> ${t('topbar.waiting')}` : '',
    s.waiting && waitMin >= 1
      ? `<span class="dim">${t('topbar.longest', { d: fmtDur(waitMin * 60_000) })}</span>`
      : '',
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
  return {
    names: NAME_MODES.includes(v?.names) ? v.names : 'show',
    roomThemes: v?.roomThemes && typeof v.roomThemes === 'object' ? { ...v.roomThemes } : {},
  };
}

function options(entries, picked) {
  return entries
    .map(([value, label]) => `<option value="${esc(value)}"${value === picked ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

// 알림 섹션. 트레이 메뉴에도 같은 항목이 있지만 시각을 고르는 일은 메뉴로 못 하고,
// 종류가 다섯이라 한자리에 펼쳐 보이는 편이 켜고 끄기 쉽다.
function notifyBlock() {
  if (!notifyCfg) return '';
  const q = notifyCfg.quiet;
  const label = (k) => (k === 'done' ? t(KIND_LABEL[k], { d: fmtDur(notifyCfg.doneAfterMs) }) : t(KIND_LABEL[k]));
  return `
    <section class="block">
      <h3>${t('cfg.notifySection')}</h3>
      ${notifyCfg.kinds
        .filter((k) => KIND_LABEL[k])
        .map(
          (k) => `<label class="cfg-check">
            <input type="checkbox" data-notify="${esc(k)}"${notifyCfg.notify[k] ? ' checked' : ''}>
            <span>${esc(label(k))}</span>
          </label>`,
        )
        .join('')}
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
      <p class="hint">${t('cfg.quietHint')}</p>
    </section>
  `;
}

function drawCfg() {
  const rooms = state.rooms ?? [];
  const picked = Object.keys(cfg.roomThemes).length;
  cfgRooms = roomSig();

  cfgBody.innerHTML = `
    ${notifyBlock()}

    <section class="block">
      <h3>${t('cfg.langSection')}</h3>
      <div class="cfg-row">
        <label for="cfg-lang"><b>${t('cfg.lang')}</b><small>${t('cfg.langNote')}</small></label>
        <select id="cfg-lang">${options(
          // 언어 이름은 그 언어로 적는다 — 읽을 수 없는 언어로 적힌 항목은 고를 수가 없다
          [['auto', t('common.langAuto')], ...LANGS.map((l) => [l, LANG_NAMES[l]])],
          langPref,
        )}</select>
      </div>
      <p class="hint">${t('cfg.langHint')}</p>
    </section>

    <section class="block">
      <h3>${t('cfg.namesSection')}</h3>
      <div class="cfg-row">
        <label for="cfg-names"><b>${t('cfg.names')}</b><small>${t('cfg.namesNote')}</small></label>
        <select id="cfg-names">${options(
          NAME_MODES.map((m) => [m, t(`names.${m}`)]),
          cfg.names,
        )}</select>
      </div>
      <p class="hint">${t('cfg.namesHint')}</p>
    </section>

    <section class="block">
      <h3>${t('cfg.roomsSection')}</h3>
      ${
        rooms.length
          ? rooms
              .map(
                (r, i) => `<div class="cfg-row cfg-room">
                  <label for="cfg-room-${i}"><b>${esc(r.label)}</b><small>${esc(r.cwd ?? '')}</small></label>
                  <select id="cfg-room-${i}" data-room="${esc(r.key)}" aria-label="${t('cfg.roomsSection')}">${options(
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
      <p class="hint">${t('cfg.roomsHint')}</p>
    </section>
  `;
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
  drawCfg();
  cfgDialog.showModal();
});
document.getElementById('cfg-close').addEventListener('click', () => cfgDialog.close());

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
  if (e.target.classList?.contains('cfg-reset')) saveView({ roomThemes: {} }).then(drawCfg);
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

// 첫 그림은 기본 언어(en)로 나가고, meta가 오면 설정된 언어로 다시 짠다 —
// IPC를 기다리는 동안 빈 화면을 보여주지 않기 위해서다.
applyStaticText();
buildAliases();
relayout();
drawPanel();
connect();
requestAnimationFrame(frame);
