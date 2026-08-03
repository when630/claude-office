// 무엇을 알릴지 정하는 곳 — Electron을 모른다.
//
// 문턱을 넘었는지 판정하는 일은 시간에 달려 있어서 실기기로 확인하기가 어렵다(30분짜리 대기를
// 만들어 놓고 기다려야 한다). 그래서 판정은 여기서 순수 함수로 하고, index.mjs는 결과를 받아
// 띄우기만 한다. `now`를 인자로 받는 이유도 그것이다.
//
// 알림 종류를 껐더라도 상태는 전진시킨다 — 걸러내는 일은 부르는 쪽(설정)에 맡긴다.
// 여기서 걸러 버리면 꺼둔 동안 넘긴 문턱이 켜는 순간 한꺼번에 터진다.
//
// 문구는 shared/i18n.mjs에서 온다. 언어는 모듈이 들고 있으므로 판정 함수의 인자가 늘지 않는다 —
// 테스트에서 언어를 바꿔 보려면 setLang()을 먼저 부르면 된다.
import { t, fmtDur, fmtTokens } from '../shared/i18n.mjs';

// 대기를 한 번 알리고 끝내면 그 토스트를 놓친 순간(회의 중·전체화면·다른 가상 데스크톱)
// 앱이 영원히 조용해진다 — 30분 방치된 세션과 방금 뜬 프롬프트가 똑같이 취급된다.
export const WAIT_STEPS_MS = [5, 15, 30, 60].map((m) => m * 60_000);
// 첫 재알림 문턱을 넘기면 트레이 아이콘도 깜빡인다. 토스트는 스쳐 지나가지만 트레이는 남는다.
export const BLINK_AFTER_MS = WAIT_STEPS_MS[0];
// 컨텍스트가 차면 자동 압축이 돌면서 세션의 기억이 잘린다 — 그 전에 알아채야 한다.
export const CONTEXT_STEPS = [85, 95];
export const USAGE_STEPS = [80, 95];
// 일한 시간이 이만큼은 돼야 완료를 알린다. 터미널 세션은 한 턴이 끝날 때마다 자리로 돌아오므로
// 문턱이 없으면 문답 한 번에 한 번씩 부르게 되고, 그러면 알림이 곧 소음이 된다 —
// 자리를 뜰 만한 길이였을 때만 부른다.
export const DONE_MIN_BUSY_MS = 3 * 60_000;

// 방별 알림 세기. 회사 repo는 1분만 기다려도 부르고 싶고, 잠깐 띄운 실험용 폴더는 아예
// 안 불러도 된다 — 종류로만 끄고 켜서는 그 구분이 안 된다.
//
// 세 단계로 못 박는다. 단계를 늘리면 문턱 표가 곧 아무도 못 읽는 것이 된다.
export const ROOM_LEVELS = ['off', 'normal', 'keen'];
const KEEN_STEPS_MS = [1, 3, 10, 30].map((m) => m * 60_000);

export function levelOf(rooms, room) {
  const v = rooms?.[room];
  return ROOM_LEVELS.includes(v) ? v : 'normal';
}

// 저장할 것은 기본값에서 벗어난 방뿐이다 — 'normal'까지 적어 두면 방을 한 번 열어 본 것만으로
// 설정 파일이 불어난다(방 종류의 '자동'과 같은 규칙).
export function sanitizeRoomNotify(v) {
  const out = {};
  if (v && typeof v === 'object') {
    for (const [key, level] of Object.entries(v)) {
      if (key && ROOM_LEVELS.includes(level) && level !== 'normal') out[key] = level;
    }
  }
  return out;
}

const USAGE_LABEL = { session: 'notify.usageSession', week: 'notify.usageWeek' };

export const NOTIFY_KINDS = ['waiting', 'escalate', 'context', 'usage', 'done', 'stuck'];

