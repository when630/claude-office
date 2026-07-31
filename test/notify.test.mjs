// 알림 문턱 판정 (main/notify.mjs). 실기기로는 30분짜리 대기를 만들어 놓고 기다려야 하는
// 로직이라 여기서 시각을 손으로 밀어 확인한다.
//
// 문구는 언어에 딸려 있으므로(shared/i18n.mjs) 여기서 언어를 못 박는다 — 그러지 않으면
// 돌리는 사람의 OS 로케일에 따라 단정이 갈린다.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifyState, decideNotifications, longestWait, sanitizeNotify } from '../main/notify.mjs';
import { fmtDur, setLang } from '../shared/i18n.mjs';

const T0 = Date.parse('2026-07-31T09:00:00Z');
const MIN = 60_000;

function snap(workers, usage = null) {
  return { ts: T0, rooms: [{ key: 'room', label: 'room', cwd: '/room', workers }], recent: [], stats: {}, usage };
}

function waiter(key, statusAt, extra = {}) {
  return { key, name: key, mood: 'waiting', kind: 'interactive', statusAt, needs: null, context: null, ...extra };
}

function ctxWorker(key, pct) {
  return {
    key,
    name: key,
    mood: 'typing',
    kind: 'interactive',
    statusAt: null,
    context: { pct, tokens: pct * 10_000, limit: 1_000_000 },
  };
}

// 새 state는 첫 스냅샷을 조용히 흘려보낸다 — 빈 사무실로 한 번 먹여 그 몫을 태운다.
function primed() {
  const state = createNotifyState();
  decideNotifications(state, snap([]), T0);
  return state;
}

function kinds(out) {
  return out.map((o) => o.kind);
}

// 문턱 판정을 보는 테스트는 한국어 문구로 확인한다. 언어를 갈아 끼우는 테스트가 아래에 따로 있다.
beforeEach(() => setLang('ko'));

test('앱을 막 켠 첫 스냅샷은 조용하다 — 이미 벌어져 있던 일을 쏟아내지 않는다', () => {
  const state = createNotifyState();
  const out = decideNotifications(state, snap([waiter('a', T0 - 20 * MIN), ctxWorker('b', 93)], { session: { pct: 91 } }), T0);
  assert.deepEqual(kinds(out), []);
});

test('켤 때 이미 20분 방치된 대기는 넘긴 문턱까지 기억한다 — 5·15분이 몰려 뜨지 않는다', () => {
  const state = createNotifyState();
  decideNotifications(state, snap([waiter('a', T0 - 20 * MIN)]), T0);
  // 20분은 5·15분을 이미 넘겼다. 다음은 30분 문턱뿐이다.
  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0 - 20 * MIN)]), T0 + MIN)), []);
  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0 - 20 * MIN)]), T0 + 10 * MIN)), ['escalate']);
});

test('새 대기는 한 번 알리고, 문턱을 넘을 때마다 다시 부른다', () => {
  const state = primed();
  const first = decideNotifications(state, snap([waiter('a', T0)]), T0 + 1000);
  assert.deepEqual(kinds(first), ['waiting']);
  assert.match(first[0].title, /기다립니다/);
  assert.equal(first[0].key, 'a');

  // 문턱 전에는 조용하다
  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0)]), T0 + 4 * MIN)), []);

  const five = decideNotifications(state, snap([waiter('a', T0)]), T0 + 5 * MIN);
  assert.deepEqual(kinds(five), ['escalate']);
  assert.match(five[0].title, /5분째/);

  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0)]), T0 + 14 * MIN)), []);
  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0)]), T0 + 15 * MIN)), ['escalate']);
  // 마지막 문턱(60분)을 지나면 더 부르지 않는다
  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0)]), T0 + 60 * MIN)), ['escalate']);
  assert.deepEqual(kinds(decideNotifications(state, snap([waiter('a', T0)]), T0 + 200 * MIN)), []);
});

test('답한 뒤 다시 물어보면 새 대기로 센다 (statusAt이 갱신된다)', () => {
  const state = primed();
  decideNotifications(state, snap([waiter('a', T0)]), T0);
  decideNotifications(state, snap([waiter('a', T0)]), T0 + 5 * MIN);
  // 답을 하면 waiting에서 빠진다
  assert.deepEqual(kinds(decideNotifications(state, snap([]), T0 + 6 * MIN)), []);
  // 다시 물어보면 처음부터
  const again = decideNotifications(state, snap([waiter('a', T0 + 7 * MIN)]), T0 + 7 * MIN);
  assert.deepEqual(kinds(again), ['waiting']);
});

test('대기 중에 statusAt이 바뀌면(답하고 곧바로 다시 물어봄) 새 대기로 센다', () => {
  const state = primed();
  decideNotifications(state, snap([waiter('a', T0)]), T0);
  const out = decideNotifications(state, snap([waiter('a', T0 + 3 * MIN)]), T0 + 3 * MIN);
  assert.deepEqual(kinds(out), ['waiting']);
});

test('무엇을 기다리는지 알면 그 문구를, 모르면 종류별 기본 문구를 쓴다', () => {
  const state = primed();
  const out = decideNotifications(
    state,
    snap([waiter('a', T0, { needs: '플랜 승인이 필요합니다' }), waiter('b', T0, { kind: 'bg' })]),
    T0,
  );
  assert.equal(out.find((o) => o.key === 'a').body, '플랜 승인이 필요합니다');
  assert.equal(out.find((o) => o.key === 'b').body, '입력이 필요합니다');
});

