// 근태 기록 (main/history.mjs). 구간을 재생해 시간을 누적하는 로직이라 실기기로는 확인할 수
// 없다 — 하루를 기다려야 한다. 이벤트를 손으로 만들어 집계가 맞는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffEvents, bootEvent, summarize, dayStart } from '../main/history.mjs';
import { setLang } from '../shared/i18n.mjs';

const T0 = Date.parse('2026-07-31T09:00:00Z');
const MIN = 60_000;

function snap(workers) {
  return { rooms: [{ key: 'room', workers }] };
}

function worker(key, mood, room = 'proj-a', ctx = null) {
  return { key, room, mood, context: ctx == null ? null : { pct: ctx } };
}

function summ(events, fromOffset = -60 * MIN, toOffset = 60 * MIN) {
  return summarize(events, { from: T0 + fromOffset, to: T0 + toOffset });
}

test('세션이 나타나고 사라지는 것을 이벤트로 남긴다', () => {
  const on = diffEvents(null, snap([worker('a', 'idle')]), T0);
  assert.deepEqual(on, [{ at: T0, ev: 'on', key: 'a', room: 'proj-a', mood: 'idle', ctx: undefined }]);

  const same = diffEvents(snap([worker('a', 'idle')]), snap([worker('a', 'idle')]), T0);
  assert.deepEqual(same, [], '바뀐 게 없으면 아무것도 남기지 않는다');

  const moved = diffEvents(snap([worker('a', 'idle')]), snap([worker('a', 'typing')]), T0);
  assert.deepEqual(moved, [{ at: T0, ev: 'mood', key: 'a', room: 'proj-a', mood: 'typing', ctx: undefined }]);

  const off = diffEvents(snap([worker('a', 'typing')]), snap([]), T0);
  assert.deepEqual(off, [{ at: T0, ev: 'off', key: 'a', room: 'proj-a', ctx: undefined }]);
});

test('컨텍스트는 있을 때만 싣는다 (줄이 짧아야 한다)', () => {
  const withCtx = diffEvents(null, snap([worker('a', 'typing', 'proj-a', 72)]), T0);
  assert.equal(withCtx[0].ctx, 72);
  assert.equal(JSON.stringify(diffEvents(null, snap([worker('a', 'typing')]), T0)[0]).includes('ctx'), false);
});

test('작업·대기·유휴 시간을 방별로 나눠 센다', () => {
  const events = [
    { at: T0, ev: 'on', key: 'a', room: 'proj-a', mood: 'typing' },
    { at: T0 + 10 * MIN, ev: 'mood', key: 'a', room: 'proj-a', mood: 'waiting' },
    { at: T0 + 13 * MIN, ev: 'mood', key: 'a', room: 'proj-a', mood: 'typing' },
    { at: T0 + 20 * MIN, ev: 'off', key: 'a', room: 'proj-a' },
  ];
  const s = summ(events);
  assert.equal(s.sessions, 1);
  assert.equal(s.busyMs, 17 * MIN, '10분 + 7분');
  assert.equal(s.waitMs, 3 * MIN);
  assert.equal(s.rooms.length, 1);
  assert.deepEqual(s.rooms[0], { room: 'proj-a', sessions: 1, busyMs: 17 * MIN, waitMs: 3 * MIN, idleMs: 0 });
});

test('done·failed·stopped는 유휴로 접는다 — 일하는 것도 나를 기다리는 것도 아니다', () => {
  for (const mood of ['done', 'failed', 'stopped', 'idle']) {
    const s = summ([
      { at: T0, ev: 'on', key: 'a', room: 'r', mood },
      { at: T0 + 5 * MIN, ev: 'off', key: 'a', room: 'r' },
    ]);
    assert.equal(s.idleMs, 5 * MIN, mood);
    assert.equal(s.busyMs, 0, mood);
    assert.equal(s.waitMs, 0, mood);
  }
});

test('아직 안 끝난 구간은 구간 끝까지 이어진 것으로 본다', () => {
  const s = summ([{ at: T0, ev: 'on', key: 'a', room: 'r', mood: 'waiting' }], -60 * MIN, 30 * MIN);
  assert.equal(s.waitMs, 30 * MIN);
});

test('구간 밖은 세지 않고, 걸친 구간은 겹치는 만큼만 센다', () => {
  const events = [
    { at: T0 - 50 * MIN, ev: 'on', key: 'a', room: 'r', mood: 'typing' },
    { at: T0 + 50 * MIN, ev: 'off', key: 'a', room: 'r' },
  ];
  // 창을 T0 ~ T0+10분으로 좁히면 그 10분만 잡힌다
  const s = summarize(events, { from: T0, to: T0 + 10 * MIN });
  assert.equal(s.busyMs, 10 * MIN);

  // 구간과 아예 겹치지 않으면 방 목록에도 안 뜬다
  const none = summarize(events, { from: T0 + 100 * MIN, to: T0 + 200 * MIN });
  assert.equal(none.sessions, 0);
  assert.deepEqual(none.rooms, []);
});