// 종류별 기본값. 완료·헤맴은 꺼진 채로 온다.
//  - 완료는 원래 "끝난 세션마다 알리면 시끄럽다"는 이유로 없던 기능이다
//  - 헤맴은 판정에 오탐이 섞일 수 있는 자리라(긴 빌드는 정상적으로 조용하다) 켜 보고
//    쓸 만한지 사람이 정하게 둔다
const NOTIFY_DEFAULTS = {
  waiting: true,
  escalate: true,
  context: true,
  usage: true,
  done: false,
  stuck: false,
};

// 알림 종류별 on/off. 예전 설정은 notify가 boolean 하나였다.
//  - `false`는 "내가 껐다"는 뜻이므로 아는 종류를 전부 끈 채로 편다
//  - `true`는 그때의 기본 상태였을 뿐이다 — 기본값으로 펴서 그 시절에 없던 종류까지 켜 주지 않는다
// 인자 없이 부르면 기본값이 나온다.
export function sanitizeNotify(v) {
  if (v === false) return Object.fromEntries(NOTIFY_KINDS.map((k) => [k, false]));
  const out = { ...NOTIFY_DEFAULTS };
  if (v && typeof v === 'object') {
    for (const k of NOTIFY_KINDS) if (typeof v[k] === 'boolean') out[k] = v[k];
  }
  return out;
}

// ── 소리
//
// 놓치지 않게 하는 것이 이 앱의 본론인데 수단이 토스트와 트레이 깜빡임뿐이었다 —
// 전체화면으로 다른 일을 하고 있으면 둘 다 안 보인다.
//
// **재알림에는 소리를 내지 않는다.** 5·15·30·60분마다 소리가 나면 그건 고문이고, 사람은
// 알림을 통째로 꺼 버리고 다시 안 켠다 — 방해금지를 넣은 것과 같은 이유다. 그래서 첫 부름
// (`waiting`)에는 내고 재알림(`escalate`)에는 내지 않는다.
//
// 방해금지와 방별 세기는 저절로 걸린다. 조용한 동안에는 토스트 자체가 안 뜨고(index.mjs),
// 끈 방의 알림은 판정 끝에서 걸러진다(decideNotifications) — 없는 토스트는 소리도 안 낸다.
const SOUND_SILENT_KINDS = ['escalate'];

// 이 종류에 소리를 낼까. Electron의 Notification은 `silent`로 **끄는** 쪽을 받으므로
// 부르는 쪽에서 뒤집어 쓴다.
export function soundFor(kind, on) {
  return Boolean(on) && !SOUND_SILENT_KINDS.includes(kind);
}

