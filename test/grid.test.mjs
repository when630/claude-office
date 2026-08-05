// 방을 앉히는 칸 그리드 (renderer/render.mjs의 assignSlots·layout).
//
// 여기서 붙잡는 것은 하나다: **배치가 창 크기를 따르지 않는가.**
// 전에는 창 폭에 맞춰 방을 흘려 줄바꿈했고, 창을 조금 줄인 것만으로 줄 수와 방 모양이
// 같이 바뀌었다. 눈으로는 "창을 줄였더니 사무실이 다시 짜였다"로만 보여서, 무엇이 원인인지
// (줄바꿈인지 자리 줄 접힘인지) 화면만 굽어서는 갈라내기 어렵다.
//
// 나머지 절반은 옮긴 자리가 지켜지는가다 — 손으로 옮긴 방 하나 때문에 나머지가 따라
// 움직이면 배치를 짤 수 없다.
//
// render.mjs는 모듈 로드 때 sprites.mjs가 canvas를 만들므로 node로는 안 열린다.
// **document를 최소한으로 세워** 열어 준다 (mini.test.mjs와 같은 수법).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect() {},
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {},
    }),
  }),
};

const { assignSlots, layout, cellAt, cellRect, GRID_COLS } = await import('../renderer/render.mjs');

function room(key, n = 1) {
  return {
    key,
    label: key,
    cwd: `/${key}`,
    workers: Array.from({ length: n }, (_, i) => ({ key: `${key}${i}`, name: `${key}${i}`, mood: 'typing' })),
  };
}

// 방 key → 박스. 좌표를 비교할 때 방 순서에 의존하지 않게 한다.
function boxOf(view, key) {
  return view.boxes.find((b) => b.room.key === key);
}

const slotsOf = (view) => Object.fromEntries(view.boxes.map((b) => [b.room.key, b.slot]));

test('칸을 안 정해 두면 읽는 순서로 채운다 — 열 수만큼 가고 다음 줄로 넘어간다', () => {
  const keys = ['a', 'b', 'c', 'd'];
  const got = assignSlots(keys, {});
  assert.deepEqual(got.get('a'), [0, 0]);
  assert.deepEqual(got.get('b'), [1, 0]);
  assert.deepEqual(got.get('c'), [2, 0]);
  // GRID_COLS가 3이면 넷째는 다음 줄 첫 칸이다
  assert.deepEqual(got.get('d'), [0, 1]);
});

test('정해 둔 칸이 먼저고 나머지는 남은 칸을 메운다', () => {
  const got = assignSlots(['a', 'b', 'c'], { b: [0, 0] });
  assert.deepEqual(got.get('b'), [0, 0]);
  assert.deepEqual(got.get('a'), [1, 0]);
  assert.deepEqual(got.get('c'), [2, 0]);
});

test('같은 칸을 둘이 가리키면 앞선 방이 이기고 뒤는 빈 칸으로 떨어진다', () => {
  // 설정 파일을 손으로 고쳤을 때 방이 겹쳐 한쪽이 안 보이게 되는 것을 막는다
  const got = assignSlots(['a', 'b'], { a: [1, 1], b: [1, 1] });
  assert.deepEqual(got.get('a'), [1, 1]);
  assert.deepEqual(got.get('b'), [0, 0]);
});

test('열 밖·음수·깨진 값은 버리고 자동 배정으로 돌린다', () => {
  const got = assignSlots(['a', 'b', 'c', 'd'], {
    a: [GRID_COLS, 0], // 열 밖
    b: [-1, 0],
    c: [0, 1.5], // 정수가 아니다
    d: 'nope',
  });
  assert.deepEqual(got.get('a'), [0, 0]);
  assert.deepEqual(got.get('b'), [1, 0]);
  assert.deepEqual(got.get('c'), [2, 0]);
  assert.deepEqual(got.get('d'), [0, 1]);
});

test('배치는 창 크기를 보지 않는다 — layout에 넘길 창 폭이 아예 없다', () => {
  // 옛 layout(rooms, maxWidth)에서는 이 두 호출이 다른 배치를 냈다. 지금은 인자가 하나다.
  const rooms = () => [room('a', 3), room('b', 1), room('c', 5), room('d', 2)];
  const wide = layout(rooms());
  const narrow = layout(rooms());
  assert.deepEqual(slotsOf(narrow), slotsOf(wide));
  assert.equal(narrow.width, wide.width);
  assert.equal(narrow.height, wide.height);
  for (const b of wide.boxes) {
    const same = boxOf(narrow, b.room.key);
    assert.deepEqual([same.x, same.y, same.w, same.h], [b.x, b.y, b.w, b.h], `${b.room.key}가 옮겨졌다`);
  }
});

