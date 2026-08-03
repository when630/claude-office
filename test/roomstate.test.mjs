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