// ── 방해금지
//
// 재알림이 5·15·30·60분에 계속 오고 5분을 넘기면 트레이가 깜빡인다. 회의 중이든 새벽이든
// 똑같이 때리면 사람은 알림을 **통째로 꺼 버리고 다시 안 켠다** — 그러면 이 앱이 내세우는
// 것이 통째로 무너진다. 시끄러운 시간을 따로 다룰 수 있어야 알림이 살아남는다.
//
// 참는 것은 **토스트뿐이다.** 트레이 점·깜빡임·상단바 카운트는 그대로 둔다(부르는 쪽 책임) —
// 조용히 하는 것이지 놓치게 하는 것이 아니다.
const QUIET_DEFAULTS = { hours: false, from: '22:00', to: '09:00', until: 0 };
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// 'HH:MM' → 자정부터의 분. 모르는 꼴이면 null이다.
export function minutesOf(hhmm) {
  const m = HHMM.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function sanitizeQuiet(v) {
  const time = (s, fallback) => (minutesOf(s) == null ? fallback : String(s));
  return {
    hours: v?.hours === true,
    from: time(v?.from, QUIET_DEFAULTS.from),
    to: time(v?.to, QUIET_DEFAULTS.to),
    // 임시 무음의 만료 시각. 지난 값은 흘려보낸다 — 앱을 다시 켤 때 옛날 무음이 살아나지 않는다
    until: Number.isFinite(v?.until) && v.until > 0 ? v.until : 0,
  };
}

// 지금이 조용한 시간대인가. 22:00–09:00처럼 **자정을 넘는 구간이 오히려 흔하므로**
// 분으로 펴서 두 갈래로 본다. from === to는 빈 구간으로 친다 — 24시간 무음은 알림을
// 끄는 것과 같아서 여기서 표현할 일이 아니다.
export function inQuietHours(q, now = Date.now()) {
  if (!q?.hours) return false;
  const from = minutesOf(q.from);
  const to = minutesOf(q.to);
  if (from == null || to == null || from === to) return false;
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  return from < to ? m >= from && m < to : m >= from || m < to;
}

// 지금 토스트를 참아야 하는가.
export function isQuiet(q, now = Date.now()) {
  return now < (q?.until ?? 0) || inQuietHours(q, now);
}

// 로컬 자정. "오늘 하루 조용히"의 끝이다.
export function midnightAfter(now = Date.now()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function createNotifyState() {
  return {
    // key → { at, step } — at은 statusAt(기다리기 시작한 시각), step은 지금까지 넘긴 문턱 수
    waiting: new Map(),
    context: new Map(), // key → 마지막으로 알린 컨텍스트 문턱
    usage: { session: 0, week: 0 },
    // key → { mood, since } — 마지막으로 본 기분과 그 기분이 된 시각(완료 판정용)
    mood: new Map(),
    // 첫 스냅샷을 지났는지. 앱을 막 켠 순간엔 이미 벌어져 있던 일까지 쏟아내지 않는다.
    primed: false,
  };
}

// 값이 넘어선 문턱의 개수. 오름차순 배열을 전제한다.
function stepOf(steps, value) {
  let n = 0;
  while (n < steps.length && value >= steps[n]) n++;
  return n;
}

export function* everyWorker(snapshot) {
  for (const room of snapshot?.rooms ?? []) for (const w of room.workers ?? []) yield w;
}

// mood가 'waiting'인 동안 statusAt은 갱신되지 않는다(실측) — 곧 기다리기 시작한 시각이다.
function waitedOf(w, now) {
  return w.statusAt ? Math.max(0, now - w.statusAt) : 0;
}

export function longestWait(snapshot, now = Date.now()) {
  let worst = 0;
  for (const w of everyWorker(snapshot)) {
    if (w.mood === 'waiting') worst = Math.max(worst, waitedOf(w, now));
  }
  return worst;
}

// 터미널 세션은 무엇을 묻는지 알 수 없다(선택지는 답하기 전엔 대화 파일에 안 남는다)
function needsText(w) {
  return w.needs || t(w.kind === 'bg' ? 'notify.needsBg' : 'notify.needsTerminal');
}

function decideWaiting(state, snapshot, now, first, out, rooms) {
  const waiting = new Map();
  for (const w of everyWorker(snapshot)) if (w.mood === 'waiting') waiting.set(w.key, w);

  // 답을 받았거나 사라진 놈은 잊는다 — 다음에 또 물어보면 처음부터 센다
  for (const key of [...state.waiting.keys()]) if (!waiting.has(key)) state.waiting.delete(key);

  for (const [key, w] of waiting) {
    const waited = waitedOf(w, now);
    // 민감한 방은 재알림을 앞당긴다. 세기를 바꾸면 넘긴 문턱 수의 뜻도 달라져 그 순간 한 번
    // 튈 수 있는데, 자주 만지는 값이 아니고 방향도 "더 부른다" 쪽이라 그대로 둔다.
    const steps = levelOf(rooms, w.room) === 'keen' ? KEEN_STEPS_MS : WAIT_STEPS_MS;
    const step = stepOf(steps, waited);
    const prev = state.waiting.get(key);

    // 켠 순간에 이미 대기 중이던 것도 방치 시간은 이어서 세야 하므로 넘긴 문턱을 채워 넣는다 —
    // 켜자마자 20분짜리 대기에 5·15분 알림이 몰려 뜨면 그게 더 시끄럽다.
    if (first) {
      state.waiting.set(key, { at: w.statusAt, step });
      continue;
    }

    // 처음 보는 놈, 또는 답한 뒤 다시 물어본 놈(그때 statusAt이 갱신된다)
    if (!prev || prev.at !== w.statusAt) {
      state.waiting.set(key, { at: w.statusAt, step });
      out.push({
        kind: 'waiting',
        key,
        room: w.room,
        title: t('notify.waitingTitle', { name: w.name }),
        body: needsText(w),
      });
      continue;
    }

    if (step <= prev.step) continue;
    state.waiting.set(key, { at: prev.at, step });
    out.push({
      kind: 'escalate',
      key,
      room: w.room,
      title: t('notify.escalateTitle', { name: w.name, d: fmtDur(waited) }),
      body: needsText(w),
    });
  }
}

// 헤매기 시작한 자리. 들어선 순간 한 번만 부른다 — 계속 헤매는 동안 반복해 부르면
// 그게 곧 소음이고, 어차피 사무실에서는 계속 그 모습으로 보인다.
//
// state.mood를 읽기만 한다. 갱신은 뒤따르는 decideDone이 하므로 여기서는 **직전 기분**이
// 그대로 남아 있다 — 그래서 "처음 보는 자리인가"와 "방금 들어섰는가"를 가릴 수 있다.
function decideStuck(state, snapshot, out) {
  for (const w of everyWorker(snapshot)) {
    if (w.mood !== 'stuck') continue;
    const prev = state.mood.get(w.key);
    if (!prev || prev.mood === 'stuck') continue;
    out.push({
      kind: 'stuck',
      key: w.key,
      room: w.room,
      title: t('notify.stuckTitle', { name: w.name }),
      body: w.detail || t('notify.stuckBody'),
    });
  }
}

// 일을 마친 자리. 백그라운드 잡은 state.json에 done·failed·stopped를 남기지만 터미널 세션은
// 그런 파일이 없어 **끝나면 그냥 idle로 돌아온다**(main/collect.mjs의 moodOf) — 그래서 idle도
// '끝났다'로 본다. 대신 얼마나 일했는지를 보고 짧은 문답은 걸러낸다.
const DONE_TITLE = {
  done: 'notify.doneTitle',
  idle: 'notify.doneTitle',
  failed: 'notify.failedTitle',
  stopped: 'notify.stoppedTitle',
};

function decideDone(state, snapshot, now, first, out) {
  const live = new Set();
  for (const w of everyWorker(snapshot)) {
    live.add(w.key);
    const prev = state.mood.get(w.key);
    if (prev?.mood === w.mood) continue;
    // 일을 시작한 시각은 statusAt이 들고 있다 — 같은 status로 머무는 동안엔 갱신되지 않으므로
    // 앱을 켜기 전부터 일하고 있었어도 맞는 값이다.
    state.mood.set(w.key, { mood: w.mood, since: w.statusAt ?? now });
    // 첫 스냅샷과 처음 보는 자리는 어디서 왔는지 모른다 — 기억만 하고 넘어간다
    if (first || !prev) continue;
    // 부르는 것은 **일하다 끝난 자리**뿐이다. 대기에서 풀린 것은 방금 사람이 답했다는 뜻이고,
    // 유휴에서 유휴로 도는 것은 애초에 일한 적이 없다.
    if (prev.mood !== 'typing') continue;
    const title = DONE_TITLE[w.mood];
    if (!title) continue;
    const busy = Math.max(0, now - prev.since);
    if (busy < DONE_MIN_BUSY_MS) continue;
    out.push({
      kind: 'done',
      key: w.key,
      room: w.room,
      title: t(title, { name: w.name }),
      // 얼마나 걸렸는지가 먼저다. 마지막 상황을 알면 뒤에 붙여 무슨 일이었는지도 보여준다
      body: [t('notify.doneBody', { d: fmtDur(busy) }), w.detail].filter(Boolean).join(' · '),
    });
  }
  for (const key of [...state.mood.keys()]) if (!live.has(key)) state.mood.delete(key);
}

// 컨텍스트는 게이지 색으로만 경고한다(85% 빨강) — 창을 보고 있어야 알 수 있다.
// 자동 압축이 돌아 세션의 기억이 잘리기 전에 손쓸 기회를 주려면 불러야 한다.
function decideContext(state, snapshot, first, out) {
  const live = new Set();
  for (const w of everyWorker(snapshot)) {
    const pct = w.context?.pct;
    if (pct == null) continue;
    live.add(w.key);
    const step = stepOf(CONTEXT_STEPS, pct);
    const prev = state.context.get(w.key) ?? 0;
    // 압축이 돌면 pct가 뚝 떨어진다 — 문턱 아래로 내려가면 그만큼 다시 무장된다
    state.context.set(w.key, step);
    if (first || step <= prev) continue;
    out.push({
      kind: 'context',
      key: w.key,
      room: w.room,
      title: t('notify.contextTitle', { name: w.name, pct }),
      body: t('notify.contextBody', {
        used: fmtTokens(w.context.tokens),
        limit: fmtTokens(w.context.limit),
      }),
    });
  }
  for (const key of [...state.context.keys()]) if (!live.has(key)) state.context.delete(key);
}

// 계정 사용량은 statusline tap이 붙어 있을 때만 들어온다(main/usage-tap.mjs).
// 초기화 시각이 지나면 pct가 떨어지므로 문턱은 저절로 다시 무장된다.
function decideUsage(state, usage, now, first, out) {
  // 오래된 값으로 겁주지 않는다 — statusline이 안 돌고 있으면 지금 사용률이 아니다
  if (usage?.stale) return;
  for (const kind of ['session', 'week']) {
    const pct = usage?.[kind]?.pct;
    if (pct == null) {
      state.usage[kind] = 0;
      continue;
    }
    const step = stepOf(USAGE_STEPS, pct);
    const prev = state.usage[kind];
    state.usage[kind] = step;
    if (first || step <= prev) continue;
    const resetsAt = usage[kind].resetsAt;
    const resets = resetsAt ? t('notify.usageResets', { d: fmtDur(resetsAt - now) }) : '';
    // key가 없으면 부르는 쪽이 창만 띄운다 — 특정 세션의 일이 아니다
    out.push({
      kind: 'usage',
      title: t('notify.usageTitle', { label: t(USAGE_LABEL[kind]), pct }),
      body: t('notify.usageBody', { resets }),
    });
  }
}

// 이번 스냅샷에서 띄워야 할 알림 목록. [{ kind, key?, room?, title, body }]
//
// `rooms`는 방별 알림 세기(방 이름 → 'off' | 'keen')다. 알림을 끈 방의 것은 **판정을 다 돌린
// 뒤** 마지막에 덜어낸다 — 중간에 빼면 문턱 상태가 어긋나서, 다시 켜는 순간 그 동안 넘긴
// 문턱이 한꺼번에 터진다(종류별 on/off와 같은 규칙).
export function decideNotifications(state, snapshot, now = Date.now(), rooms = null) {
  const out = [];
  const first = !state.primed;
  state.primed = true;
  decideWaiting(state, snapshot, now, first, out, rooms);
  // 순서가 뜻이 있다 — decideStuck은 decideDone이 갱신하기 전의 기분을 읽는다
  if (!first) decideStuck(state, snapshot, out);
  decideDone(state, snapshot, now, first, out);
  decideContext(state, snapshot, first, out);
  decideUsage(state, snapshot?.usage, now, first, out);
  // 계정 사용량처럼 방이 없는 알림은 그대로 지나간다 — 어느 방의 일도 아니다
  return out.filter((o) => o.room == null || levelOf(rooms, o.room) !== 'off');
}
