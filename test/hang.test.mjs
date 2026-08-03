// 다 같이 모이는 주기 (renderer/talk.mjs의 slotOfSeg·hangEveryAt).
//
// 점심엔 더 자주 모이게 하는 것인데, **위험한 것은 규칙이 바뀌는 순간이다.** "지금이 점심인가"로
// 판단하면 12시 경계에서 이미 걷고 있던 구간의 출발점이 함께 바뀌어 게가 방 폭만큼 튄다.
// 구간 번호에서 시각을 유도해 한 번 정해진 구간은 다시 바뀌지 않아야 한다.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { slotOfSeg, hangEveryAt, _resetSegSlots } from '../renderer/talk.mjs';

const SEG = 5200;
const NORMAL = 3;
const LUNCH = 2;
// 오늘 12시 30분(점심)과 15시(점심 아님)
const at = (h, m = 0) => new Date(2026, 6, 31, h, m, 0).getTime();

beforeEach(() => _resetSegSlots());

test('점심 구간에서는 주기가 짧아진다', () => {
  // 같은 구간 번호를 다른 시각으로 물어보려면 캐시를 비워야 한다 — 한 번 정해진 구간은
  // 다시 바뀌지 않는 것이 이 함수의 요점이고, 실제 앱에서는 시계와 tms가 같이 흘러
  // 같은 구간이 두 시각을 갖는 일이 없다. (tms=0이면 구간 0의 시각이 곧 now다)
  const every = (now) => {
    _resetSegSlots();
    return hangEveryAt(0, 0, SEG, NORMAL, LUNCH, now);
  };
  assert.equal(every(at(12, 30)), LUNCH);
  assert.equal(every(at(15)), NORMAL);
  assert.equal(every(at(3)), NORMAL);
});

test('구간 번호로 시각을 유도한다 — 뒤 구간은 그만큼 미래다', () => {
  // 11시 59분에서 시작해도 한 구간 뒤(5.2초 뒤)는 아직 11시대다
  assert.equal(slotOfSeg(0, 0, SEG, at(11, 59)), 'morning');
  // 12시를 넘긴 구간은 점심으로 잡힌다 (11:59:50 + 20구간 ≈ 12:01)
  _resetSegSlots();
  assert.equal(slotOfSeg(20, 0, SEG, at(11, 59) + 50_000), 'lunch');
});

test('한 번 정해진 구간의 시각은 다시 바뀌지 않는다', () => {
  // 이게 이 파일의 본론이다. 같은 구간을 나중에 다시 물어봐도 처음 답이 나와야 한다 —
  // 걷는 도중에 출발점이 바뀌면 그 프레임에 게가 튄다.
  const first = slotOfSeg(7, 0, SEG, at(11, 59));
  assert.equal(first, 'morning');
  // 시계가 점심으로 넘어간 뒤 같은 구간을 다시 물어본다
  assert.equal(slotOfSeg(7, 0, SEG, at(12, 30)), 'morning');
  assert.equal(hangEveryAt(7, 0, SEG, NORMAL, LUNCH, at(12, 30)), NORMAL);
});

test('tms가 흘러도 같은 구간은 같은 시각이다', () => {
  // Date.now() - tms 는 둘이 같이 흐르므로 고정된다. 프레임이 지나도 값이 흔들리면 안 된다.
  const base = at(13);
  const a = slotOfSeg(100, 0, SEG, base);
  const b = slotOfSeg(100, 3000, SEG, base + 3000); // 3초 뒤 프레임
  assert.equal(a, b);
  assert.equal(a, 'lunch');
});

test('주기가 실제로 모이는 구간 수를 바꾼다', () => {
  // 주기 3이면 세 구간마다 한 번(i % 3 === 2), 2면 두 구간마다 한 번
  const hangs = (every) => {
    let n = 0;
    for (let i = 0; i < 12; i++) if (i % every === every - 1) n++;
    return n;
  };
  assert.equal(hangs(NORMAL), 4);
  assert.equal(hangs(LUNCH), 6);
});

test('캐시가 넘쳐도 답이 흔들리지 않는다', () => {
  // 64개를 넘기면 통째로 비운다 — 비운 뒤에도 같은 구간은 같은 시각이어야 한다.
  // (Date.now() - tms 가 고정이므로 다시 계산해도 같은 값이 나온다)
  const base = at(13);
  const want = slotOfSeg(0, 0, SEG, base);
  for (let i = 0; i < 100; i++) slotOfSeg(i, 0, SEG, base);
  assert.equal(slotOfSeg(0, 0, SEG, base), want);
});