test('컨텍스트는 문턱을 넘을 때만, 압축으로 떨어지면 다시 무장된다', () => {
  const state = primed();
  assert.deepEqual(kinds(decideNotifications(state, snap([ctxWorker('a', 84)]), T0)), []);
  const hit = decideNotifications(state, snap([ctxWorker('a', 86)]), T0);
  assert.deepEqual(kinds(hit), ['context']);
  assert.match(hit[0].title, /86%/);
  // 같은 문턱 안에서는 조용
  assert.deepEqual(kinds(decideNotifications(state, snap([ctxWorker('a', 90)]), T0)), []);
  assert.deepEqual(kinds(decideNotifications(state, snap([ctxWorker('a', 96)]), T0)), ['context']);
  // 자동 압축이 돌아 뚝 떨어졌다
  assert.deepEqual(kinds(decideNotifications(state, snap([ctxWorker('a', 30)]), T0)), []);
  assert.deepEqual(kinds(decideNotifications(state, snap([ctxWorker('a', 87)]), T0)), ['context']);
});

test('사용량은 문턱을 넘을 때 부르고, 오래된 값으로는 겁주지 않는다', () => {
  const state = primed();
  const stale = decideNotifications(state, snap([], { stale: true, session: { pct: 99 }, week: { pct: 99 } }), T0);
  assert.deepEqual(kinds(stale), []);

  const hit = decideNotifications(state, snap([], { session: { pct: 81, resetsAt: T0 + 90 * MIN }, week: { pct: 40 } }), T0);
  assert.deepEqual(kinds(hit), ['usage']);
  assert.match(hit[0].title, /세션 사용량/);
  assert.match(hit[0].body, /1시간 30분 뒤 초기화/);
  // 주인이 없는 알림이라 key가 없다 — 부르는 쪽이 창만 띄운다
  assert.equal(hit[0].key, undefined);

  assert.deepEqual(kinds(decideNotifications(state, snap([], { session: { pct: 90 }, week: { pct: 40 } }), T0)), []);
  assert.deepEqual(
    kinds(decideNotifications(state, snap([], { session: { pct: 96 }, week: { pct: 82 } }), T0)),
    ['usage', 'usage'],
  );
});

test('longestWait은 대기 중인 놈만 본다', () => {
  const s = snap([waiter('a', T0 - 3 * MIN), waiter('b', T0 - 11 * MIN), ctxWorker('c', 50)]);
  assert.equal(longestWait(s, T0), 11 * MIN);
  assert.equal(longestWait(snap([ctxWorker('c', 50)]), T0), 0);
  // statusAt이 없으면 얼마나 기다렸는지 알 수 없다 — 0으로 둔다
  assert.equal(longestWait(snap([waiter('a', null)]), T0), 0);
});

test('예전 설정에서 알림을 껐던 사람은 껐던 상태로 남는다', () => {
  assert.deepEqual(sanitizeNotify(false), { waiting: false, escalate: false, context: false, usage: false });
  assert.deepEqual(sanitizeNotify(true), { waiting: true, escalate: true, context: true, usage: true });
  // 기본값은 전부 켜짐
  assert.deepEqual(sanitizeNotify(), { waiting: true, escalate: true, context: true, usage: true });
  // 손으로 고친 settings.json — 모르는 키와 엉뚱한 타입은 버리고 아는 것만 받는다
  assert.deepEqual(sanitizeNotify({ escalate: false, nope: true, context: 'yes' }), {
    waiting: true,
    escalate: false,
    context: true,
    usage: true,
  });
  assert.deepEqual(sanitizeNotify(null), { waiting: true, escalate: true, context: true, usage: true });
});

test('fmtDur', () => {
  assert.equal(fmtDur(0), '0분');
  assert.equal(fmtDur(5 * MIN), '5분');
  assert.equal(fmtDur(60 * MIN), '1시간');
  assert.equal(fmtDur(95 * MIN), '1시간 35분');
  assert.equal(fmtDur(-5000), '0분');

  setLang('en');
  assert.equal(fmtDur(0), '0m');
  assert.equal(fmtDur(5 * MIN), '5m');
  assert.equal(fmtDur(60 * MIN), '1h');
  assert.equal(fmtDur(95 * MIN), '1h 35m');
});

// 판정은 언어를 타지 않고 문구만 갈린다 — 언어를 바꿔도 같은 순간에 같은 종류가 나와야 한다.
test('언어를 바꾸면 알림 문구가 바뀌고 판정은 그대로다', () => {
  const args = [snap([waiter('a', T0, { kind: 'bg' })]), T0];

  setLang('ko');
  const ko = decideNotifications(primed(), ...args);
  assert.deepEqual(kinds(ko), ['waiting']);
  assert.match(ko[0].title, /기다립니다/);
  assert.equal(ko[0].body, '입력이 필요합니다');

  setLang('en');
  const en = decideNotifications(primed(), ...args);
  assert.deepEqual(kinds(en), ['waiting']);
  assert.match(en[0].title, /is waiting/);
  assert.equal(en[0].body, 'Needs your input');
});

test('사용량 문구도 언어를 따라간다', () => {
  const usage = { session: { pct: 81, resetsAt: T0 + 90 * MIN }, week: { pct: 40 } };

  setLang('en');
  const out = decideNotifications(primed(), snap([], usage), T0);
  assert.deepEqual(kinds(out), ['usage']);
  assert.match(out[0].title, /Session usage/);
  assert.match(out[0].body, /resets in 1h 30m/);
});
