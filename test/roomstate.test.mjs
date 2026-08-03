// 방의 상태 — 퇴근한 방과 톤 (renderer/render.mjs의 roomDone·roomTint).
//
// 방은 마지막 세션이 사라지는 순간 화면에서 툭 없어졌다. 사라지는 것을 늦추면 layout()이
// 줄을 다시 나누는 타이밍까지 건드려 **다른 방들이 옆으로 튄다** — 그래서 사라지는 시점은
// 그대로 두고 그 전에 "끝났다"는 것만 보이게 한다. 그 판정을 여기서 붙잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
  }),
};

const { roomDone, roomTint, nightTint } = await import('../renderer/render.mjs');

const room = (...moods) => ({ workers: moods.map((mood) => ({ mood })) });

test('살아 있는 세션이 하나라도 있으면 퇴근한 방이 아니다', () => {
  assert.equal(roomDone(room('typing')), false);
  assert.equal(roomDone(room('waiting')), false);
  assert.equal(roomDone(room('stuck')), false);
  // idle도 살아 있는 것이다 — 프롬프트 앞에서 쉬는 중일 뿐 곧 다시 시킬 자리다
  assert.equal(roomDone(room('idle')), false);
  assert.equal(roomDone(room('done', 'idle')), false);
});

test('남은 세션이 전부 끝났으면 퇴근한 방이다', () => {
  assert.equal(roomDone(room('done')), true);
  assert.equal(roomDone(room('failed')), true);
  assert.equal(roomDone(room('stopped')), true);
  assert.equal(roomDone(room('done', 'failed', 'stopped')), true);
});

test('빈 방은 퇴근한 방이 아니다', () => {
  // 세션이 없는 방은 애초에 화면에 없다 — 없는 것을 어둡게 칠하지 않는다
  assert.equal(roomDone(room()), false);
  assert.equal(roomDone(null), false);
  assert.equal(roomDone(undefined), false);
});

test('퇴근한 방은 심야 조명 위에 한 번 더 어두워진다', () => {
  const day = nightTint('afternoon');
  const night = nightTint('lateNight');
  // 낮에 일하는 방은 손대지 않는다
  assert.deepEqual(roomTint(room('typing'), day), day);
  // 퇴근한 방은 더 어둡다
  assert.ok(roomTint(room('done'), day).l < day.l);
  // 심야에 퇴근한 방은 그보다 더 어둡다 — 두 배율이 곱해진다
  assert.ok(roomTint(room('done'), night).l < roomTint(room('done'), day).l);
  // 채도는 심야 값을 그대로 쓴다 — 방 색 구분을 지키는 몫이다
  assert.equal(roomTint(room('done'), night).s, night.s);
});

// ── 바닥에 흘린 서류 (#89)
//
// 책상 위 더미는 세 장이 상한이라 그 위 구간이 안 보였다. 바닥으로 넘치게 하면서
// **이미 흘린 장은 그 자리에 그대로 있고 새 장만 더해지는 것**이 요점이다 — 그건 장 번호(k)로
// 위치를 정하는 구조가 보장하고, 여기서는 장수 셈법을 붙잡는다.
const { floorSheetCount } = await import('../renderer/render.mjs');

test('60% 아래에서는 바닥이 깨끗하다', () => {
  // 막대가 노랑으로 바뀌는 지점부터 흘린다 — 책상 더미(40%부터)보다 늦다
  for (const pct of [null, undefined, 0, 40, 55, 59]) assert.equal(floorSheetCount(pct), 0, String(pct));
});

test('60%에서 한 장, 5%마다 한 장 늘어난다', () => {
  assert.equal(floorSheetCount(60), 1);
  assert.equal(floorSheetCount(64), 1);
  assert.equal(floorSheetCount(65), 2);
  assert.equal(floorSheetCount(70), 3);
  assert.equal(floorSheetCount(85), 6);
});

test('한없이 늘지는 않는다', () => {
  // 방이 종이로 덮이면 게가 안 보인다 — 아홉 개에서 멈추고 100%에서 그 상한에 닿는다
  assert.equal(floorSheetCount(95), 8);
  assert.equal(floorSheetCount(100), 9);
  assert.equal(floorSheetCount(120), 9);
});

test('장수는 컨텍스트에 대해 단조 증가한다', () => {
  // 줄어드는 구간이 있으면 "찰수록 어지러워진다"가 깨진다
  let prev = 0;
  for (let pct = 0; pct <= 100; pct++) {
    const n = floorSheetCount(pct);
    assert.ok(n >= prev, `${pct}%에서 ${prev} → ${n}로 줄었다`);
    prev = n;
  }
});

// 널브러진 것의 모양 고르기 (#91). 위치와 마찬가지로 **장 번호로만** 고른다 —
// 프레임마다 다시 뽑으면 종이가 모양을 바꾸며 깜빡인다.
const { litterKeyFor } = await import('../renderer/render.mjs');
const { SPR } = await import('../renderer/sprites.mjs');

test('고른 모양은 다 스프라이트가 있다', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (let k = 0; k < 9; k++) {
      const key = litterKeyFor(seed * 7919, k);
      assert.ok(SPR[key], `${key} 스프라이트가 없다`);
    }
  }
});

test('같은 장 번호면 늘 같은 모양이다', () => {
  for (let k = 0; k < 9; k++) assert.equal(litterKeyFor(12345, k), litterKeyFor(12345, k));
});

test('처음 두 개는 종이다 — 쓰레기부터 나오면 지저분한 방으로 읽힌다', () => {
  const trash = ['paperBall', 'canDown'];
  for (let seed = 0; seed < 200; seed++) {
    for (const k of [0, 1]) {
      assert.ok(!trash.includes(litterKeyFor(seed * 31, k)), `seed ${seed} k ${k}`);
    }
  }
});

test('여러 모양이 섞이고 쓰레기도 나온다', () => {
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) for (let k = 0; k < 9; k++) seen.add(litterKeyFor(seed * 31, k));
  // 각도 넉 장이 다 쓰이고
  for (const key of ['sheetFlat', 'sheetTiltR', 'sheetTiltL', 'sheetNarrow']) assert.ok(seen.has(key), key);
  // 쓰레기 둘도 나온다
  for (const key of ['paperBall', 'canDown']) assert.ok(seen.has(key), key);
});
