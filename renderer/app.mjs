import { layout, render, pickAt, clearTextCache, OFFICE_FONT_PX, OFFICE_FONT_FAMILY } from './render.mjs';
import { THEMES } from './themes.mjs';

const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const panel = document.getElementById('panel');
const statsEl = document.getElementById('stats');
const clockEl = document.getElementById('clock');
const cfgDialog = document.getElementById('cfg');
const cfgBody = document.getElementById('cfg-body');

let state = { rooms: [], recent: [], stats: {}, usage: null, ts: 0 };
let meta = null;
// 표시 설정 — main의 settings.json(view)에 저장된다. 상태(state)와 달리 스냅샷마다 오지 않는다.
let cfg = { names: 'show', roomThemes: {} };
let view = { boxes: [], seats: [], width: 100, height: 100 };
let scale = 3;
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let hover = null;
let selected = null;

const MOOD_LABEL = {
  typing: '작업 중',
  waiting: '입력 대기',
  idle: '대기',
  done: '완료',
  failed: '실패',
  stopped: '정지',
};

const MODE_LABEL = {
  normal: '기본',
  plan: '플랜',
  acceptEdits: '편집 자동승인',
  bypassPermissions: '권한 우회',
  auto: '자동',
};

const NAME_MODE_LABEL = {
  show: '이름 그대로',
  mask: '가리기 (클로드 1…)',
  hide: '이름표 없음',
};

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ── 이름 가리기. 세션 이름은 작업 디렉터리·첫 지시에서 나오므로 화면을 남에게 보일 때
// 가릴 수 있어야 한다. 대체 이름은 스냅샷 순서대로 붙인 번호다 — 같은 스냅샷 안에서는
// 캔버스와 패널이 같은 이름을 부른다.
let aliases = new Map();

function buildAliases() {
  aliases = new Map();
  let n = 0;
  for (const room of state.rooms ?? []) {
    for (const w of room.workers) aliases.set(w.key, `클로드 ${++n}`);
  }
}