test('앱이 꺼져 있던 동안은 세지 않는다 (boot에서 열린 구간을 끊는다)', () => {
  const events = [
    { at: T0, ev: 'on', key: 'a', room: 'r', mood: 'typing' },
    // 여기서 앱이 죽었다 — off가 없다
    bootEvent(T0 + 5 * MIN),
    { at: T0 + 5 * MIN, ev: 'on', key: 'a', room: 'r', mood: 'typing' },
    { at: T0 + 8 * MIN, ev: 'off', key: 'a', room: 'r' },
  ];
  const s = summ(events);
  // 0~5분 + 5~8분 = 8분. boot가 없었다면 첫 구간이 다음 on까지 이어져 이중 계산됐을 것이다.
  assert.equal(s.busyMs, 8 * MIN);
  assert.equal(s.sessions, 1);
});

test('오래 기다리게 한 순간을 긴 것부터 모은다 — 잘린 길이가 아니라 실제 길이로', () => {
  const events = [
    { at: T0, ev: 'on', key: 'a', room: 'proj-a', mood: 'waiting' },
    { at: T0 + 4 * MIN, ev: 'mood', key: 'a', room: 'proj-a', mood: 'typing' },
    { at: T0 + 5 * MIN, ev: 'on', key: 'b', room: 'proj-b', mood: 'waiting' },
    { at: T0 + 25 * MIN, ev: 'mood', key: 'b', room: 'proj-b', mood: 'typing' },
  ];
  const s = summ(events);
  assert.equal(s.waits.length, 2);
  assert.deepEqual(
    s.waits.map((w) => [w.room, w.ms / MIN]),
    [
      ['proj-b', 20],
      ['proj-a', 4],
    ],
  );
  assert.equal(s.waitMs, 24 * MIN);
});

test('바로 답한 대기는 목록에서 빼지만 총 대기 시간에는 넣는다', () => {
  const events = [
    { at: T0, ev: 'on', key: 'a', room: 'r', mood: 'waiting' },
    { at: T0 + 20_000, ev: 'mood', key: 'a', room: 'r', mood: 'typing' }, // 20초 — 정상 문답
    { at: T0 + 30_000, ev: 'mood', key: 'a', room: 'r', mood: 'waiting' },
    { at: T0 + 5 * MIN, ev: 'mood', key: 'a', room: 'r', mood: 'typing' }, // 4분 30초 — 방치
  ];
  const s = summ(events);
  assert.equal(s.waits.length, 1, '20초짜리는 목록에 없다');
  assert.equal(s.waits[0].ms, 4 * MIN + 30_000);
  assert.equal(s.waitMs, 4 * MIN + 50_000, '총합에는 20초도 들어간다');
});

test('여러 방·여러 세션을 각자 센다', () => {
  const events = [
    { at: T0, ev: 'on', key: 'a', room: 'proj-a', mood: 'typing', ctx: 30 },
    { at: T0, ev: 'on', key: 'b', room: 'proj-a', mood: 'waiting' },
    { at: T0, ev: 'on', key: 'c', room: 'proj-b', mood: 'typing', ctx: 91 },
    { at: T0 + 10 * MIN, ev: 'off', key: 'a', room: 'proj-a' },
    { at: T0 + 10 * MIN, ev: 'off', key: 'b', room: 'proj-a' },
    { at: T0 + 10 * MIN, ev: 'off', key: 'c', room: 'proj-b' },
  ];
  const s = summ(events);
  assert.equal(s.sessions, 3);
  assert.equal(s.maxCtx, 91);
  const a = s.rooms.find((r) => r.room === 'proj-a');
  assert.deepEqual(a, { room: 'proj-a', sessions: 2, busyMs: 10 * MIN, waitMs: 10 * MIN, idleMs: 0 });
  // 정렬은 작업+대기가 긴 방부터
  assert.equal(s.rooms[0].room, 'proj-a');
});

test('이벤트 순서가 섞여 들어와도 시간순으로 재생한다', () => {
  const events = [
    { at: T0 + 10 * MIN, ev: 'off', key: 'a', room: 'r' },
    { at: T0, ev: 'on', key: 'a', room: 'r', mood: 'typing' },
  ];
  assert.equal(summ(events).busyMs, 10 * MIN);
});

test('방 이름이 없으면 알 수 없음으로 모은다', () => {
  const events = [
    { at: T0, ev: 'on', key: 'a', room: '', mood: 'typing' },
    { at: T0 + 3 * MIN, ev: 'off', key: 'a', room: '' },
  ];
  // 문구는 집계할 때 붙는다 — 기록 파일에는 남지 않으므로 지난 기록도 지금 언어로 읽힌다
  setLang('ko');
  assert.equal(summ(events).rooms[0].room, '(알 수 없음)');
  setLang('en');
  assert.equal(summ(events).rooms[0].room, '(unknown)');
});

test('dayStart는 로컬 자정 — 아침에 어제가 되면 안 된다', () => {
  const now = new Date(2026, 6, 31, 7, 30, 0).getTime(); // 로컬 7시 30분
  const start = dayStart(now);
  const d = new Date(start);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), 31);
  // 6일 전
  const week = new Date(dayStart(now, 6));
  assert.equal(week.getDate(), 25);
  assert.equal(week.getHours(), 0);
});