test('방 폭은 인원수만 탄다 — 자리 줄이 창 폭에 접히지 않는다', () => {
  // 전에는 좁은 창에서 fitCols가 자리 줄을 접어 방이 좁고 높아졌다(창 크기가 방 모양을 정했다).
  const one = boxOf(layout([room('a', 1)]), 'a');
  const five = boxOf(layout([room('a', 5)]), 'a');
  assert.ok(five.w > one.w, '5인 방이 1인 방보다 넓어야 한다');
  assert.equal(five.rows, 1, '자리는 한 줄에 다 앉는다');
});

test('같은 열의 방은 왼쪽 선이 맞고, 같은 행의 방은 높이가 같다', () => {
  // 칸 그리드로 읽히려면 시작선이 맞아야 한다. 행 높이는 회의실 때문에 방마다 다른데,
  // 그대로 두면 한 줄에 선 방들의 아래가 들쭉날쭉하다.
  const view = layout([room('a', 5), room('b', 1), room('c', 2), room('d', 1)]);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => boxOf(view, k));
  assert.deepEqual(a.slot, [0, 0]);
  assert.deepEqual(d.slot, [0, 1]);
  assert.equal(d.x, a.x, '같은 열이면 x가 같다');
  assert.equal(b.y, a.y, '같은 행이면 y가 같다');
  assert.equal(c.h, a.h, '같은 행이면 높이가 같다');
  assert.ok(d.y > a.y + a.h, '다음 줄은 위 줄 아래에 선다');
});

test('뒤쪽 빈 열·행은 자르고, 끌고 있는 동안만 한 칸 펼친다', () => {
  const rooms = [room('a', 2)];
  const still = layout(rooms);
  assert.equal(still.grid.cols, 1, '방 하나면 열도 하나 — 빈 띠를 달고 다니지 않는다');
  assert.equal(still.grid.rows, 1);

  const dragging = layout(rooms, { spread: true });
  assert.equal(dragging.grid.cols, GRID_COLS, '끌 때는 새 열에 놓을 자리가 있어야 한다');
  assert.equal(dragging.grid.rows, 2, '새 줄도 하나 열어 준다');
  // 펼쳐도 이미 놓인 방은 움직이지 않는다 — 앞쪽 열이 x를 정하기 때문이다
  assert.equal(boxOf(dragging, 'a').x, boxOf(still, 'a').x);
  assert.equal(boxOf(dragging, 'a').y, boxOf(still, 'a').y);
});

test('가운데 빈 칸은 남는다 — 비워 둔 자리에 다시 놓을 수 있어야 한다', () => {
  const view = layout([room('a', 1), room('b', 1)], { slots: { a: [0, 0], b: [2, 0] } });
  const at = cellRect(view, 1, 0);
  assert.ok(at && at.w > 0, '가운데 열이 접혀 사라지면 화면의 격자와 짚는 격자가 어긋난다');
  assert.ok(boxOf(view, 'b').x > at.x + at.w - 1, 'b는 빈 칸 오른쪽에 선다');
});

test('좌표에서 칸을 짚는다 — 격자 밖은 가장 가까운 칸에 붙는다', () => {
  const view = layout([room('a', 2), room('b', 2), room('c', 2)], { spread: true });
  const b = boxOf(view, 'b');
  assert.deepEqual(cellAt(view, b.x + 3, b.y + 3), [1, 0]);
  assert.deepEqual(cellAt(view, -500, -500), [0, 0], '왼쪽 위 밖은 첫 칸이다');
  assert.deepEqual(cellAt(view, 99999, 99999), [GRID_COLS - 1, view.grid.rows - 1], '오른쪽 아래 밖은 끝 칸이다');
});

test('방이 없으면 크기가 0이다 — 첫 스냅샷 전에 화면을 가운데로 몰지 않는다', () => {
  const view = layout([]);
  assert.equal(view.width, 0);
  assert.equal(view.height, 0);
  assert.equal(cellAt(view, 0, 0), null);
});