function aliasOf(w) {
  return aliases.get(w.key) ?? '클로드';
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

// ── 포맷
function fmtAge(ms) {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 ${m % 60}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}

// 기다린 시간. 패널은 1초마다 갱신되므로 초까지 보여준다 — 방금 뜬 프롬프트인지
// 20분째 방치된 것인지가 여기서 갈린다.
function fmtWaited(ms) {
  if (ms == null || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}초째 기다리고 있습니다`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${String(s % 60).padStart(2, '0')}초째 기다리고 있습니다`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분째 기다리고 있습니다`;
}

// 초기화까지 남은 시간 — 1초마다 갱신되므로 짧게
function fmtLeft(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return '초기화됨';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${String(s).padStart(2, '0')}초`;
  return `${s}초`;
}

function fmtTokens(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

// 컨텍스트 창 크기처럼 딱 떨어지는 수는 소수점 없이
function fmtLimit(n) {
  if (!n) return '—';
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}K`;
}

function fmtTime(iso) {
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 초기화 시각. epoch(ms)를 로컬 시간대로 그린다 — 주간 초기화는 이틀 뒤라
// 시각만 적으면 "04:00"이 오늘인지 모레인지 알 수 없어 날짜를 붙인다.
function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(+d)) return '';
  const time = fmtTime(ms);
  return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
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
    <h3>퇴근한 작업</h3>
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
        label: '세션 (5시간)',
        pct: u.session?.pct ?? null,
        right: u.session?.resetsAt ? `${fmtWhen(u.session.resetsAt)} 초기화` : '',
        note: '',
        id: 'u-session-left',
      })}
      ${gauge({
        label: '주간 (7일)',
        pct: u.week?.pct ?? null,
        right: u.week?.resetsAt ? `${fmtWhen(u.week.resetsAt)} 초기화` : '',
        note: '',
        id: 'u-week-left',
      })}
      <dl class="facts">
        <div><dt>모델</dt><dd>${esc(u.model ?? '—')}</dd></div>
        <div><dt>컨텍스트</dt><dd>${fmtLimit(u.contextWindow)}</dd></div>
        <div><dt>추론 강도</dt><dd>${esc(u.effort ?? '—')}</dd></div>
        <div><dt>Fast</dt><dd>${u.fastMode ? '켜짐' : '꺼짐'}</dd></div>
      </dl>
      <p class="hint${u.stale ? ' warn' : ''}">사용량 갱신 ${fmtAge(Date.now() - u.at)} 전${
        u.stale ? ' · statusline이 안 돌고 있는 듯합니다' : ''
      }</p>`
    : `<p class="dim">세션·주간 사용률은 Claude Code가 <b>statusline</b>에만 넘겨주는 값입니다.
        statusline이 받은 payload를 <code>~/.claude/office-usage.json</code>으로 떨어뜨려 두면
        여기에 표시됩니다.</p>
       <p class="hint"><b>트레이 아이콘 &gt; 사용량 연동</b>을 켜면 자동으로 심어줍니다.</p>`;

  return `
    <div class="now">
      <div class="now-time" id="p-clock">--:--:--</div>
      <div class="now-date" id="p-date"></div>
    </div>

    <section class="block">
      <h3>사무실</h3>
      <dl class="facts">
        <div><dt>출근</dt><dd>${s.total ?? 0}명</dd></div>
        <div><dt>작업 중</dt><dd>${s.typing ?? 0}</dd></div>
        <div><dt>입력 대기</dt><dd>${s.waiting ?? 0}</dd></div>
        <div><dt>최고 컨텍스트</dt><dd>${s.contextMax == null ? '—' : `${s.contextMax}%`}</dd></div>
        <div><dt>서브에이전트</dt><dd>${s.aides ?? 0}</dd></div>
        ${s.spare ? `<div><dt>예비 슬롯</dt><dd>${s.spare}</dd></div>` : ''}
      </dl>
      ${
        s.spare
          ? `<p class="hint">예비 슬롯 ${s.spare}개는 데몬이 데워 둔 <b>빈 백그라운드 프로세스</b>입니다.
              프롬프트를 받은 적이 없어 사무실에는 그리지 않습니다.</p>`
          : ''
      }
    </section>

    <section class="block">
      <h3>계정 사용량</h3>
      ${usageBlock}
    </section>

    ${
      meta
        ? `<p class="hint">Claude Office ${esc(meta.version)} · Electron ${esc(meta.electron)}<br /><code>${esc(
            meta.claudeDir,
          )}</code></p>`
        : ''
    }

    ${recentBlock()}

    <section class="block">
      <h3>말풍선 읽는 법</h3>
      <ul class="legend">
        <li><span class="chip real"></span>세션에서 읽어온 말 — 지금 상황·최근 지시·서브에이전트 보고</li>
        <li><span class="chip idle"></span>혼잣말·잡담 — 분위기용으로 써 둔 문장</li>
      </ul>
    </section>

    <p class="hint">자리를 클릭하면 그 세션이 뭘 하고 있는지 볼 수 있습니다.</p>
  `;
}

function workerPanel(w) {
  const cmd = attachCmd(w);
  const c = w.context;
  return `
    <header class="who">
      <span class="mood ${esc(w.mood)}">${MOOD_LABEL[w.mood] ?? w.mood}</span>
      <h2>${esc(panelName(w))}</h2>
      ${w.title ? `<p class="subtitle">${esc(w.title)}</p>` : ''}
      <p class="cwd">${esc(w.cwd)}</p>
    </header>

    ${
      c
        ? gauge({
            label: '컨텍스트',
            pct: c.pct,
            right: `${fmtTokens(c.tokens)} / ${fmtLimit(c.limit)}`,
            note: esc(w.model ?? ''),
          })
        : ''
    }

    <dl class="facts">
      <div><dt>종류</dt><dd>${w.kind === 'bg' ? '백그라운드' : '터미널'}</dd></div>
      <div><dt>가동</dt><dd>${fmtAge(w.startedAt ? Date.now() - w.startedAt : null)}</dd></div>
      <div><dt>토큰</dt><dd>${fmtTokens(w.tokens)}</dd></div>
      <div><dt>PID</dt><dd>${w.pid}</dd></div>
      ${w.mode ? `<div><dt>모드</dt><dd>${esc(MODE_LABEL[w.mode] ?? w.mode)}</dd></div>` : ''}
      <div><dt>갱신</dt><dd>${fmtAge(w.updatedAt ? Date.now() - w.updatedAt : null)} 전</dd></div>
    </dl>

    ${
      w.aides?.length
        ? `<section class="block"><h3>붙어 있는 서브에이전트 ${w.aides.length}</h3><ul class="aides">${w.aides
            .map((a) => `<li><b>${esc(a.kind)}</b>${a.label ? `<span>${esc(a.label)}</span>` : ''}</li>`)
            .join('')}</ul></section>`
        : ''
    }

    ${
      // 백그라운드 잡은 무엇을 기다리는지(needs)까지 남기지만 터미널 세션은 그게 없다 —
      // 선택지가 떠 있는 동안 대화 파일에 아무것도 안 쓰이기 때문이다. 그래도 기다린다는
      // 사실만은 알려야 하므로 mood만 보고 이 블록을 띄운다.
      w.mood === 'waiting'
        ? `<section class="block need"><h3>나를 기다리는 중</h3>
            <p class="waited" id="w-waited"></p>
            <p>${esc(w.needs) || '터미널에 선택지나 확인이 떠 있습니다. 그 창으로 가서 답하면 계속합니다.'}</p>${
              w.suggestedReply ? `<p class="reply">추천 답: ${esc(w.suggestedReply)}</p>` : ''
            }</section>`
        : ''
    }
    ${w.detail ? `<section class="block"><h3>지금 상황</h3><p>${esc(w.detail)}</p></section>` : ''}
    ${w.lastPrompt ? `<section class="block"><h3>최근 지시</h3><p class="dim">${esc(w.lastPrompt)}</p></section>` : ''}
    ${w.intent ? `<section class="block"><h3>처음 지시</h3><p class="dim">${esc(w.intent)}</p></section>` : ''}
    ${
      !w.detail && !w.lastPrompt && !w.intent
        ? '<section class="block"><p class="dim">아직 남긴 기록이 없습니다. 첫 지시를 받으면 여기에 채워집니다.</p></section>'
        : ''
    }

    ${
      w.links?.length
        ? `<section class="block"><h3>연결된 MR</h3><ul class="links">${w.links
            .map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noreferrer">!${esc(l.id)}</a></li>`)
            .join('')}</ul></section>`
        : ''
    }

    ${
      w.timeline?.length
        ? `<section class="block"><h3>타임라인</h3><ol class="timeline">${w.timeline
            .slice(-6)
            .reverse()
            .map(
              (t) =>
                `<li><span class="dot ${esc(t.state)}"></span><time>${fmtTime(t.at)}</time><p>${esc(t.detail || t.state)}</p></li>`,
            )
            .join('')}</ol></section>`
        : ''
    }

    ${cmd ? `<button class="copy" data-cmd="${esc(cmd)}"><code>${esc(cmd)}</code><span>복사</span></button>` : ''}
  `;
}

function drawPanel() {
  const w = selected ? findWorker(selected) : null;
  panel.innerHTML = w ? workerPanel(w) : idlePanel();

  panel.querySelector('.copy')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    window.office.copy(btn.dataset.cmd);
    btn.classList.add('done');
    setTimeout(() => btn.classList.remove('done'), 1200);
  });
  paintBars();
  tickPanel();
}

