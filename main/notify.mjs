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

const USAGE_LABEL = { session: 'notify.usageSession', week: 'notify.usageWeek' };

export const NOTIFY_KINDS = ['waiting', 'escalate', 'context', 'usage', 'done'];

// 종류별 기본값. 완료 알림만 꺼진 채로 온다 — 원래 "끝난 세션마다 알리면 시끄럽다"는 이유로
// 없던 기능이라, 켜고 싶은 사람이 켜는 쪽이 맞다.
const NOTIFY_DEFAULTS = { waiting: true, escalate: true, context: true, usage: true, done: false };

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

function decideWaiting(state, snapshot, now, first, out) {
  const waiting = new Map();
  for (const w of everyWorker(snapshot)) if (w.mood === 'waiting') waiting.set(w.key, w);

  // 답을 받았거나 사라진 놈은 잊는다 — 다음에 또 물어보면 처음부터 센다
  for (const key of [...state.waiting.keys()]) if (!waiting.has(key)) state.waiting.delete(key);

  for (const [key, w] of waiting) {
    const waited = waitedOf(w, now);
    const step = stepOf(WAIT_STEPS_MS, waited);
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
      out.push({ kind: 'waiting', key, title: t('notify.waitingTitle', { name: w.name }), body: needsText(w) });
      continue;
    }

    if (step <= prev.step) continue;
    state.waiting.set(key, { at: prev.at, step });
    out.push({
      kind: 'escalate',
      key,
      title: t('notify.escalateTitle', { name: w.name, d: fmtDur(waited) }),
      body: needsText(w),
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

// 이번 스냅샷에서 띄워야 할 알림 목록. [{ kind, key?, title, body }]
export function decideNotifications(state, snapshot, now = Date.now()) {
  const out = [];
  const first = !state.primed;
  state.primed = true;
  decideWaiting(state, snapshot, now, first, out);
  decideDone(state, snapshot, now, first, out);
  decideContext(state, snapshot, first, out);
  decideUsage(state, snapshot?.usage, now, first, out);
  return out;
}