// 1초마다 시계와 "초기화까지" 숫자만 갈아 끼운다 — 패널을 통째로 다시 그리면
// 스크롤 위치가 튀고 텍스트 선택이 풀린다.
function tickPanel() {
  const now = new Date();
  const clock = panel.querySelector('#p-clock');
  if (clock) clock.textContent = now.toLocaleTimeString('ko-KR', { hour12: false });
  const date = panel.querySelector('#p-date');
  if (date) {
    date.textContent = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. (${DAYS[now.getDay()]})`;
  }
  // 기다린 시간도 여기서만 갈아 끼운다 — statusAt이 절대 시각이라 스냅샷을 기다리지 않는다
  const waited = panel.querySelector('#w-waited');
  if (waited) {
    const w = selected ? findWorker(selected) : null;
    waited.textContent = w?.statusAt ? fmtWaited(Date.now() - w.statusAt) : '';
  }
  const u = state.usage;
  const s = panel.querySelector('#u-session-left');
  if (s) s.textContent = u?.session?.resetsAt ? `${fmtLeft(u.session.resetsAt - Date.now())} 남음` : '';
  const wk = panel.querySelector('#u-week-left');
  if (wk) wk.textContent = u?.week?.resetsAt ? `${fmtLeft(u.week.resetsAt - Date.now())} 남음` : '';
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

function drawStats() {
  const s = state.stats ?? {};
  const u = state.usage;
  const waitMin = longestWaitMin();
  statsEl.innerHTML = [
    `<b>${s.total ?? 0}</b> 출근`,
    s.typing ? `<span class="t">${s.typing}</span> 작업 중` : '',
    s.waiting ? `<span class="w">${s.waiting}</span> 입력 대기` : '',
    s.waiting && waitMin >= 1
      ? `<span class="dim">${waitMin < 60 ? `최장 ${waitMin}분` : `최장 ${Math.floor(waitMin / 60)}시간 ${waitMin % 60}분`}</span>`
      : '',
    s.failed ? `<span class="f">${s.failed}</span> 실패` : '',
    `<span class="dim">${fmtTokens(s.tokens)} tok</span>`,
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
// hasOwn으로 봐야 한다 — `in`이나 대괄호 조회는 'constructor' 같은 상속 키에 걸린다.
function normalizeView(v) {
  return {
    names: Object.hasOwn(NAME_MODE_LABEL, v?.names ?? '') ? v.names : 'show',
    roomThemes: v?.roomThemes && typeof v.roomThemes === 'object' ? { ...v.roomThemes } : {},
  };
}

function options(entries, picked) {
  return entries
    .map(([value, label]) => `<option value="${esc(value)}"${value === picked ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

function drawCfg() {
  const rooms = state.rooms ?? [];
  const picked = Object.keys(cfg.roomThemes).length;
  cfgRooms = roomSig();

  cfgBody.innerHTML = `
    <section class="block">
      <h3>클로드 이름</h3>
      <div class="cfg-row">
        <label for="cfg-names"><b>이름표</b><small>사무실 이름표와 패널 제목에 쓰는 이름</small></label>
        <select id="cfg-names">${options(Object.entries(NAME_MODE_LABEL), cfg.names)}</select>
      </div>
      <p class="hint">가리면 <code>클로드 1, 2…</code>로 부릅니다. 화면을 남에게 보일 때 쓰세요 —
        작업 디렉터리 경로는 패널에 그대로 남습니다.</p>
    </section>

    <section class="block">
      <h3>방 종류</h3>
      ${
        rooms.length
          ? rooms
              .map(
                (r, i) => `<div class="cfg-row">
                  <label for="cfg-room-${i}"><b>${esc(r.label)}</b><small>${esc(r.cwd ?? '')}</small></label>
                  <select id="cfg-room-${i}" data-room="${esc(r.key)}">${options(
                    [['', '자동'], ...THEMES.map((t) => [t.key, t.label])],
                    cfg.roomThemes[r.key] ?? '',
                  )}</select>
                </div>`,
              )
              .join('')
          : '<p class="dim">지금 떠 있는 방이 없습니다. 세션이 하나라도 붙으면 여기서 종류를 고를 수 있습니다.</p>'
      }
      <button class="cfg-reset" type="button"${picked ? '' : ' disabled'}>고른 종류 전부 자동으로</button>
      <p class="hint">자동은 방 이름 해시로 배정합니다. 고른 종류는 작업 디렉터리 이름으로 기억하니
        방이 사라졌다 다시 떠도 그대로입니다.</p>
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

document.getElementById('cfg-open').addEventListener('click', () => {
  drawCfg();
  cfgDialog.showModal();
});
document.getElementById('cfg-close').addEventListener('click', () => cfgDialog.close());

cfgBody.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'cfg-names') {
    saveView({ names: el.value });
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
    panel.innerHTML = '<div class="empty"><p>Electron 앱으로 실행해야 합니다. <code>npm start</code></p></div>';
    return;
  }
  window.office.onState(applyState);
  // 알림을 눌러 들어온 경우 해당 자리를 펼쳐준다
  window.office.onSelect((key) => {
    selected = key;
    drawPanel();
  });
  window.office.meta().then((m) => {
    meta = m;
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
  clockEl.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  tickPanel();
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
};

buildAliases();
relayout();
drawPanel();
connect();
requestAnimationFrame(frame);
